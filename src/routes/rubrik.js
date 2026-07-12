const express = require('express');
const router = express.Router(); // wadah kumpulan route (url) khusus fitur rubrik, nanti digabung ke app utama di src/index.js
const fs = require('fs'); // buat baca/tulis file di disk (fs = "file system")
const path = require('path'); // buat nyusun alamat/path file dgn aman (biar ga masalah di windows vs linux)

// alamat file tempat data disimpan. __dirname = folder tempat file rubrik.js ini berada,
// jadi '..'  naik 1 folder ke src/, baru masuk ke database/rps.json
const rpsPath = path.join(__dirname, '..', 'database', 'rps.json');
const rubrikPath = path.join(__dirname, '..', 'database', 'rubrik.json');

// baca file json dari disk, ubah jadi array/object javascript biasa.
// kalau filenya belum ada, dibikin dulu isinya fallbackValue (misal []).
// kalau pas dibaca ternyata gagal/rusak, ga bikin error nge-crash, tapi balikin fallbackValue aja.
function readJsonFile(filePath, fallbackValue) {
  try {
    if (!fs.existsSync(filePath)) {
      // fs.existsSync -> cek file itu ada apa nggak. kalau nggak ada, bikin baru.
      fs.writeFileSync(filePath, JSON.stringify(fallbackValue, null, 2));
      return Array.isArray(fallbackValue) ? [...fallbackValue] : { ...fallbackValue };
    }
    const raw = fs.readFileSync(filePath, 'utf8'); // baca isi file sbg teks mentah
    if (!raw.trim()) {
      // file ada tapi isinya kosong -> anggap kayak belum ada, pakai fallback
      return Array.isArray(fallbackValue) ? [...fallbackValue] : { ...fallbackValue };
    }
    return JSON.parse(raw); // ubah teks json jadi array/object javascript
  } catch (error) {
    console.error(`Gagal membaca file JSON: ${filePath}`, error);
    return Array.isArray(fallbackValue) ? [...fallbackValue] : { ...fallbackValue };
  }
}

// kebalikan dari readJsonFile: ambil data javascript (array/object), ubah jadi teks json,
// terus timpa ke file di disk. null, 2 di sini artinya biar hasil json-nya rapi (ada indentasi).
function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// "penjaga pintu": dipasang di depan tiap route di bawah (lihat isAuthenticated di parameter
// router.get/post). kalau user belum login (req.session.user kosong), otomatis dilempar ke
// halaman /login, jadi ga bisa lanjut ke kode di dalam route-nya sama sekali.
function isAuthenticated(req, res, next) {
  if (req.session.user) {
    return next(); // next() artinya "lanjut, boleh masuk"
  }
  res.redirect('/login');
}

// cek: user yg lagi login ini boleh buka/ubah RPS yg dimaksud apa nggak.
// hasilnya: true (boleh) kalau dia admin, ATAU kalau dia pemilik RPS itu sendiri.
// selain itu (dosen lain yg bukan pemilik) hasilnya false -> ditolak di route yg makai fungsi ini.
function canAccessRps(req, rpsItem) {
  if (!rpsItem) return false; // rps-nya aja ga ketemu, otomatis ga boleh
  if (req.session.user.role === 'admin') return true;
  return String(rpsItem.userId) === String(req.session.user.id);
}

// fungsi ini nerima req.body (data mentah yg dikirim dari form html) dan ngerapiin jadi
// objek { nama, skala, kriteria } yg gampang dipakai.
// kenapa perlu dirapiin? soalnya form HTML ngirim data per-field flat, bentuknya kayak gini:
//   skala[0][skor]="4"  skala[0][label]="Sangat Baik"  skala[1][skor]="3" ...
//   kriteria[0][aspek]="Kelengkapan"  kriteria[0][deskripsi][0]="..." ...
// jadi field-nya harus "ditebak" satu-satu berdasarkan nomor index-nya.
function parseRubrikForm(body) {
  const nama = (body.nama || '').trim(); // .trim() = buang spasi kosong di awal/akhir

  // baca kolom skala satu-satu: cek skala[0] ada, masukin ke array, cek skala[1] ada, dst.
  // begitu skala[j] udah ga ada (undefined), loop berhenti -> berarti itu jumlah kolom skalanya.
  const skala = [];
  let j = 0;
  while (body[`skala[${j}][skor]`] !== undefined) {
    const skor = (body[`skala[${j}][skor]`] || '').trim();
    const label = (body[`skala[${j}][label]`] || '').trim();
    if (skor || label) skala.push({ skor, label }); // cuma dimasukin kalau ada isinya
    j++;
  }

  // sama polanya kayak skala: baca baris kriteria satu-satu sampai habis.
  // tiap kriteria punya beberapa "deskripsi" 1 deskripsi per kolom skala yg udah kebaca di atas.
  const kriteria = [];
  let i = 0;
  while (body[`kriteria[${i}][aspek]`] !== undefined) {
    const aspek = (body[`kriteria[${i}][aspek]`] || '').trim();
    const deskripsi = [];
    for (let k = 0; k < skala.length; k++) {
      deskripsi.push((body[`kriteria[${i}][deskripsi][${k}]`] || '').trim());
    }
    if (aspek) kriteria.push({ aspek, deskripsi });
    i++;
  }

  // hasil akhirnya: objek rapi siap dipakai/disimpan, contoh:
  // { nama: "Rubrik UAS", skala: [{skor:"4",label:"Baik"}, ...], kriteria: [{aspek:"...", deskripsi:["...","..."]}] }
  return { nama, skala, kriteria };
}

