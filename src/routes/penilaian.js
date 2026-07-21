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

// ambil tahun angkatan dari kelasId, contoh "2025A" -> 2025, "2022B" -> 2022.
// dipakai krn field "tingkat" di kelas.json sebenarnya nyimpen tahun angkatan
// (misal 2025), BUKAN level 1-4 yg dihasilkan tingkatFromSemester(). jadi ga
// bisa dibandingkan langsung, harus dihitung ulang tiap kali dari tahun sekarang.
function angkatanFromKelasId(kelasId) {
  const match = String(kelasId).match(/^(\d{4})/);
  return match ? parseInt(match[1], 10) : null;
}

// tahun ajaran yg sedang berjalan sekarang: semester ganjil Agu-Des, genap Jan-Jul.
// dipakai sbg acuan buat hitung angkatan tsb sekarang ada di tingkat berapa.
function tahunAjaranSaatIni() {
  const now = new Date();
  const bulan = now.getMonth() + 1; // 1-12
  return bulan >= 8 ? now.getFullYear() : now.getFullYear() - 1;
}

// tingkat = selisih tahun ajaran skrg dgn tahun angkatan, +1.
// angkatan 2025 di tahun ajaran 2025 -> tingkat 1, angkatan 2024 -> tingkat 2, dst.
// di-cap 1-4 (S1 cuma 4 tingkat): angkatan yg lebih tua dari tingkat 4 (misal krn
// telat lulus/tinggal kelas & belum dipindahkan manual ke kelasId yg baru) tetap
// dianggap tingkat 4, bukan hilang dari daftar krn angkanya kelewat dari yg
// dicari tingkatFromSemester() (yg maksimal cuma sampai 4).
function tingkatFromAngkatan(angkatan) {
  if (!angkatan) return null;
  const tingkat = tahunAjaranSaatIni() - angkatan + 1;
  if (tingkat < 1) return 1;
  if (tingkat > 4) return 4;
  return tingkat;
}

// ambil huruf kelas (section) dari belakang kelasId, contoh "2025A" -> "A", "2024B" -> "B"
function letterFromKelasId(kelasId) {
  const match = String(kelasId).match(/[A-Za-z]+$/);
  return match ? match[0] : '';
}

