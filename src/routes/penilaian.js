const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const rpsPath = path.join(__dirname, '..', 'database', 'rps.json');
const kelasPath = path.join(__dirname, '..', 'database', 'kelas.json');
const mahasiswaPath = path.join(__dirname, '..', 'database', 'mahasiswa.json');
const penilaianPath = path.join(__dirname, '..', 'database', 'penilaian.json');

function readJsonFile(filePath, fallbackValue) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(fallbackValue, null, 2));
      return Array.isArray(fallbackValue) ? [...fallbackValue] : { ...fallbackValue };
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) {
      return Array.isArray(fallbackValue) ? [...fallbackValue] : { ...fallbackValue };
    }
    return JSON.parse(raw);
  } catch (error) {
    console.error(`Gagal membaca file JSON: ${filePath}`, error);
    return Array.isArray(fallbackValue) ? [...fallbackValue] : { ...fallbackValue };
  }
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function isAuthenticated(req, res, next) {
  if (req.session.user) {
    return next();
  }
  res.redirect('/login');
}

function tingkatFromSemester(semester) {
  const s = parseInt(semester, 10);
  if (!s || s < 1) return null;
  return Math.ceil(s / 2); // 1-2 -> 1, 3-4 -> 2, 5-6 -> 3, 7-8 -> 4
}

function canAccessRpsForPenilaian(req, rpsItem) {
  if (!rpsItem) return false;
  if (req.session.user.role === 'admin') return true;
  return String(rpsItem.userId) === String(req.session.user.id);
}

// Kelompokkan field flat "sub_cpmk[CPMKxx][n][field]" milik satu RPS menjadi
// daftar Sub-CPMK (TB) berurutan, lengkap dengan bobot Formatif & Sumatif
// (Kuis/Tugas/Ujian) yang sudah tersimpan di RPS.
//
// CATATAN: field "global_number" yang tersimpan di RPS TIDAK bisa diandalkan
// untuk penomoran (kadang tidak pernah diisi -> selalu 0, kadang cuma reset
// ulang per-CPMK -> duplikat seperti 1,1,1,2,2,3). Jadi nomor tab di halaman
// ini dihitung ulang dari nol secara berurutan berdasarkan urutan CPMK
// (CPMK01, CPMK02, ...) lalu urutan Sub-CPMK di dalamnya, supaya selalu unik.
function buildSubCpmkListForPenilaian(rpsItem) {
  const byKey = {};
  Object.keys(rpsItem).forEach(key => {
    const match = key.match(/^sub_cpmk\[(CPMK\d+)\]\[(\d+)\]\[(.+)\]$/);
    if (!match) return;
    const cpmkId = match[1];
    const localIndex = match[2];
    const field = match[3];
    const uniqueKey = `${cpmkId}__${localIndex}`;
    if (!byKey[uniqueKey]) {
      byKey[uniqueKey] = { cpmkId, localIndex: parseInt(localIndex, 10) || 0 };
    }
    byKey[uniqueKey][field] = rpsItem[key];
  });

  const rawList = Object.values(byKey);
  // Urutkan berdasarkan kode CPMK (CPMK01 < CPMK02 < ...) lalu posisi lokal di dalamnya.
  rawList.sort((a, b) => {
    if (a.cpmkId !== b.cpmkId) return a.cpmkId.localeCompare(b.cpmkId, undefined, { numeric: true });
    return a.localIndex - b.localIndex;
  });

  return rawList.map((sub, idx) => ({
    globalNumber: idx + 1,
    cpmkId: sub.cpmkId,
    deskripsi: sub.deskripsi || '',
    pekanAwal: sub.pekan_awal || '',
    pekanAkhir: sub.pekan_akhir || '',
    formatifNama: sub.formatif_nama || '',
    formatifBobot: sub.formatif_bobot || '',
    kuisNama: sub.sumatif_kuis_nama || '',
    kuisBobot: sub.sumatif_kuis_bobot || '',
    tugasNama: sub.sumatif_tugas_nama || '',
    tugasBobot: sub.sumatif_tugas_bobot || '',
    ujianNama: sub.sumatif_ujian_nama || '',
    ujianBobot: sub.sumatif_ujian_bobot || '',
    pjblNama: sub.sumatif_pjbl_nama || '',
    pjblBobot: sub.sumatif_pjbl_bobot || '',
    presentasiNama: sub.sumatif_presentasi_nama || '',
    presentasiBobot: sub.sumatif_presentasi_bobot || '',
    lainnya: (() => {
      try {
        const parsed = JSON.parse(sub.sumatif_lainnya || '[]');
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        return [];
      }
    })()
  }));
}

// Halaman utama Penilaian: satu halaman dengan 3 dropdown beranting
// (Semester -> Mata Kuliah -> Kelas), semuanya bereaksi via JS tanpa reload.
router.get('/penilaian', isAuthenticated, (req, res) => {
  const rps = readJsonFile(rpsPath, []);
  let accessibleRps = rps;
  if (req.session.user.role !== 'admin') {
    accessibleRps = rps.filter(r => String(r.userId) === String(req.session.user.id));
  }

  const matkulData = accessibleRps
    .filter(r => r.semester)
    .map(r => ({
      id: r.id,
      nama_mk: r.nama_mk || '(Tanpa nama)',
      kode_mk: r.kode_mk || '',
      semester: parseInt(r.semester, 10) || 0
    }));

  const kelasData = readJsonFile(kelasPath, []);

  res.render('penilaian-semester', {
    title: 'Penilaian',
    user: req.session.user,
    matkulData,
    kelasData
  });
});