// ROUTE 1 halaman pertama fitur rubrik (URL: /rubrik).
// isinya cuma nampilin dropdown Semester & Mata Kuliah (dropdown-nya sendiri diisi & difilter
// pakai javascript di file rubrik-semester.ejs, bukan di sini). tugas route ini cuma nyiapin
// DATA mata kuliah apa aja yg boleh dipilih user ini, dikirim ke halaman itu.
router.get('/rubrik', isAuthenticated, (req, res) => {
  const rps = readJsonFile(rpsPath, []); // ambil SEMUA rps yg ada di database
  let accessibleRps = rps;
  if (req.session.user.role !== 'admin') {
    // kalau bukan admin, saring cuma RPS milik dia sendiri, dosen lain ga boleh keliatan di sini
    accessibleRps = rps.filter(r => String(r.userId) === String(req.session.user.id));
  }

  // dari semua RPS yg boleh diakses, ambil cuma info yg perlu ditampilkan di dropdown
  // (id, nama, kode, semester) ga usah kirim semua data RPS yg berat/panjang ke halaman.
  const matkulData = accessibleRps
    .filter(r => r.semester) // buang RPS yg semesternya belum diisi (ga jelas mau taruh di dropdown semester mana)
    .map(r => ({
      id: r.id,
      nama_mk: r.nama_mk || '(Tanpa nama)',
      kode_mk: r.kode_mk || '',
      semester: parseInt(r.semester, 10) || 0
    }));

  // render = "tampilkan halaman ini". matkulData dikirim ke rubrik-semester.ejs
  // supaya javascript di halaman itu bisa langsung filter tanpa nge-request ke server lagi.
  res.render('rubrik-semester', {
    title: 'Rubrik Penilaian',
    user: req.session.user,
    matkulData
  });
});

// ROUTE 2 halaman kedua (URL: /rubrik/mk/123, 123 = id RPS-nya). ini yg nampilin
// daftar rubrik yg sudah dibuat utk 1 mata kuliah, lengkap sama form tambah/edit.
router.get('/rubrik/mk/:rpsId', isAuthenticated, (req, res) => {
  // req.params.rpsId itu diambil dari URL, sesuai ":rpsId" di atas.
  // misal buka /rubrik/mk/123, maka req.params.rpsId = "123"
  const rps = readJsonFile(rpsPath, []);
  const item = rps.find(r => String(r.id) === String(req.params.rpsId));

  if (!canAccessRps(req, item)) {
    // RPS-nya ga ketemu, atau ketemu tapi bukan milik dia -> tolak, jangan lanjut
    return res.status(404).send('Mata kuliah tidak ditemukan atau Anda tidak memiliki akses.');
  }

  const rubrikAll = readJsonFile(rubrikPath, []); // ambil SEMUA rubrik dari SEMUA mata kuliah
  // saring: cuma ambil rubrik yg rpsId-nya sama dengan RPS yg lagi dibuka ini
  const rubrikList = rubrikAll.filter(r => String(r.rpsId) === String(item.id));

  res.render('rubrik-tabel', {
    title: 'Rubrik Penilaian',
    user: req.session.user,
    rpsItem: item,
    rubrikList,
    // saved/deleted ini flag buat nampilin notif hijau "berhasil disimpan/dihapus" di halaman.
    // nilainya dibaca dari query string url, misal ?saved=1 (lihat res.redirect di bawah).
    saved: req.query.saved === '1',
    deleted: req.query.deleted === '1'
  });
});

