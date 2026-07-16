const express = require('express');
const router = express.Router(); // wadah kumpulan route (url) khusus fitur penilaian
const fs = require('fs');
const path = require('path');

// alamat file2 database yg dipakai fitur ini
const rpsPath = path.join(__dirname, '..', 'database', 'rps.json');
const kelasPath = path.join(__dirname, '..', 'database', 'kelas.json');
const mahasiswaPath = path.join(__dirname, '..', 'database', 'mahasiswa.json');
const penilaianPath = path.join(__dirname, '..', 'database', 'penilaian.json'); // tempat nilai mahasiswa disimpan

// baca file json dari disk. kalau belum ada/rusak/kosong, balikin fallbackValue (misal [])
// biar aplikasi tidak crash.
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

// tulis data javascript (array/object) jadi teks json, simpan ke file.
function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// tolak kalau belum login, lempar ke /login.
function isAuthenticated(req, res, next) {
  if (req.session.user) {
    return next();
  }
  res.redirect('/login');
}

// ubah nomor semester jadi "tingkat" angkatan. contoh: semester 1 atau 2 -> tingkat 1,
// semester 3 atau 4 -> tingkat 2, dst. dipakai buat nyamain mata kuliah semester tertentu
// dengan kelas yg levelnya sesuai (data kelas dikelompokkan per tingkat, bukan per semester persis).
function tingkatFromSemester(semester) {
  const s = parseInt(semester, 10);
  if (!s || s < 1) return null;
  return Math.ceil(s / 2); // 1-2 -> 1, 3-4 -> 2, 5-6 -> 3, 7-8 -> 4
}

// cek: user yg login boleh nilai RPS ini apa tidak. hasilnya true kalau admin, atau
// kalau dia pemilik RPS itu sendiri. selain itu false.
function canAccessRpsForPenilaian(req, rpsItem) {
  if (!rpsItem) return false;
  if (req.session.user.role === 'admin') return true;
  return String(rpsItem.userId) === String(req.session.user.id);
}