// label kelas yg ditampilkan ke user, dihitung ulang tiap kali (BUKAN disimpan statis)
// krn tingkat-nya berubah tiap tahun ajaran baru. angkatan 2025 kelas A -> "1A" di
// tahun ajaran 2025, tapi jadi "2A" di tahun ajaran 2026, dst.
function labelKelasSaatIni(kelasId) {
  const tingkat = tingkatFromAngkatan(angkatanFromKelasId(kelasId));
  const letter = letterFromKelasId(kelasId);
  return tingkat ? `${tingkat}${letter}` : (letter || kelasId);
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
    cplCode: rpsItem[`cpmk[${sub.cpmkId}][cpl_code]`] || '',
    bentukPembelajaran: sub.bentuk_pembelajaran || '',
    metode: sub.metode || '',
    metodeLuring: sub.metode_luring || '',
    metodeDaring: sub.metode_daring || '',
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

// ubah nilai angka (0-100) jadi nilai huruf, sesuai skala:
// <40=E, 40-49=D, 50-54=C-, 55-59=C, 60-64=C+, 65-69=B-, 70-74=B, 75-79=B+, 80-84=A-, 85-100=A
function getNilaiHuruf(nilai) {
  const n = Number(nilai) || 0;
  if (n >= 85) return 'A';
  if (n >= 80) return 'A-';
  if (n >= 75) return 'B+';
  if (n >= 70) return 'B';
  if (n >= 65) return 'B-';
  if (n >= 60) return 'C+';
  if (n >= 55) return 'C';
  if (n >= 50) return 'C-';
  if (n >= 40) return 'D';
  return 'E';
}

// konversi nilai huruf -> bobot (dipakai spt IPK). E tidak punya bobot (dianggap 0).
const BOBOT_PER_HURUF = {
  A: 4.00,
  'A-': 3.75,
  'B+': 3.25,
  B: 3.00,
  'B-': 2.75,
  'C+': 2.50,
  C: 2.00,
  'C-': 1.50,
  D: 1.00,
  E: 0
};
function getBobot(huruf) {
  return Object.prototype.hasOwnProperty.call(BOBOT_PER_HURUF, huruf) ? BOBOT_PER_HURUF[huruf] : 0;
}

function buildRekapData(mahasiswaList, subCpmkList, savedValues) {
  const subCpmkColumns = subCpmkList.map((sub) => ({
    key: `subcpmk-${sub.globalNumber}`,
    label: `Sub-CPMK ${sub.globalNumber}`
  }));

  const rows = [];

  mahasiswaList.forEach((m) => {
    const subCpmkScores = {};

    subCpmkList.forEach((sub) => {
      const entries = [];
      const components = [
        { key: 'kuis', bobot: sub.kuisBobot, name: sub.kuisNama },
        { key: 'tugas', bobot: sub.tugasBobot, name: sub.tugasNama },
        { key: 'ujian', bobot: sub.ujianBobot, name: sub.ujianNama },
        { key: 'pjbl', bobot: sub.pjblBobot, name: sub.pjblNama },
        { key: 'presentasi', bobot: sub.presentasiBobot, name: sub.presentasiNama }
      ];

      components.forEach((component) => {
        const hasDefinition = !!(component.bobot || component.name);
        if (!hasDefinition) return;

        // dipakai NIM (bukan m.id) sbg kunci penyimpanan nilai, krn m.id ikut berubah
        // kalau mahasiswa dipindah kelasId (misal krn tinggal kelas). NIM tetap sama
        // apapun kelasnya, jadi nilai yg udah diinput ga ke-orphan pas dipindah.
        const fieldName = `nilai[${sub.globalNumber}][${m.nim}][${component.key}]`;
        const rawValue = savedValues[fieldName];
        const value = parseFloat(rawValue);
        if (!Number.isNaN(value)) {
          const bobot = parseFloat(component.bobot) || 0;
          entries.push({ value, bobot: bobot > 0 ? bobot : 1 });
        }
      });

      (sub.lainnya || []).forEach((item, lIdx) => {
        if (!item.bobot) return;
        const fieldName = `nilai[${sub.globalNumber}][${m.nim}][lainnya][${lIdx}]`;
        const rawValue = savedValues[fieldName];
        const value = parseFloat(rawValue);
        if (!Number.isNaN(value)) {
          entries.push({ value, bobot: parseFloat(item.bobot) || 0 });
        }
      });

      const totalBobot = entries.reduce((sum, entry) => sum + entry.bobot, 0);
      const weightedGrade = entries.reduce((sum, entry) => sum + (entry.value * entry.bobot), 0);
      const nilaiAkhir = totalBobot > 0 ? (weightedGrade / totalBobot) : 0;

      subCpmkScores[`subcpmk-${sub.globalNumber}`] = {
        label: `Sub-CPMK ${sub.globalNumber}`,
        nilaiAkhir
      };
    });

    // Nilai Akhir keseluruhan = rata-rata semua nilai Sub-CPMK (CPMK 1..N), dikali 90%.
    // 90% krn 10% utk absensi yg belum diimplementasikan.
    // Jika semua Sub-CPMK dapat nilai 100, maka nilai maksimal = 90
    const cpmkScores = Object.values(subCpmkScores).map((s) => s.nilaiAkhir);
    const avgCpmk = cpmkScores.length > 0
      ? cpmkScores.reduce((sum, val) => sum + val, 0) / cpmkScores.length
      : 0;
    const nilaiAkhirKeseluruhan = avgCpmk;
    const nilaiAkhirHuruf = getNilaiHuruf(nilaiAkhirKeseluruhan);
    const bobot = getBobot(nilaiAkhirHuruf);

    rows.push({
      id: m.id,
      nim: m.nim,
      nama: m.nama,
      subCpmkScores,
      nilaiAkhirKeseluruhan,
      nilaiAkhirHuruf,
      bobot
    });
  });

  return {
    subCpmkColumns,
    rows
  };
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

  // semua data kelas, nanti difilter per tingkat di javascript.
  // tingkatSaatIni & labelSaatIni dihitung ulang dari tahun angkatan (bukan pakai
  // field "tingkat"/"nama" yg tersimpan statis di kelas.json, krn keduanya harus
  // berubah tiap tahun ajaran seiring mahasiswa naik tingkat).
  const kelasData = readJsonFile(kelasPath, []).map(k => ({
    ...k,
    tingkatSaatIni: tingkatFromAngkatan(angkatanFromKelasId(k.id)),
    labelSaatIni: labelKelasSaatIni(k.id)
  }));

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
  const kelasList = readJsonFile(kelasPath, [])
    .filter(k => tingkatFromAngkatan(angkatanFromKelasId(k.id)) === tingkat);

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

  // Calculate CPL row spans
  let i = 0;
  while (i < subCpmkList.length) {
    let j = i + 1;
    while (j < subCpmkList.length && subCpmkList[j].cplCode === subCpmkList[i].cplCode) {
      j++;
    }
    subCpmkList[i].cplRowSpan = j - i;
    for (let k = i + 1; k < j; k++) {
      subCpmkList[k].cplRowSpan = 0;
    }
    i = j;
  }

  // Calculate CPMK row spans
  i = 0;
  while (i < subCpmkList.length) {
    let j = i + 1;
    while (j < subCpmkList.length && subCpmkList[j].cpmkId === subCpmkList[i].cpmkId) {
      j++;
    }
    subCpmkList[i].cpmkRowSpan = j - i;
    for (let k = i + 1; k < j; k++) {
      subCpmkList[k].cpmkRowSpan = 0;
    }
    i = j;
  }

  // Calculate Formatif row spans (merge if identical formatifNama)
  i = 0;
  while (i < subCpmkList.length) {
    let j = i + 1;
    while (j < subCpmkList.length && subCpmkList[j].formatifNama === subCpmkList[i].formatifNama && subCpmkList[i].formatifNama !== '') {
      j++;
    }
    subCpmkList[i].formatifRowSpan = j - i;
    for (let k = i + 1; k < j; k++) {
      subCpmkList[k].formatifRowSpan = 0;
    }
    i = j;
  }

  // Dynamic Sumatif columns detection
  const activeSumatifCols = [];
  const standards = [
    { key: 'tugas', label: 'Tugas' },
    { key: 'kuis', label: 'Kuis' },
    { key: 'presentasi', label: 'Presentasi' },
    { key: 'pjbl', label: 'PjBL' },
    { key: 'ujian', label: 'Ujian' }
  ];

  standards.forEach(std => {
    const hasBobot = subCpmkList.some(sub => {
      const bobotField = `${std.key}Bobot`;
      return sub[bobotField] && parseFloat(sub[bobotField]) > 0;
    });
    if (hasBobot) {
      activeSumatifCols.push({ key: std.key, label: std.label, isDynamic: false });
    }
  });

  const dynamicNames = new Set();
  subCpmkList.forEach(sub => {
    (sub.lainnya || []).forEach(item => {
      if (item.nama && item.bobot && parseFloat(item.bobot) > 0) {
        const catName = item.nama.replace(/\s*\d+\s*$/, '').trim();
        if (catName) {
          dynamicNames.add(catName);
        }
      }
    });
  });

  dynamicNames.forEach(name => {
    if (!activeSumatifCols.some(col => col.label.toLowerCase() === name.toLowerCase())) {
      activeSumatifCols.push({ key: `lainnya_${name.toLowerCase()}`, label: name, isDynamic: true, rawName: name });
    }
  });

  // cari record nilai yg mungkin udah pernah disimpan sebelumnya utk kombinasi RPS+kelas
  const penilaianAll = readJsonFile(penilaianPath, []);
  const record = penilaianAll.find(p => String(p.rpsId) === String(item.id) && p.kelasId === kelasId);
  // kalau ada, savedValues diisi nilai2 yg pernah diinput, kalau belum pernah, objek kosong
  const savedValues = record ? record.values : {};
  // komentar portofolio per mahasiswa per Sub-CPMK, disimpan terpisah dari nilai
  const savedComments = record ? (record.komentar || {}) : {};
  const rekapSummary = buildRekapData(mahasiswaList, subCpmkList, savedValues);
  const rekapData = rekapSummary.rows;
  const rekapColumns = rekapSummary.subCpmkColumns;
  const activeTab = req.query.activeTab && /^(tb-panel-(?:rekap|\d+))$/.test(req.query.activeTab)
    ? req.query.activeTab
    : 'tb-panel-1';

  // Get all RPS items in the same semester
  const semesterRpsList = rps.filter(r => String(r.semester) === String(item.semester));

  // Build the list of all courses in the semester with their respective Sub-CPMKs
  const rpsListWithSubCpmk = semesterRpsList.map(r => {
    return {
      id: r.id,
      nama_mk: r.nama_mk || '(Tanpa nama)',
      kode_mk: r.kode_mk || '',
      subCpmkList: buildSubCpmkListForPenilaian(r)
    };
  });

  // Collect all comments from penilaian.json for all courses in this semester for the current class
  const allSavedComments = {};
  semesterRpsList.forEach(r => {
    const rec = penilaianAll.find(p => String(p.rpsId) === String(r.id) && p.kelasId === kelasId);
    allSavedComments[r.id] = rec ? (rec.komentar || {}) : {};
  });

  // Calculate final grade records (rekap data) for all courses in this semester for all students
  const rekapDataByMk = {};
  rpsListWithSubCpmk.forEach(mk => {
    const rec = penilaianAll.find(p => String(p.rpsId) === String(mk.id) && p.kelasId === kelasId);
    const mkSavedValues = rec ? (rec.values || {}) : {};
    const summary = buildRekapData(mahasiswaList, mk.subCpmkList, mkSavedValues);
    rekapDataByMk[mk.id] = summary.rows;
  });

  res.render('penilaian-tabel', {
    title: 'Tabel Penilaian',
    user: req.session.user,
    rpsItem: item,
    kelas,
    kelasLabel: labelKelasSaatIni(kelas.id), // contoh: "1A" (angkatan 2025), dihitung ulang tiap request
    mahasiswaList,
    subCpmkList,
    activeSumatifCols,
    rpsListWithSubCpmk,
    allSavedComments,
    rekapDataByMk,
    savedValues, // dipakai di view buat isi ulang nilai yg sudah pernah diinput
    savedComments, // dipakai di view buat isi ulang komentar portofolio yg sudah pernah diinput
    rekapData,
    rekapColumns,
    activeTab,
    saved: req.query.saved === '1' // flag untuk menampilkan notif "berhasil disimpan"
  });
});