// ROUTE 3 proses submit form "Tambah Rubrik". method POST (bukan GET) krn ini nyimpen data,
// bukan cuma nampilin halaman.
router.post('/rubrik/mk/:rpsId/add', isAuthenticated, (req, res) => {
  const rps = readJsonFile(rpsPath, []);
  const item = rps.find(r => String(r.id) === String(req.params.rpsId));

  if (!canAccessRps(req, item)) {
    return res.status(404).send('Mata kuliah tidak ditemukan atau Anda tidak memiliki akses.');
  }

  // ambil data form yg udah dirapiin lewat parseRubrikForm (fungsi di atas)
  const { nama, skala, kriteria } = parseRubrikForm(req.body);
  if (!nama || skala.length === 0 || kriteria.length === 0) {
    // validasi sederhana: kalau ada yg kosong, batal simpan, balik ke halaman dgn tanda error
    return res.redirect(`/rubrik/mk/${item.id}?error=1`);
  }

  const rubrikAll = readJsonFile(rubrikPath, []);
  const newRubrik = {
    // id baru = id terbesar yg ada + 1. reduce di sini dipakai buat "nyari angka terbesar" dari semua rubrik.
    id: rubrikAll.reduce((max, r) => Math.max(max, r.id || 0), 0) + 1,
    rpsId: item.id, // penanda rubrik ini milik mata kuliah yg mana
    nama,
    skala,
    kriteria,
    created_at: new Date().toISOString(), // waktu dibuat, format standar biar gampang dibaca ulang
    created_by: req.session.user.id,
    updated_at: new Date().toISOString(),
    updated_by: req.session.user.id
  };
  rubrikAll.push(newRubrik); // tambahin rubrik baru ke daftar
  writeJsonFile(rubrikPath, rubrikAll); // simpan balik SELURUH daftar (lama + baru) ke file

  // redirect = "arahkan browser ke url lain". ?saved=1 dibaca di ROUTE 2 di atas buat nampilin notif sukses.
  res.redirect(`/rubrik/mk/${item.id}?saved=1`);
});

// ROUTE 4 proses submit form "Edit Rubrik" (ubah rubrik yg SUDAH ada).
router.post('/rubrik/mk/:rpsId/:rubrikId/edit', isAuthenticated, (req, res) => {
  const rps = readJsonFile(rpsPath, []);
  const item = rps.find(r => String(r.id) === String(req.params.rpsId));

  if (!canAccessRps(req, item)) {
    return res.status(404).send('Mata kuliah tidak ditemukan atau Anda tidak memiliki akses.');
  }

  const { nama, skala, kriteria } = parseRubrikForm(req.body);
  if (!nama || skala.length === 0 || kriteria.length === 0) {
    return res.redirect(`/rubrik/mk/${item.id}?error=1`);
  }

  const rubrikAll = readJsonFile(rubrikPath, []);
  // cari POSISI (index) rubrik yg mau diedit di dalam array rubrikAll
  const idx = rubrikAll.findIndex(r => String(r.id) === String(req.params.rubrikId) && String(r.rpsId) === String(item.id));
  if (idx === -1) {
    // -1 artinya findIndex ga nemu -> rubriknya ga ada
    return res.status(404).send('Rubrik tidak ditemukan.');
  }

  // { ...rubrikAll[idx], nama, skala, kriteria, ... } artinya: salin semua isi rubrik lama,
  // TAPI timpa field nama/skala/kriteria/updated_at/updated_by dengan nilai yg baru.
  // jadi field lain yg ga disebut di sini (id, rpsId, created_at, created_by) tetap sama kayak semula.
  rubrikAll[idx] = {
    ...rubrikAll[idx],
    nama,
    skala,
    kriteria,
    updated_at: new Date().toISOString(),
    updated_by: req.session.user.id
  };
  writeJsonFile(rubrikPath, rubrikAll);

  res.redirect(`/rubrik/mk/${item.id}?saved=1`);
});

// ROUTE 5 hapus 1 rubrik.
router.post('/rubrik/mk/:rpsId/:rubrikId/delete', isAuthenticated, (req, res) => {
  const rps = readJsonFile(rpsPath, []);
  const item = rps.find(r => String(r.id) === String(req.params.rpsId));

  if (!canAccessRps(req, item)) {
    return res.status(404).send('Mata kuliah tidak ditemukan atau Anda tidak memiliki akses.');
  }

  const rubrikAll = readJsonFile(rubrikPath, []);
  // "hapus" di sini caranya: bikin daftar BARU yg isinya semua rubrik KECUALI yg mau dihapus.
  // filter yg lolos syarat "!(...)" = yg TIDAK cocok id & rpsId yg mau dihapus.
  const filtered = rubrikAll.filter(r => !(String(r.id) === String(req.params.rubrikId) && String(r.rpsId) === String(item.id)));
  writeJsonFile(rubrikPath, filtered); // timpa file lama dgn daftar baru yg udah dikurangin

  res.redirect(`/rubrik/mk/${item.id}?deleted=1`);
});

module.exports = router; // ekspor router ini biar bisa dipakai/dipasang di src/index.js