// Step 2: pilih mata kuliah pada semester tsb (admin = semua, dosen = milik sendiri)
router.get('/penilaian/semester/:semester', isAuthenticated, (req, res) => {
  const semester = req.params.semester;
  const rps = readJsonFile(rpsPath, []);

  let matkulList = rps.filter(r => String(r.semester) === String(semester));
  if (req.session.user.role !== 'admin') {
    matkulList = matkulList.filter(r => String(r.userId) === String(req.session.user.id));
  }

  res.render('penilaian-matkul', {
    title: 'Penilaian - Pilih Mata Kuliah',
    user: req.session.user,
    semester,
    matkulList
  });
});

// Step 3: pilih kelas (2 opsi sesuai tingkat dari semester matkul tsb)
router.get('/penilaian/mk/:rpsId', isAuthenticated, (req, res) => {
  const rps = readJsonFile(rpsPath, []);
  const item = rps.find(r => String(r.id) === String(req.params.rpsId));

  if (!canAccessRpsForPenilaian(req, item)) {
    return res.status(404).send('Mata kuliah tidak ditemukan atau Anda tidak memiliki akses.');
  }

  const tingkat = tingkatFromSemester(item.semester);
  const kelasList = readJsonFile(kelasPath, []).filter(k => k.tingkat === tingkat);

  res.render('penilaian-kelas', {
    title: 'Penilaian - Pilih Kelas',
    user: req.session.user,
    rpsItem: item,
    kelasList
  });
});

// Step 4: tabel penilaian (tab per Sub-CPMK/TB)
router.get('/penilaian/mk/:rpsId/kelas/:kelasId', isAuthenticated, (req, res) => {
  const rps = readJsonFile(rpsPath, []);
  const item = rps.find(r => String(r.id) === String(req.params.rpsId));

  if (!canAccessRpsForPenilaian(req, item)) {
    return res.status(404).send('Mata kuliah tidak ditemukan atau Anda tidak memiliki akses.');
  }

  const kelasId = req.params.kelasId;
  const kelas = readJsonFile(kelasPath, []).find(k => k.id === kelasId);
  if (!kelas) {
    return res.status(404).send('Kelas tidak ditemukan.');
  }

  const mahasiswaList = readJsonFile(mahasiswaPath, []).filter(m => m.kelasId === kelasId);
  const subCpmkList = buildSubCpmkListForPenilaian(item);

  const penilaianAll = readJsonFile(penilaianPath, []);
  const record = penilaianAll.find(p => String(p.rpsId) === String(item.id) && p.kelasId === kelasId);
  const savedValues = record ? record.values : {};

  res.render('penilaian-tabel', {
    title: 'Tabel Penilaian',
    user: req.session.user,
    rpsItem: item,
    kelas,
    mahasiswaList,
    subCpmkList,
    savedValues,
    saved: req.query.saved === '1'
  });
});

// Simpan nilai (form POST biasa, field pakai notasi kurung seperti bagian RPS lain:
// nilai[<subGlobalNumber>][<mahasiswaId>][formatif|kuis|tugas|ujian])
router.post('/penilaian/mk/:rpsId/kelas/:kelasId/save', isAuthenticated, (req, res) => {
  const rps = readJsonFile(rpsPath, []);
  const item = rps.find(r => String(r.id) === String(req.params.rpsId));

  if (!canAccessRpsForPenilaian(req, item)) {
    return res.status(404).send('Mata kuliah tidak ditemukan atau Anda tidak memiliki akses.');
  }

  const kelasId = req.params.kelasId;

  // Hanya simpan key yang memang berformat nilai[...][...][...], jaga-jaga
  // ada field lain (mis. csrf) yang ikut terkirim.
  const values = {};
  Object.keys(req.body).forEach(key => {
    if (
      /^nilai\[\d+\]\[[^\]]+\]\[(formatif|kuis|tugas|ujian|pjbl|presentasi)\]$/.test(key) ||
      /^nilai\[\d+\]\[[^\]]+\]\[lainnya\]\[\d+\]$/.test(key)
    ) {
      values[key] = req.body[key];
    }
  });

  const penilaianAll = readJsonFile(penilaianPath, []);
  const existingIndex = penilaianAll.findIndex(p => String(p.rpsId) === String(item.id) && p.kelasId === kelasId);

  const record = {
    id: existingIndex >= 0 ? penilaianAll[existingIndex].id : (penilaianAll.reduce((max, p) => Math.max(max, p.id || 0), 0) + 1),
    rpsId: item.id,
    kelasId,
    values,
    updated_at: new Date().toISOString(),
    updated_by: req.session.user.id
  };

  if (existingIndex >= 0) {
    penilaianAll[existingIndex] = record;
  } else {
    penilaianAll.push(record);
  }

  writeJsonFile(penilaianPath, penilaianAll);

  res.redirect(`/penilaian/mk/${item.id}/kelas/${kelasId}?saved=1`);
});

module.exports = router;
