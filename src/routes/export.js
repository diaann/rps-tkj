const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');

const rpsPath = path.join(__dirname, '..', 'database', 'rps.json');

// Middleware to check if user is logged in
function isAuthenticated(req, res, next) {
  if (req.session.user) {
    return next();
  }
  res.redirect('/login');
}




// Export RPS data to Word (single RPS by id) using docxtemplater and template.docx
function buildDataFromItem(item) {
  // Siapkan data untuk template
  const data = { ...item };

  // Format tanggal ke penanggalan Indonesia
  const bulanIndo = ['Januari','Februari','Maret','April','Mei','Juni',
    'Juli','Agustus','September','Oktober','November','Desember'];

  if (data.tanggal_penyusunan) {
    const raw = String(data.tanggal_penyusunan);
    let d;
    // Support format YYYY-MM-DD atau DD/MM/YYYY
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const [y, m, day] = raw.split('-');
      d = { day: parseInt(day), month: parseInt(m) - 1, year: parseInt(y) };
    } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
      const [day, m, y] = raw.split('/');
      d = { day: parseInt(day), month: parseInt(m) - 1, year: parseInt(y) };
    }
    if (d) {
      data.tanggal_penyusunan = `${d.day} ${bulanIndo[d.month]} ${d.year}`;
    }
  }

  // Helper: normalize a field that may be stored as array, string, object, or legacy 'field[]'
  function normalizeListField(item, fieldBase) {
    const legacyKey = `${fieldBase}[]`;
    const raw = (item[fieldBase] !== undefined) ? item[fieldBase] : (item[legacyKey] !== undefined ? item[legacyKey] : []);
    let arr = [];
    if (Array.isArray(raw)) {
      arr = raw.slice();
    } else if (typeof raw === 'string') {
      if (raw.indexOf(',') !== -1) {
        arr = raw.split(',').map(s => s.trim()).filter(Boolean);
      } else {
        arr = raw ? [raw] : [];
      }
    } else if (raw && typeof raw === 'object') {
      try {
        arr = Object.values(raw).map(v => v).filter(v => v !== undefined && v !== null);
      } catch (e) {
        arr = [];
      }
    } else {
      arr = [];
    }

    // Ensure all items are strings for templating
    const normalized = arr.map(v => {
      if (v === null || v === undefined) return '';
      if (typeof v === 'string') return v;
      if (typeof v === 'number' || typeof v === 'boolean') return String(v);
      try {
        // If it's an object, attempt to pick common text fields
        if (v.title) return String(v.title);
        if (v.name) return String(v.name);
        if (v.text) return String(v.text);
        // Fallback to JSON
        return JSON.stringify(v);
      } catch (e) {
        return String(v);
      }
    }).filter(s => s !== '');

    return normalized;
  }
  // CPL Descriptions (bisa dipakai di template)
  const allCplDescriptions = {
    CPL01: 'Menunjukkan sikap profesional yang berlandaskan ketakwaan, etika, integritas, nasionalisme, dan kepedulian sosial dalam menjalankan tugas di bidang teknik komputer dan jaringan',
    CPL02: 'Menerapkan konsep matematika, komputasi, dan kecerdasan buatan dalam penyelesaian masalah teknis jaringan secara sistematis.',
    CPL03: 'Mengelola pembelajaran sepanjang hayat untuk pengembangan profesional diri dalam lingkungan kerja global yang dinamis dan kompetitif.',
    CPL04: 'Menyelesaikan permasalahan dan tugas teknis jaringan komputer melalui perancangan, konfigurasi, pengujian, dan pengelolaan perangkat serta infrastruktur jaringan pada berbagai skala topologi dalam konteks operasional sistem komunikasi data dan administrasi jaringan.',
    CPL05: 'Merancang infrastruktur jaringan komputer serta sistem virtualisasi dan komputasi awan dalam konteks pembangunan dan pengelolaan layanan TIK yang fleksibel, skalabel, dan terotomasi. (C6)',
    CPL06: 'Mengintegrasikan teknologi jaringan wireless & mobile, sistem tertanam, dan komputasi terdistribusi dalam perancangan dan pengelolaan solusi komunikasi data nirkabel yang andal dan adaptif untuk lingkungan industri dan IoT.',
    CPL07: 'Mengembangkan solusi berbasis IoT dan sistem tertanam dalam integrasi perangkat keras, perangkat lunak, dan komunikasi data.',
    CPL08: 'Merancang solusi berbasis prinsip keamanan siber dan pembelajaran mesin untuk memitigasi risiko serta memperkuat ketahanan infrastruktur informasi',
    CPL09: 'Mengelola infrastruktur virtualisasi dan komputasi awan beserta pipeline DevOps dalam otomatisasi penyediaan layanan TIK yang skalabel, andal, dan berkelanjutan',
    CPL10: 'Mengkomunikasikan ide dan solusi teknis dalam kegiatan penelitian atau kerja sama tim multidisiplin secara ilmiah dan profesional.'
  };

  // Normalize CPL input to an array. item['cpl[]'] may be an array, a string, or undefined.
  const rawCpl = item['cpl[]'] || item.cpl || [];
  let cplArray = [];
  if (Array.isArray(rawCpl)) {
    cplArray = rawCpl;
  } else if (typeof rawCpl === 'string') {
    // Could be a comma-separated list or single value
    if (rawCpl.indexOf(',') !== -1) {
      cplArray = rawCpl.split(',').map(s => s.trim()).filter(Boolean);
    } else {
      cplArray = rawCpl ? [rawCpl] : [];
    }
  } else if (rawCpl && typeof rawCpl === 'object') {
    // Sometimes body-parsers produce an object for single values; try to coerce values
    try {
      cplArray = Object.values(rawCpl).map(v => String(v)).filter(Boolean);
    } catch (e) {
      cplArray = [];
    }
  } else {
    cplArray = [];
  }

  data.cplList = cplArray.map(cplCode => {
    return {
      code: cplCode,
      description: (item.cpl_descriptions && item.cpl_descriptions[cplCode])
                   ? item.cpl_descriptions[cplCode]
                   : (allCplDescriptions[cplCode] || 'No description available')
    };
  });

  // CPMK dan sub-CPMK untuk table (bisa diakses di template)
  data.cpmk = [];
  data.sub_cpmk = [];
  // CPMK
  Object.entries(item).forEach(([k, v]) => {
    const match = k.match(/^cpmk\[(CPMK\d+)\]\[(.+)\]$/);
    if (match) {
      const cpmkId = match[1];
      const field = match[2];
      let cpmkObj = data.cpmk.find(c => c.id === cpmkId);
      if (!cpmkObj) {
        cpmkObj = { id: cpmkId };
        data.cpmk.push(cpmkObj);
      }
      cpmkObj[field] = v;
    }
  });
  // sub-CPMK
  Object.entries(item).forEach(([k, v]) => {
    const match = k.match(/^sub_cpmk\[(CPMK\d+)\]\[(\d+)\]\[(.+)\]$/);
    if (match) {
      const cpmkId = match[1];
      const subId = match[2];
      const field = match[3];
      let sub = data.sub_cpmk.find(s => s.cpmkId === cpmkId && s.subId === subId);
      if (!sub) {
        sub = { cpmkId, subId };
        data.sub_cpmk.push(sub);
      }
      sub[field] = v;
      // normalisasi modalitas (key bisa 'modalitas][' atau 'modalitas[]' tergantung parsing)
      if (field === 'modalitas[]' || field === 'modalitas][') {
        sub['modalitas'] = Array.isArray(v) ? v.join(' & ') : (v || '');
      }
      // normalisasi cpl sub_cpmk
      if (field === 'cpl[]' || field === 'cpl][') {
        sub['cpl'] = Array.isArray(v) ? v.join(', ') : (v || '');
      }
    }
  });

  // Bentuk Asesmen: gabungkan Formatif & Sumatif (Kuis/Tugas/Ujian/PjBL/Lainnya)
  // menjadi field siap-tampil untuk template Word. Bobot disimpan sebagai angka
  // saja di data, dan tanda "%" baru ditambahkan di sini saat export.
  // "Lainnya" bisa berisi lebih dari 1 komponen (nama+bobot) -- karena kolom
  // Word untuk Lainnya cuma 1 kolom fisik (lihat README_DOCX_EXTRACTION.md
  // soal batasan tabel Word), semua item digabung jadi teks multi-baris
  // dalam SATU sel itu saja.
  function buildAsesmenDisplay(sub) {
    function withPercent(nama, bobot) {
      const namaTrim = (nama || '').toString().trim();
      const bobotTrim = (bobot || '').toString().trim();
      if (namaTrim && bobotTrim) return `${namaTrim} (${bobotTrim}%)`;
      if (namaTrim) return namaTrim;
      if (bobotTrim) return `(${bobotTrim}%)`;
      return '';
    }

    let lainnyaItems = [];
    try {
      const parsed = JSON.parse(sub.sumatif_lainnya || '[]');
      if (Array.isArray(parsed)) lainnyaItems = parsed;
    } catch (e) {
      lainnyaItems = [];
    }

    const formatifNama = (sub.formatif_nama || '').toString().trim();
    const formatifDisplay = withPercent(sub.formatif_nama, sub.formatif_bobot);
    const kuisDisplay = withPercent(sub.sumatif_kuis_nama, sub.sumatif_kuis_bobot);
    const tugasDisplay = withPercent(sub.sumatif_tugas_nama, sub.sumatif_tugas_bobot);
    const ujianDisplay = withPercent(sub.sumatif_ujian_nama, sub.sumatif_ujian_bobot);
    const pjblDisplay = withPercent(sub.sumatif_pjbl_nama, sub.sumatif_pjbl_bobot);
    const lainnyaDisplay = lainnyaItems.map(item => withPercent(item.nama, item.bobot)).filter(Boolean).join('\n');

    const hasNewFormat = formatifDisplay || kuisDisplay || tugasDisplay || ujianDisplay || pjblDisplay || lainnyaDisplay;

    // Fallback untuk RPS lama yang masih memakai field tunggal 'asesmen'
    const legacyAsesmen = (sub.asesmen || '').toString().trim();

    const gabungan = hasNewFormat
      ? [formatifDisplay, kuisDisplay, tugasDisplay, ujianDisplay, pjblDisplay, lainnyaDisplay].filter(Boolean).join(', ')
      : legacyAsesmen;

    return {
      formatif_nama: formatifNama,
      formatif_display: formatifDisplay,
      kuis_display: kuisDisplay,
      tugas_display: tugasDisplay,
      ujian_display: ujianDisplay,
      pjbl_display: pjblDisplay,
      lainnya_display: lainnyaDisplay,
      asesmen: gabungan
    };
  }

  data.sub_cpmk = (data.sub_cpmk || []).map(sub => Object.assign({}, sub, buildAsesmenDisplay(sub)));

  // Build helper rows for MP (materi pelajaran) if needed by templates
  data.subMateriRows = (data.sub_cpmk || []).map(s => {
    const materi = s.materi || s['materi_pelajaran'] || s.deskripsi || '';
    const mpId = `MP-${s.cpmkId}-${s.subId}`;
    return { mpId, materi };
  });

  // Build grouped CPMK with their subs for templates that expect nested loops
  // cpmkWithSubs => [{ cpmkId, deskripsi, subs: [{ subId, deskripsi }, ...] }, ...]
  data.cpmkWithSubs = (data.cpmk || []).map(c => {
    return {
      cpmkId: c.id,
      deskripsi: c.deskripsi || c.description || '',
      subs: (data.sub_cpmk || []).filter(s => s.cpmkId === c.id).map(s => ({
        subId: s.subId,
        deskripsi: s.deskripsi || s.description || ''
      }))
    };
  });

  const normPustakaUtama = normalizeListField(item, 'pustaka_utama');
  const normPustakaPendukung = normalizeListField(item, 'pustaka_pendukung');
  const normDosen = normalizeListField(item, 'dosen_pengampu');
  // Set both canonical and legacy keys so templates using either will get normalized strings
  data.pustaka_utama = normPustakaUtama;
  data['pustaka_utama[]'] = normPustakaUtama;
  data.pustaka_pendukung = normPustakaPendukung;
  data['pustaka_pendukung[]'] = normPustakaPendukung;
  data.dosen_pengampu = normDosen;
  data['dosen_pengampu[]'] = normDosen;

  return { data, item };
}

