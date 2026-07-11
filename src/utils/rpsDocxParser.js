const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const cplsPath = path.join(__dirname, '..', 'database', 'cpls.json');
const DOCX_PYTHON_SCRIPT = path.join(__dirname, 'docx_extractor.py');

const INDONESIAN_MONTHS = {
  januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6,
  juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12,
  january: 1, february: 2, march: 3, may: 5, june: 6, july: 7,
  august: 8, october: 10, december: 12
};

// ---------------------------------------------------------------------------
// Util kecil untuk membersihkan & menormalkan nilai yang sudah diekstrak
// secara terstruktur oleh docx_extractor.py.
// ---------------------------------------------------------------------------

function padCode(prefix, number) {
  const n = String(number || '').replace(/\D/g, '');
  if (!n) return '';
  return `${prefix}${n.padStart(2, '0')}`;
}

function normalizeCplCode(value) {
  const match = String(value || '').match(/CPL\s*0*(\d+)/i);
  return match ? padCode('CPL', match[1]) : String(value || '').trim();
}

function cleanText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function toTitleCase(value) {
  const smallWords = new Set(['dan', 'di', 'ke', 'dari', 'untuk', 'pada', 'dengan', 'atau']);
  return String(value || '')
    .toLowerCase()
    .split(' ')
    .map((word, index) => {
      const cleanWord = word.replace(/[^a-z0-9]/gi, '');
      if (/^[ivxlcdm]+$/i.test(cleanWord) && cleanWord.length <= 6) return word.toUpperCase();
      const upper = cleanWord.toUpperCase();
      const acronyms = ['RPS', 'CPL', 'CPMK', 'SKS', 'MK', 'UI', 'UX', 'API', 'IoT'];
      if (acronyms.includes(upper)) return upper === 'IOT' ? 'IoT' : upper;
      if (index > 0 && smallWords.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ')
    .trim();
}

function cleanCourseName(value, fileName = '') {
  let name = cleanText(value);
  if (!name && fileName) {
    name = path.basename(fileName, path.extname(fileName));
  }
  name = cleanText(name)
    .replace(/^salinan\s+dari\s+/i, '')
    .replace(/\bRPS\b/ig, ' ')
    .replace(/\.docx?$/ig, '')
    .replace(/\bdocx?\b/ig, ' ')
    .replace(/[_.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const lettersOnly = name.replace(/[^a-zA-Z]/g, '');
  if (lettersOnly && (lettersOnly === lettersOnly.toUpperCase() || lettersOnly === lettersOnly.toLowerCase())) {
    name = toTitleCase(name);
  }
  return name;
}

function parseFlexibleDate(value) {
  const text = cleanText(value).toLowerCase();
  if (!text) return { iso: '', year: null, month: null, day: null, original: '' };

  // Format Indonesia: "4 Agustus 2025" / "Agustus 2025"
  let m = text.match(/(?:(\d{1,2})\s+)?(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s+(\d{4})/i);
  if (m) {
    const day = Number(m[1] || 1);
    const month = INDONESIAN_MONTHS[m[2].toLowerCase()];
    const year = Number(m[3]);
    return { iso: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, year, month, day, original: cleanText(value) };
  }

  // Format Inggris: "24 July 2025"
  m = text.match(/(?:(\d{1,2})\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})/i);
  if (m) {
    const day = Number(m[1] || 1);
    const month = INDONESIAN_MONTHS[m[2].toLowerCase()];
    const year = Number(m[3]);
    return { iso: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, year, month, day, original: cleanText(value) };
  }

  // Format numerik: 04/08/2025, 2025-08-04, dst
  m = text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    const [, y, mo, d] = m;
    return { iso: `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`, year: Number(y), month: Number(mo), day: Number(d), original: cleanText(value) };
  }
  m = text.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) {
    const [, d, mo, y] = m;
    return { iso: `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`, year: Number(y), month: Number(mo), day: Number(d), original: cleanText(value) };
  }

  return { iso: '', year: null, month: null, day: null, original: cleanText(value) };
}

function inferAcademicYear(dateInfo) {
  const now = new Date();
  const year = dateInfo && dateInfo.year ? dateInfo.year : now.getFullYear();
  const month = dateInfo && dateInfo.month ? dateInfo.month : now.getMonth() + 1;
  if (month >= 7) return `${year}/${year + 1}`;
  return `${year - 1}/${year}`;
}

function loadCplDescriptionsFromDatabase(activeCplId = '') {
  const descriptionMap = {};
  try {
    if (!fs.existsSync(cplsPath)) return descriptionMap;
    const sets = JSON.parse(fs.readFileSync(cplsPath, 'utf8') || '[]');
    if (!Array.isArray(sets)) return descriptionMap;
    const preferred = sets.find(set => String(set.id) === String(activeCplId));
    const orderedSets = preferred ? [preferred, ...sets.filter(set => String(set.id) !== String(activeCplId))] : sets;
    orderedSets.forEach(set => {
      const content = Array.isArray(set && set.content) ? set.content : [];
      content.forEach(item => {
        const code = normalizeCplCode(item && item.code);
        const desc = cleanText(item && (item.desc || item.description || item.deskripsi));
        if (code && desc && !descriptionMap[code]) descriptionMap[code] = desc;
      });
    });
  } catch (error) {
    console.warn('[UPLOAD RPS] Gagal membaca database CPL:', error.message || error);
  }
  return descriptionMap;
}

// ---------------------------------------------------------------------------
// Jembatan ke docx_extractor.py (python-docx). Skrip Python membaca struktur
// tabel asli di .docx sehingga Rumpun MK / Semester / Tanggal / Otorisasi /
// CPL-CPMK-Sub-CPMK terekstrak sesuai posisi kolomnya, bukan ditebak dari teks
// mentah yang dilinearkan.
// ---------------------------------------------------------------------------

function runPythonExtractor(scriptPath, filePath, missingModuleErrorKey, missingModuleMessage) {
  const candidates = [process.env.PYTHON_BIN, 'python3', 'python', 'py'].filter(Boolean);
  let lastError = null;
  let sawWindowsStoreStub = false;

  for (const bin of candidates) {
    const result = spawnSync(bin, [scriptPath, filePath], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 64
    });

    if (result.error) {
      lastError = result.error;
      continue; // biner python ini tidak ditemukan di sistem, coba kandidat berikutnya
    }

    const stderrText = result.stderr || '';
    if (/Python was not found|Microsoft Store/i.test(stderrText)) {
      // Windows: "python"/"python3" di PATH cuma alias App Execution ke Microsoft
      // Store, bukan Python sungguhan. Coba kandidat lain dulu (mis. "py").
      sawWindowsStoreStub = true;
      continue;
    }

    const stdout = (result.stdout || '').trim();
    if (!stdout) {
      throw new Error(
        `Proses ekstraksi (${path.basename(scriptPath)}) tidak mengeluarkan output. ` +
        `stderr: ${stderrText.slice(0, 500)}`
      );
    }

    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch (e) {
      throw new Error(`Gagal membaca hasil ekstraksi (output bukan JSON valid): ${e.message}`);
    }

    if (parsed.error === missingModuleErrorKey) {
      throw new Error(missingModuleMessage);
    }
    if (parsed.error) {
      throw new Error(`Gagal mengekstrak dokumen: ${parsed.error}`);
    }

    return parsed;
  }

  if (sawWindowsStoreStub) {
    throw new Error(
      'Python belum terinstall di komputer ini -- "python"/"python3" di PATH masih mengarah ke ' +
      'stub Microsoft Store (App Execution Alias), bukan Python asli. Cara memperbaiki: ' +
      '(1) Install Python 3 dari https://python.org/downloads (centang "Add python.exe to PATH" saat instalasi), ' +
      'atau (2) matikan alias tsb. di Settings > Apps > Advanced app settings > App execution aliases, ' +
      'lalu jalankan "pip install -r requirements.txt". Setelah itu restart aplikasi ini.'
    );
  }

  throw new Error(
    `Tidak menemukan interpreter Python (python3/python/py) di server. ${lastError ? lastError.message : ''} ` +
    `Pastikan Python 3 dan dependensinya terinstall (lihat README_PDF_EXTRACTION.md).`
  );
}

// ---------------------------------------------------------------------------
// Perakitan rpsData dari hasil ekstraksi terstruktur
// ---------------------------------------------------------------------------

function buildIdentity(extraction, fileName, options) {
  const identity = extraction.identity || {};
  const dateInfo = parseFlexibleDate(identity.tanggal_penyusunan_raw || '');

  let namaMk = cleanCourseName(identity.nama_mk, fileName);
  if (!namaMk) namaMk = 'RPS hasil upload Word';

  let kodeMk = cleanText(identity.kode_mk || '');
  // Placeholder umum ("MK-??", "-", dst) dianggap belum diisi di dokumen sumber.
  if (/^[\?\-\s]*$/.test(kodeMk)) kodeMk = '';

  return {
    nama_mk: namaMk,
    kode_mk: kodeMk || options.defaultKodeMk || '',
    rumpun_mk: cleanText(identity.rumpun_mk) || 'Mata Kuliah Umum',
    semester: cleanText(identity.semester) || '',
    sks_teori: cleanText(identity.sks_teori) || '0',
    sks_praktikum: cleanText(identity.sks_praktikum) || '0',
    tanggal_penyusunan: dateInfo.iso || new Date().toISOString().slice(0, 10),
    // Tahun akademik memang tidak pernah tercantum eksplisit di dokumen RPS
    // manapun yang diuji -- dibiarkan hasil tebakan dari tanggal penyusunan
    // sebagai titik awal, tapi selalu ditandai di extraction_notes supaya user tahu
    // field ini perlu dicek/diisi manual, bukan dianggap "gagal ekstrak".
    tahun_akademik: dateInfo.iso ? inferAcademicYear(dateInfo) : ''
  };
}

function buildAuthorization(extraction, fallback) {
  const auth = extraction.otorisasi || {};
  return {
    dosen_pengembang_rps: cleanText(auth.pengembang_rps) || fallback.dosen_pengembang_rps || fallback.username || '',
    penjamin_mutu: cleanText(auth.koordinator_rmk) || fallback.penjamin_mutu || '',
    koordinator_program_studi: cleanText(auth.ketua_prodi) || fallback.koordinator_program_studi || '',
    koordinator_rmk_extracted: cleanText(auth.koordinator_rmk) || '',
    ketua_prodi_extracted: cleanText(auth.ketua_prodi) || ''
  };
}

function buildRpsObjectFromExtraction(extraction, options = {}) {
  const fallback = options.fallback || {};
  const fileName = options.fileName || '';

  const identity = buildIdentity(extraction, fileName, options);
  const auth = buildAuthorization(extraction, fallback);

  const cplList = (extraction.cpl || []).map(item => normalizeCplCode(item.code)).filter(Boolean);
  const extractedCplDescriptions = {};
  (extraction.cpl || []).forEach(item => {
    const code = normalizeCplCode(item.code);
    if (code && item.deskripsi) extractedCplDescriptions[code] = cleanText(item.deskripsi);
  });
  const dbCplDescriptions = loadCplDescriptionsFromDatabase(fallback.activeCplId || options.activeCplId || '');
  const cplDescriptions = { ...extractedCplDescriptions };
  cplList.forEach(code => {
    if (dbCplDescriptions[code]) cplDescriptions[code] = dbCplDescriptions[code];
  });

  const cpmks = (extraction.cpmk || []).map(item => ({
    id: item.id,
    cpl_code: item.cpl_code || cplList[0] || '',
    cpl_description: cplDescriptions[item.cpl_code] || '',
    deskripsi: cleanText(item.deskripsi)
  }));

  const subCpmks = (extraction.subcpmk || []).map(item => ({
    globalSubNumber: item.global_number,
    cpmk_id: item.cpmk_id,
    deskripsi: cleanText(item.deskripsi),
    bobot: item.bobot || '',
    formatif_nama: cleanText(item.formatif_nama || ''),
    formatif_bobot: item.formatif_bobot || '',
    bentuk_pembelajaran: cleanText(item.bentuk_pembelajaran || ''),
    metode_pembelajaran: cleanText(item.metode_pembelajaran || ''),
    kuis: item.kuis || null,
    tugas: item.tugas || null,
    ujian: item.ujian || null,
    pjbl: item.pjbl || null,
    presentasi: item.presentasi || null,
    lainnya: Array.isArray(item.lainnya) ? item.lainnya : []
  }));

  const weekly = extraction.weekly || [];
  const pustakaUtama = extraction.pustaka_utama || [];
  const pustakaPendukung = extraction.pustaka_pendukung || [];
  const dosenPengampu = extraction.dosen_pengampu || [];
  const materiKajian = (extraction.materi_kajian || []).join('\n');

  const rpsData = {
    ...identity,
    mk_syarat: extraction.mk_syarat || '',
    mata_kuliah_syarat: extraction.mk_syarat || '',
    'dosen_pengampu[]': dosenPengampu.length ? dosenPengampu : [fallback.username || 'Belum terdeteksi'],
    dosen_pengampu: dosenPengampu.length ? dosenPengampu : [fallback.username || 'Belum terdeteksi'],
    deskripsi_singkat_mk: extraction.deskripsi_singkat_mk || 'Deskripsi singkat belum berhasil diekstrak dari dokumen. Silakan lengkapi melalui menu edit.',
    materi_kajian: materiKajian || 'Materi kajian belum berhasil diekstrak dari dokumen. Silakan lengkapi melalui menu edit.',
    indikator_cpl: '',
    bentuk_pembelajaran: '',
    metode_pembelajaran: '',
    strategi_pembelajaran: '',
    modalitas: '',
    'pustaka_utama[]': pustakaUtama.length ? pustakaUtama : ['Pustaka utama belum terdeteksi dari dokumen.'],
    pustaka_utama: pustakaUtama.length ? pustakaUtama : ['Pustaka utama belum terdeteksi dari dokumen.'],
    'pustaka_pendukung[]': pustakaPendukung,
    pustaka_pendukung: pustakaPendukung,
    penjamin_mutu: auth.penjamin_mutu,
    dosen_pengembang_rps: auth.dosen_pengembang_rps,
    'dosen_pengembang_rps[]': [auth.dosen_pengembang_rps],
    koordinator_program_studi: auth.koordinator_program_studi,
    id_cpls: fallback.activeCplId || '',
    'cpl[]': cplList,
    cpl: cplList,
    cpl_descriptions: cplDescriptions,
    imported_from_docx: true,
    source_docx_name: fileName,
    source_docx_uploaded_at: new Date().toISOString(),
    extraction_notes: []
  };

  if (!rpsData.kode_mk) {
    rpsData.extraction_notes.push('Kode mata kuliah tidak terdeteksi jelas dari dokumen. Silakan lengkapi lewat Edit RPS.');
  }
  if (!identity.tahun_akademik) {
    rpsData.extraction_notes.push('Tahun akademik tidak tercantum di dokumen sumber (field ini memang jarang/tidak pernah ada di dokumen RPS). Silakan isi manual lewat Edit RPS.');
  }
  if (!cplList.length) {
    rpsData.extraction_notes.push('CPL tidak terdeteksi jelas dari dokumen. Silakan lengkapi lewat Edit RPS.');
  }
  if (!cpmks.length) {
    rpsData.extraction_notes.push('CPMK tidak terdeteksi jelas dari dokumen. Silakan lengkapi lewat Edit RPS.');
  }
  if (!subCpmks.length) {
    rpsData.extraction_notes.push('Sub-CPMK tidak terdeteksi jelas dari dokumen. Silakan lengkapi lewat Edit RPS.');
  }
  if (!weekly.length) {
    rpsData.extraction_notes.push('Rencana pembelajaran mingguan tidak terdeteksi jelas dari dokumen (format tabel mingguan bisa berbeda-beda antar template). Silakan lengkapi lewat Edit RPS.');
  }

  const cpmkCplMap = {};
  cpmks.forEach((cpmk, idx) => {
    const cpmkId = cpmk.id || padCode('CPMK', idx + 1);
    const cplCode = cpmk.cpl_code || cplList[0] || '';
    rpsData[`cpmk[${cpmkId}][cpl_code]`] = cplCode;
    rpsData[`cpmk[${cpmkId}][cpl_description]`] = cpmk.cpl_description || cplDescriptions[cplCode] || '';
    rpsData[`cpmk[${cpmkId}][deskripsi]`] = cpmk.deskripsi || '';
    cpmkCplMap[cpmkId] = cplCode;
  });

  const localCounters = {};
  subCpmks.forEach(sub => {
    const cpmkId = sub.cpmk_id || (cpmks[0] && cpmks[0].id) || 'CPMK01';
    localCounters[cpmkId] = (localCounters[cpmkId] || 0) + 1;
    const localIndex = localCounters[cpmkId];
    const weekDetail = weekly[(sub.globalSubNumber || localIndex) - 1] || null;
    const weekGuess = sub.globalSubNumber || localIndex;
    const pekanAwal = weekDetail ? weekDetail.pekan_awal : String(weekGuess);
    const pekanAkhir = weekDetail ? weekDetail.pekan_akhir : String(weekGuess);

    const teknikKriteria = (weekDetail && weekDetail.teknik_kriteria) || '';
    const luringText = (weekDetail && weekDetail.metode_luring) || '';
    const daringText = (weekDetail && weekDetail.metode_daring) || '';
    const hasDaring = Boolean(daringText);

    rpsData[`sub_cpmk[${cpmkId}][${localIndex}][deskripsi]`] = sub.deskripsi || '';
    rpsData[`sub_cpmk[${cpmkId}][${localIndex}][global_number]`] = String(sub.globalSubNumber || localIndex);
    rpsData[`sub_cpmk[${cpmkId}][${localIndex}][pekan_awal]`] = pekanAwal;
    rpsData[`sub_cpmk[${cpmkId}][${localIndex}][pekan_akhir]`] = pekanAkhir;
    rpsData[`sub_cpmk[${cpmkId}][${localIndex}][materi]`] = (weekDetail && weekDetail.materi) || materiKajian || sub.deskripsi || '';
    rpsData[`sub_cpmk[${cpmkId}][${localIndex}][durasi]`] = '';
    rpsData[`sub_cpmk[${cpmkId}][${localIndex}][indikator]`] = (weekDetail && weekDetail.indikator) || sub.deskripsi || 'Indikator belum terdeteksi dari dokumen.';
    rpsData[`sub_cpmk[${cpmkId}][${localIndex}][teknik_kriteria]`] = teknikKriteria;
    rpsData[`sub_cpmk[${cpmkId}][${localIndex}][modalitas][]`] = hasDaring ? ['luring', 'daring'] : ['luring'];
    rpsData[`sub_cpmk[${cpmkId}][${localIndex}][metode_luring]`] = luringText;
    rpsData[`sub_cpmk[${cpmkId}][${localIndex}][metode_daring]`] = daringText;
    rpsData[`sub_cpmk[${cpmkId}][${localIndex}][bentuk_pembelajaran]`] = sub.bentuk_pembelajaran || '';
    rpsData[`sub_cpmk[${cpmkId}][${localIndex}][strategi_pembelajaran]`] = sub.metode_pembelajaran || '';
    rpsData[`sub_cpmk[${cpmkId}][${localIndex}][media]`] = '';
    rpsData[`sub_cpmk[${cpmkId}][${localIndex}][sumber_belajar]`] = '';
    rpsData[`sub_cpmk[${cpmkId}][${localIndex}][alat_bahan]`] = '';
    rpsData[`sub_cpmk[${cpmkId}][${localIndex}][pengalaman_belajar]`] = '';
    rpsData[`sub_cpmk[${cpmkId}][${localIndex}][bentuk_penilaian]`] = '';
    const rawBobot = (sub.bobot || (weekDetail && weekDetail.bobot) || '0').toString();
    const bobotNormalized = rawBobot.replace(',', '.').match(/\d+(?:\.\d+)?/);
    rpsData[`sub_cpmk[${cpmkId}][${localIndex}][bobot]`] = bobotNormalized ? bobotNormalized[0] : '0';

    if (!teknikKriteria) {
      rpsData.extraction_notes.push(`Teknik & Kriteria Penilaian Sub-CPMK ${sub.globalSubNumber || localIndex} tidak terdeteksi jelas dari dokumen. Silakan lengkapi lewat Edit RPS.`);
    }
    if (!luringText) {
      rpsData.extraction_notes.push(`Metode Pembelajaran Luring Sub-CPMK ${sub.globalSubNumber || localIndex} tidak terdeteksi jelas dari dokumen. Silakan lengkapi lewat Edit RPS.`);
    }

    rpsData[`sub_cpmk[${cpmkId}][${localIndex}][formatif_nama]`] = sub.formatif_nama || '';
    rpsData[`sub_cpmk[${cpmkId}][${localIndex}][formatif_bobot]`] = sub.formatif_bobot || '';
    rpsData[`sub_cpmk[${cpmkId}][${localIndex}][sumatif_kuis_nama]`] = (sub.kuis && sub.kuis.nama) || '';
    rpsData[`sub_cpmk[${cpmkId}][${localIndex}][sumatif_kuis_bobot]`] = (sub.kuis && sub.kuis.bobot) || '';
    rpsData[`sub_cpmk[${cpmkId}][${localIndex}][sumatif_tugas_nama]`] = (sub.tugas && sub.tugas.nama) || '';
    rpsData[`sub_cpmk[${cpmkId}][${localIndex}][sumatif_tugas_bobot]`] = (sub.tugas && sub.tugas.bobot) || '';
    rpsData[`sub_cpmk[${cpmkId}][${localIndex}][sumatif_ujian_nama]`] = (sub.ujian && sub.ujian.nama) || '';
    rpsData[`sub_cpmk[${cpmkId}][${localIndex}][sumatif_ujian_bobot]`] = (sub.ujian && sub.ujian.bobot) || '';
    rpsData[`sub_cpmk[${cpmkId}][${localIndex}][sumatif_pjbl_nama]`] = (sub.pjbl && sub.pjbl.nama) || '';
    rpsData[`sub_cpmk[${cpmkId}][${localIndex}][sumatif_pjbl_bobot]`] = (sub.pjbl && sub.pjbl.bobot) || '';
    rpsData[`sub_cpmk[${cpmkId}][${localIndex}][sumatif_presentasi_nama]`] = (sub.presentasi && sub.presentasi.nama) || '';
    rpsData[`sub_cpmk[${cpmkId}][${localIndex}][sumatif_presentasi_bobot]`] = (sub.presentasi && sub.presentasi.bobot) || '';
    // "Lainnya" adalah daftar dinamis (nama+bobot bisa lebih dari satu),
    // disimpan sebagai JSON string di 1 field -- sama seperti isian yang
    // akan dikirim dari tombol "+" pada form Edit RPS (lihat edit-rps.js).
    rpsData[`sub_cpmk[${cpmkId}][${localIndex}][sumatif_lainnya]`] = JSON.stringify(
      (sub.lainnya || []).map(item => ({ nama: item.nama || '', bobot: item.bobot || '' }))
    );
    if (!sub.formatif_nama && !sub.kuis && !sub.tugas && !sub.ujian && !sub.pjbl && !sub.presentasi && !(sub.lainnya && sub.lainnya.length)) {
      rpsData.extraction_notes.push(`Bentuk Asesmen (Formatif/Sumatif) Sub-CPMK ${sub.globalSubNumber || localIndex} tidak terdeteksi jelas dari dokumen. Silakan lengkapi lewat Edit RPS.`);
    }

    const subCplCode = cpmkCplMap[cpmkId] || cplList[0] || '';
    if (subCplCode) {
      rpsData[`sub_cpmk[${cpmkId}][${localIndex}][cpl][]`] = [subCplCode];
    } else if (cplList.length) {
      rpsData[`sub_cpmk[${cpmkId}][${localIndex}][cpl][]`] = cplList;
    }
  });

  return rpsData;
}

// ---------------------------------------------------------------------------
// API publik (nama & tanda tangan fungsi dipertahankan supaya
// src/routes/index.js tidak perlu diubah)
// ---------------------------------------------------------------------------

// Jalur upload Word (.docx) -- struktur tabel di .docx eksplisit di datanya
// sendiri. Lihat README_PDF_EXTRACTION.md bagian "Jalur upload Word" untuk
// detail & batasannya.
async function parseRpsDocxBuffer(buffer, options = {}) {
  const tmpFile = path.join(os.tmpdir(), `rps-upload-${crypto.randomBytes(8).toString('hex')}.docx`);
  fs.writeFileSync(tmpFile, buffer);

  try {
    const extraction = runPythonExtractor(
      DOCX_PYTHON_SCRIPT,
      tmpFile,
      'python_docx_not_installed',
      'Modul Python "python-docx" belum terinstall di server. Jalankan: pip install -r requirements.txt (lihat README_PDF_EXTRACTION.md).'
    );
    const rpsData = buildRpsObjectFromExtraction(extraction, options);
    return { rpsData, parsedText: extraction.raw_text || '' };
  } finally {
    fs.unlink(tmpFile, () => {});
  }
}

module.exports = {
  parseRpsDocxBuffer,
  buildRpsObjectFromExtraction
};