// FUNGSI PALING PENTING
// tugas: ambil 1 RPS (rpsItem), lalu susun ulang jadi daftar Sub-CPMK yg rapi & bernomor,
// lengkap sama nama+bobot Formatif/Sumatif (Kuis/Tugas/Ujian/dst) masing-masing.
// hasilnya nanti dipakai buat bikin tab "Sub-CPMK 1", "Sub-CPMK 2", dst di halaman tabel penilaian.
//
// perlu disusun ulang krn di dalam RPS, data Sub-CPMK itu tidak disimpan sebagai
// 1 array yg rapi dia disimpan sebagai banyak field terpisah dengan nama seperti:
//   "sub_cpmk[CPMK01][1][deskripsi]"       = "Mahasiswa mampu ..."
//   "sub_cpmk[CPMK01][1][sumatif_kuis_bobot]" = "10"
//   "sub_cpmk[CPMK02][1][deskripsi]"       = "Mahasiswa mampu ..."
//   ...dst, ratusan field kayak gini tercampur jadi satu di objek rpsItem.
// jadi field2 yg "senasib" (sama CPMK & sama nomor lokalnya) harus dikumpulkan jadi 1 objek.
function buildSubCpmkListForPenilaian(rpsItem) {
  // LANGKAH 1: kumpulkan field yg "senasib" jadi 1 objek per Sub-CPMK.
  // byKey nantinya isinya kayak: { "CPMK01__1": {deskripsi:"...", sumatif_kuis_bobot:"10", ...}, "CPMK01__2": {...} }
  const byKey = {};
  Object.keys(rpsItem).forEach(key => {
    // cocokkan nama field dgn pola "sub_cpmk[CPMKxx][angka][nama_field]".
    // match[1] = kode cpmk (misal "CPMK01"), match[2] = nomor lokal (misal "1"), match[3] = nama field (misal "deskripsi")
    const match = key.match(/^sub_cpmk\[(CPMK\d+)\]\[(\d+)\]\[(.+)\]$/);
    if (!match) return; // field ini bukan data sub-cpmk (misal nama_mk, semester, dll), lewati
    const cpmkId = match[1];
    const localIndex = match[2];
    const field = match[3];
    const uniqueKey = `${cpmkId}__${localIndex}`; // kunci unik per sub-cpmk, misal "CPMK01__1"
    if (!byKey[uniqueKey]) {
      byKey[uniqueKey] = { cpmkId, localIndex: parseInt(localIndex, 10) || 0 };
    }
    byKey[uniqueKey][field] = rpsItem[key]; // taruh nilainya di field yg sesuai
  });

  // LANGKAH 2: urutkan supaya tampil rapi CPMK01 duluan baru CPMK02, dst,
  // dan di dalam 1 CPMK, urut sesuai nomor lokalnya.
  const rawList = Object.values(byKey);
  rawList.sort((a, b) => {
    if (a.cpmkId !== b.cpmkId) return a.cpmkId.localeCompare(b.cpmkId, undefined, { numeric: true });
    return a.localIndex - b.localIndex;
  });

  // LANGKAH 3: ubah tiap objek mentah jadi bentuk akhir yg dipakai tampilan (view).
  // globalNumber (nomor tab 1,2,3,...) dihitung ulang di sini dari urutan di atas
  // (idx + 1), bukan pakai field "global_number" yg tersimpan di RPS
  return rawList.map((sub, idx) => ({
    globalNumber: idx + 1, // <- ini yg dipakai sbg nomor tab "Sub-CPMK 1", "Sub-CPMK 2", dst
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
    // field "lainnya" disimpan di RPS sbg TEKS json (string), bukan array asli, jadi harus
    // di-parse dulu pakai JSON.parse. dibungkus try/catch: kalau teksnya rusak/bukan json valid,
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

function buildRekapData(mahasiswaList, subCpmkList, savedValues) {
  return mahasiswaList.map((m) => {
    const subScores = [];

    subCpmkList.forEach((sub) => {
      const entries = [];

      const components = [
        { key: 'formatif', bobot: sub.formatifBobot },
        { key: 'kuis', bobot: sub.kuisBobot },
        { key: 'tugas', bobot: sub.tugasBobot },
        { key: 'ujian', bobot: sub.ujianBobot },
        { key: 'pjbl', bobot: sub.pjblBobot },
        { key: 'presentasi', bobot: sub.presentasiBobot }
      ];

      components.forEach((component) => {
        if (!component.bobot) return;
        const fieldName = `nilai[${sub.globalNumber}][${m.id}][${component.key}]`;
        const rawValue = savedValues[fieldName];
        const value = parseFloat(rawValue);
        if (!Number.isNaN(value)) {
          entries.push({ value, bobot: parseFloat(component.bobot) || 0 });
        }
      });

      (sub.lainnya || []).forEach((item, lIdx) => {
        if (!item.bobot) return;
        const fieldName = `nilai[${sub.globalNumber}][${m.id}][lainnya][${lIdx}]`;
        const rawValue = savedValues[fieldName];
        const value = parseFloat(rawValue);
        if (!Number.isNaN(value)) {
          entries.push({ value, bobot: parseFloat(item.bobot) || 0 });
        }
      });

      if (entries.length === 0) return;

      const totalBobot = entries.reduce((sum, entry) => sum + entry.bobot, 0);
      const weightedScore = entries.reduce((sum, entry) => sum + (entry.value * entry.bobot), 0);
      subScores.push(totalBobot > 0 ? weightedScore / totalBobot : 0);
    });

    const nilaiAkhir = subScores.length > 0
      ? subScores.reduce((sum, score) => sum + score, 0) / subScores.length
      : 0;

    let status = 'Belum dinilai';
    if (nilaiAkhir > 0) {
      status = nilaiAkhir >= 75 ? 'Lulus' : 'Remedial';
    }

    return {
      id: m.id,
      nim: m.nim,
      nama: m.nama,
      nilaiAkhir,
      status
    };
  });
}

// ROUTE 1. halaman utama /penilaian: 3 dropdown berantai (Semester -> Mata Kuliah -> Kelas).
// semua data yg dibutuhkann dropdown (matkulData & kelasData) dikirim sekaligus ke halaman,
// jadi javascript di browser bisa langsung filter tanpa perlu request ke server lagi tiap ganti pilihan.
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

  const kelasData = readJsonFile(kelasPath, []); // semua data kelas, nanti difilter per tingkat di javascript

  res.render('penilaian-semester', {
    title: 'Penilaian',
    user: req.session.user,
    matkulData,
    kelasData
  });
});

// ROUTE 2. route ini tdk pernah diakses lewat tampilan aplikasi
// (halaman /penilaian sudah cascading sendiri pakai javascript, langsung loncat ke ROUTE 4
// di bawah). ini semacam "jalur alternatif" yg masih ada di kode tapi tidak terpakai.
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

// ROUTE 3. sama kayak ROUTE 2, juga tidak terpakai dari tampilan aplikasi.
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

// ROUTE 4. untuk menampilkan tabel penilaian (1 tab per Sub-CPMK),
// otomatis terisi nilai lama kalau memang sudah pernah disimpan sebelumnya.
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

  // ambil daftar mahasiswa yg ada di kelas terpilih
  const mahasiswaList = readJsonFile(mahasiswaPath, []).filter(m => m.kelasId === kelasId);
  // susun ulang Sub-CPMK dari RPS
  const subCpmkList = buildSubCpmkListForPenilaian(item);

  // cari record nilai yg mungkin udah pernah disimpan sebelumnya utk kombinasi RPS+kelas
  const penilaianAll = readJsonFile(penilaianPath, []);
  const record = penilaianAll.find(p => String(p.rpsId) === String(item.id) && p.kelasId === kelasId);
  // kalau ada, savedValues diisi nilai2 yg pernah diinput, kalau belum pernah, objek kosong
  const savedValues = record ? record.values : {};
  const rekapData = buildRekapData(mahasiswaList, subCpmkList, savedValues);
  const activeTab = req.query.activeTab && /^(tb-panel-(?:rekap|\d+))$/.test(req.query.activeTab)
    ? req.query.activeTab
    : 'tb-panel-1';

  res.render('penilaian-tabel', {
    title: 'Tabel Penilaian',
    user: req.session.user,
    rpsItem: item,
    kelas,
    mahasiswaList,
    subCpmkList,
    savedValues, // dipakai di view buat isi ulang nilai yg sudah pernah diinput
    rekapData,
    activeTab,
    saved: req.query.saved === '1' // flag untuk menampilkan notif "berhasil disimpan"
  });
});

