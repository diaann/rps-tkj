const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');

const app = express();
const port = 3000;

// View engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Body parser middleware
// parameterLimit dinaikkan dari default (1000) krn form Tabel Penilaian bisa punya
// ribuan field sekaligus dalam 1 submit: nilai per mahasiswa x per Sub-CPMK x per
// komponen, DITAMBAH komentar Portofolio per mahasiswa x per Sub-CPMK x per mata
// kuliah dalam 1 semester. Tanpa ini, submit gede bakal ditolak dgn error
// "PayloadTooLargeError: too many parameters" sebelum sempat sampai ke route handler.
app.use(bodyParser.urlencoded({ extended: false, parameterLimit: 100000 }));
app.use(bodyParser.json());

// Static folder
// maxAge 1 hari: browser cache CSS/JS biar loading lebih cepat, tapi ga kelamaan
// nyangkut pas file-nya masih sering diubah selama development.
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));

// Express session middleware
// rolling: true -- countdown-nya reset tiap ada request/aktivitas, jadi user yang
// lagi aktif ngisi form panjang (RPS 5 step) ga ke-logout di tengah jalan; yang
// dihitung 24 jam TANPA aktivitas, bukan 24 jam sejak login pertama.
app.use(session({
  secret: 'secret',
  resave: true,
  saveUninitialized: true,
  rolling: true,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));


// Routes
const indexRouter = require('./routes/index');
const exportRouter = require('./routes/export');
const penilaianRouter = require('./routes/penilaian');
const rubrikRouter = require('./routes/rubrik');
app.use('/', indexRouter);
app.use('/', exportRouter);
app.use('/', penilaianRouter);
app.use('/', rubrikRouter);

// Halaman error yang rapi -- sengaja HTML inline (bukan res.render lewat partial
// header/footer) supaya gak ikut gagal kalau errornya sendiri berhubungan dgn
// session/data yang berantakan.
function renderErrorPage(req, res, status, title, message) {
  if (res.headersSent) return;

  // fetch()-based endpoint (delete-rps, save nilai, dst) baca res.json() &
  // data.success/data.message -- balikin bentuk yang sama biar gak nge-throw
  // "Unexpected token '<'" pas parse HTML sbg JSON.
  if (req.accepts(['html', 'json']) === 'json') {
    return res.status(status).json({ success: false, message });
  }

  res.status(status).send(`<!DOCTYPE html>
<html lang="id">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title></head>
<body style="font-family:sans-serif;max-width:480px;margin:80px auto;text-align:center;color:#333;padding:0 20px;">
<h2 style="color:#b91c1c;">${title}</h2>
<p>${message}</p>
<p><a href="/" style="color:#2563eb;">&larr; Kembali ke Beranda</a></p>
</body></html>`);
}

// 404 -- gak ada route yg cocok. Ditaruh SETELAH semua router.
app.use((req, res) => {
  renderErrorPage(req, res, 404, 'Halaman Tidak Ditemukan', 'Halaman yang Anda cari tidak tersedia atau sudah dipindahkan.');
});

// Error handler global -- HARUS 4 parameter (err, req, res, next) & PALING BAWAH,
// itu caranya Express ngenalin ini sbg error-handling middleware.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  renderErrorPage(req, res, 500, 'Terjadi Kesalahan', 'Maaf, terjadi kesalahan pada server. Silakan coba lagi beberapa saat lagi, atau hubungi admin jika masalah berlanjut.');
});


// --- PERUBAHAN ADA DI BLOK DI BAWAH INI ---
// Server akan berjalan di semua alamat IP yang tersedia (0.0.0.0)
app.listen(port, '0.0.0.0', () => {
  console.log(`Server started and listening on port ${port}`);
  console.log('You can now access it from other devices on the same network.');
  console.log('From this computer, you can use: http://localhost:3000');
  console.log('From other devices, find your local IP and use: http://<ALAMAT_IP_LOKAL_ANDA>:3000');
});