function renderAndSendDocx(res, data, item, templateFilename, versionSuffix = '') {
  const templatePath = path.join(__dirname, '../templates', templateFilename);
  let content;
  try {
    content = fs.readFileSync(templatePath, 'binary');
  } catch (err) {
    return res.status(500).send(`Template Word tidak ditemukan. Upload ${templateFilename} ke folder templates.`);
  }

  try {
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
    doc.render(data);
    const buf = doc.getZip().generate({ type: 'nodebuffer' });

    // Build a safe filename using tanggal_penyusunan and nama_mk
    const rawDate = item.tanggal_penyusunan || item.tanggal || '';
    const datePart = String(rawDate).replace(/\//g, '-');
    const namePart = item.nama_mk ? String(item.nama_mk) : `RPS-${item.id}`;
    let baseFilename = datePart ? `${datePart} ${namePart}` : namePart;
    // Remove characters invalid in Windows filenames and control chars
    baseFilename = baseFilename.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/\s+/g, ' ').trim();
    if (baseFilename.length > 120) baseFilename = baseFilename.slice(0, 120);
    const versionTag = versionSuffix ? `_${versionSuffix}` : '';
    const filename = `RPS${versionTag} ${baseFilename}.docx`;

    // Set Content-Disposition with both regular filename and UTF-8 encoded filename*
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.send(buf);
  } catch (err) {
    res.status(500).send('Gagal generate Word: ' + err.message);
  }
}