// ROUTE 5. proses submit form nilai. field-nya dikirim dgn nama kayak:
// nilai[3][20250101][kuis]  ->  artinya nilai Kuis, Sub-CPMK nomor 3, mahasiswa NIM "20250101"
router.post('/penilaian/mk/:rpsId/kelas/:kelasId/save', isAuthenticated, (req, res) => {
  const rps = readJsonFile(rpsPath, []);
  const item = rps.find(r => String(r.id) === String(req.params.rpsId));

  if (!canAccessRpsForPenilaian(req, item)) {
    return res.status(404).send('Mata kuliah tidak ditemukan atau Anda tidak memiliki akses.');
  }

  const kelasId = req.params.kelasId;

  // saring req.body: cuma field yg namanya nilai[angka][nim][komponen] akan diambil.
  const values = {};
  Object.keys(req.body).forEach(key => {
    if (
      /^nilai\[\d+\]\[[^\]]+\]\[(formatif|kuis|tugas|ujian|pjbl|presentasi)\]$/.test(key) ||
      /^nilai\[\d+\]\[[^\]]+\]\[lainnya\]\[\d+\]$/.test(key)
    ) {
      values[key] = req.body[key];
    }
  });

  // saring lagi field komentar portofolio, formatnya: komentar[<rpsId>][<subCpmkGlobalNumber>][<nim>]
  const komentarByRps = {};
  Object.keys(req.body).forEach(key => {
    const match = key.match(/^komentar\[(\d+)\]\[(\d+)\]\[([^\]]+)\]$/);
    if (match) {
      const rpsIdStr = match[1];
      const subNum = match[2];
      const nim = match[3];
      if (!komentarByRps[rpsIdStr]) {
        komentarByRps[rpsIdStr] = {};
      }
      komentarByRps[rpsIdStr][`komentar[${subNum}][${nim}]`] = req.body[key];
    }
  });

  const penilaianAll = readJsonFile(penilaianPath, []);
  
  // 1. Process active/current course record (including grades/values and comments)
  const currentRpsIdStr = String(item.id);
  const currentKomentar = komentarByRps[currentRpsIdStr] || {};
  const existingIndex = penilaianAll.findIndex(p => String(p.rpsId) === currentRpsIdStr && p.kelasId === kelasId);

  const currentRecord = {
    id: existingIndex >= 0 ? penilaianAll[existingIndex].id : (penilaianAll.reduce((max, p) => Math.max(max, p.id || 0), 0) + 1),
    rpsId: item.id,
    kelasId,
    values, // replacing current values
    komentar: {
      ...(existingIndex >= 0 ? (penilaianAll[existingIndex].komentar || {}) : {}),
      ...currentKomentar // merging current comments
    },
    updated_at: new Date().toISOString(),
    updated_by: req.session.user.id
  };

  if (existingIndex >= 0) {
    penilaianAll[existingIndex] = currentRecord;
  } else {
    penilaianAll.push(currentRecord);
  }

  // 2. Process other courses comments in the same semester (only updating comments, not overriding other fields)
  Object.keys(komentarByRps).forEach(otherRpsIdStr => {
    if (otherRpsIdStr === currentRpsIdStr) return; // already updated above
    const otherRpsId = parseInt(otherRpsIdStr, 10);
    const otherKomentar = komentarByRps[otherRpsIdStr];
    
    const otherIndex = penilaianAll.findIndex(p => String(p.rpsId) === otherRpsIdStr && p.kelasId === kelasId);
    if (otherIndex >= 0) {
      penilaianAll[otherIndex].komentar = {
        ...(penilaianAll[otherIndex].komentar || {}),
        ...otherKomentar
      };
      penilaianAll[otherIndex].updated_at = new Date().toISOString();
      penilaianAll[otherIndex].updated_by = req.session.user.id;
    } else {
      const newRecord = {
        id: penilaianAll.reduce((max, p) => Math.max(max, p.id || 0), 0) + 1,
        rpsId: otherRpsId,
        kelasId,
        values: {},
        komentar: otherKomentar,
        updated_at: new Date().toISOString(),
        updated_by: req.session.user.id
      };
      penilaianAll.push(newRecord);
    }
  });

  writeJsonFile(penilaianPath, penilaianAll);

  const activeTab = typeof req.body.activeTab === 'string' && /^(tb-panel-(?:rekap|\d+))$/.test(req.body.activeTab)
    ? req.body.activeTab
    : 'tb-panel-1';

  // arahkan balik ke halaman tabel yg sama, dgn ?saved=1 supaya notif sukses muncul
  res.redirect(`/penilaian/mk/${item.id}/kelas/${kelasId}?saved=1&activeTab=${encodeURIComponent(activeTab)}`);
});

module.exports = router; // ekspor router ini biar bisa dipasang di src/index.js