// ROUTE 5. proses submit form nilai. field-nya dikirim dgn nama kayak:
// nilai[3][mhs007][kuis]  ->  artinya nilai Kuis, Sub-CPMK nomor 3, mahasiswa id "mhs007"
router.post('/penilaian/mk/:rpsId/kelas/:kelasId/save', isAuthenticated, (req, res) => {
  const rps = readJsonFile(rpsPath, []);
  const item = rps.find(r => String(r.id) === String(req.params.rpsId));

  if (!canAccessRpsForPenilaian(req, item)) {
    return res.status(404).send('Mata kuliah tidak ditemukan atau Anda tidak memiliki akses.');
  }

  const kelasId = req.params.kelasId;

  // saring req.body: cuma field yg namanya nilai[angka][id][komponen] akan diambil.
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
  // cari apakah kombinasi RPS+kelas ini sudah pernah punya record nilai sebelumnya
  const existingIndex = penilaianAll.findIndex(p => String(p.rpsId) === String(item.id) && p.kelasId === kelasId);

  const record = {
    // kalau sudah ada sebelumnya, pakai id lama (biar tetap 1 record yg sama, bukan bikin duplikat).
    // kalau belum ada, bikin id baru = id terbesar + 1.
    id: existingIndex >= 0 ? penilaianAll[existingIndex].id : (penilaianAll.reduce((max, p) => Math.max(max, p.id || 0), 0) + 1),
    rpsId: item.id,
    kelasId,
    values, // seluruh nilai yg baru diinput menggantikan nilai lama
    updated_at: new Date().toISOString(),
    updated_by: req.session.user.id
  };

  if (existingIndex >= 0) {
    penilaianAll[existingIndex] = record; // timpa record lama
  } else {
    penilaianAll.push(record); // record baru, tambahkan ke daftar
  }

  writeJsonFile(penilaianPath, penilaianAll);

  const activeTab = typeof req.body.activeTab === 'string' && /^(tb-panel-(?:rekap|\d+))$/.test(req.body.activeTab)
    ? req.body.activeTab
    : 'tb-panel-1';

  // arahkan balik ke halaman tabel yg sama, dgn ?saved=1 supaya notif sukses muncul
  res.redirect(`/penilaian/mk/${item.id}/kelas/${kelasId}?saved=1&activeTab=${encodeURIComponent(activeTab)}`);
});

module.exports = router; // ekspor router ini biar bisa dipasang di src/index.js
