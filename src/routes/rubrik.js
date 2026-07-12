const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const rpsPath = path.join(__dirname, '..', 'database', 'rps.json');
const rubrikPath = path.join(__dirname, '..', 'database', 'rubrik.json');

// Baca file JSON. Kalau belum ada/rusak, pakai nilai default (fallbackValue).
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

// Tulis data (array/object) ke file JSON.
function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// Middleware: tolak akses kalau belum login, lempar ke halaman login.
function isAuthenticated(req, res, next) {
  if (req.session.user) {
    return next();
  }
  res.redirect('/login');
}

// Cek apakah user yang login boleh buka RPS ini: admin bebas, dosen cuma boleh RPS miliknya sendiri.
function canAccessRps(req, rpsItem) {
  if (!rpsItem) return false;
  if (req.session.user.role === 'admin') return true;
  return String(rpsItem.userId) === String(req.session.user.id);
}

// Form dikirim dengan key ber-index berurutan (skala[0][skor], skala[1][skor], ...
// kriteria[0][aspek], kriteria[0][deskripsi][0], ...) -- indeksnya sudah
// dirapikan ulang oleh JS di client (lihat reindexRubrikForm) sebelum submit,
// jadi di sini tinggal baca berurutan sampai key-nya tidak ada lagi.
// Ubah data form (field skala[0][skor], kriteria[0][aspek], dst) jadi objek rubrik yang rapi.
function parseRubrikForm(body) {
  const nama = (body.nama || '').trim();

  // Baca kolom Skala Skor satu-satu (skala[0], skala[1], ...) sampai kehabisan.
  const skala = [];
  let j = 0;
  while (body[`skala[${j}][skor]`] !== undefined) {
    const skor = (body[`skala[${j}][skor]`] || '').trim();
    const label = (body[`skala[${j}][label]`] || '').trim();
    if (skor || label) skala.push({ skor, label });
    j++;
  }

  // Baca baris Kriteria satu-satu, tiap baris punya 1 deskripsi per kolom skala.
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

  return { nama, skala, kriteria };
}

// Step 1: pilih semester + mata kuliah (satu halaman, dropdown beranting via JS,
// pola yang sama seperti /penilaian).
// Halaman 1: pilih semester lalu mata kuliah (dropdown-nya diisi/difilter di JS sisi klien).
router.get('/rubrik', isAuthenticated, (req, res) => {
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

  res.render('rubrik-semester', {
    title: 'Rubrik Penilaian',
    user: req.session.user,
    matkulData
  });
});

// Step 2: halaman utama rubrik untuk satu RPS -- tab per rubrik + form tambah/edit/hapus.
// Halaman 2: daftar rubrik (tab per rubrik) untuk 1 mata kuliah + form tambah/edit.
router.get('/rubrik/mk/:rpsId', isAuthenticated, (req, res) => {
  const rps = readJsonFile(rpsPath, []);
  const item = rps.find(r => String(r.id) === String(req.params.rpsId));

  if (!canAccessRps(req, item)) {
    return res.status(404).send('Mata kuliah tidak ditemukan atau Anda tidak memiliki akses.');
  }

  const rubrikAll = readJsonFile(rubrikPath, []);
  const rubrikList = rubrikAll.filter(r => String(r.rpsId) === String(item.id));

  res.render('rubrik-tabel', {
    title: 'Rubrik Penilaian',
    user: req.session.user,
    rpsItem: item,
    rubrikList,
    saved: req.query.saved === '1',
    deleted: req.query.deleted === '1'
  });
});

// Simpan rubrik baru ke rubrik.json (tolak kalau nama/skala/kriteria masih kosong).
router.post('/rubrik/mk/:rpsId/add', isAuthenticated, (req, res) => {
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
  const newRubrik = {
    id: rubrikAll.reduce((max, r) => Math.max(max, r.id || 0), 0) + 1,
    rpsId: item.id,
    nama,
    skala,
    kriteria,
    created_at: new Date().toISOString(),
    created_by: req.session.user.id,
    updated_at: new Date().toISOString(),
    updated_by: req.session.user.id
  };
  rubrikAll.push(newRubrik);
  writeJsonFile(rubrikPath, rubrikAll);

  res.redirect(`/rubrik/mk/${item.id}?saved=1`);
});

// Timpa isi rubrik yang sudah ada dengan data form terbaru.
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
  const idx = rubrikAll.findIndex(r => String(r.id) === String(req.params.rubrikId) && String(r.rpsId) === String(item.id));
  if (idx === -1) {
    return res.status(404).send('Rubrik tidak ditemukan.');
  }

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

// Hapus satu rubrik dari daftar.
router.post('/rubrik/mk/:rpsId/:rubrikId/delete', isAuthenticated, (req, res) => {
  const rps = readJsonFile(rpsPath, []);
  const item = rps.find(r => String(r.id) === String(req.params.rpsId));

  if (!canAccessRps(req, item)) {
    return res.status(404).send('Mata kuliah tidak ditemukan atau Anda tidak memiliki akses.');
  }

  const rubrikAll = readJsonFile(rubrikPath, []);
  const filtered = rubrikAll.filter(r => !(String(r.id) === String(req.params.rubrikId) && String(r.rpsId) === String(item.id)));
  writeJsonFile(rubrikPath, filtered);

  res.redirect(`/rubrik/mk/${item.id}?deleted=1`);
});

module.exports = router;