// // existing route kept for backward compatibility using template.docx
// router.get('/export/word/:id', isAuthenticated, (req, res) => {
//   const rpsId = req.params.id;
//   const rawData = fs.readFileSync(rpsPath);
//   const rps = JSON.parse(rawData);
//   let item;
//   if (req.session.user && req.session.user.role === 'admin') {
//     item = rps.find(r => String(r.id) === String(rpsId));
//   } else {
//     item = rps.find(r => String(r.id) === String(rpsId) && r.userId === req.session.user.id);
//   }
//   if (!item) {
//     return res.status(404).send('RPS tidak ditemukan');
//   }

//   const { data } = buildDataFromItem(item);
//   renderAndSendDocx(res, data, item, 'template.docx');
// });

// New: export with template.docx (alias Word-1)
router.get('/export/word-1/:id', isAuthenticated, (req, res) => {
  const rpsId = req.params.id;
  const rawData = fs.readFileSync(rpsPath);
  const rps = JSON.parse(rawData);
  let item;
  if (req.session.user && req.session.user.role === 'admin') {
    item = rps.find(r => String(r.id) === String(rpsId));
  } else {
    item = rps.find(r => String(r.id) === String(rpsId) && r.userId === req.session.user.id);
  }
  if (!item) {
    return res.status(404).send('RPS tidak ditemukan');
  }
  const { data } = buildDataFromItem(item);
  renderAndSendDocx(res, data, item, 'template.docx', 'v1');
});

router.get('/export/word-2/:id', isAuthenticated, (req, res) => {
  const rpsId = req.params.id;
  const rawData = fs.readFileSync(rpsPath);
  const rps = JSON.parse(rawData);
  let item;
  if (req.session.user && req.session.user.role === 'admin') {
    item = rps.find(r => String(r.id) === String(rpsId));
  } else {
    item = rps.find(r => String(r.id) === String(rpsId) && r.userId === req.session.user.id);
  }
  if (!item) {
    return res.status(404).send('RPS tidak ditemukan');
  }
  const { data } = buildDataFromItem(item);
  renderAndSendDocx(res, data, item, 'template-1.docx', 'v2');
});

module.exports = router;
module.exports.buildDataFromItem = buildDataFromItem; // diekspos supaya bisa dites langsung tanpa lewat HTTP
