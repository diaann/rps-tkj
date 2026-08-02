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
app.use(express.static(path.join(__dirname, 'public')));

// Express session middleware
app.use(session({
  secret: 'secret',
  resave: true,
  saveUninitialized: true
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


// --- PERUBAHAN ADA DI BLOK DI BAWAH INI ---
// Server akan berjalan di semua alamat IP yang tersedia (0.0.0.0)
app.listen(port, '0.0.0.0', () => {
  console.log(`Server started and listening on port ${port}`);
  console.log('You can now access it from other devices on the same network.');
  console.log('From this computer, you can use: http://localhost:3000');
  console.log('From other devices, find your local IP and use: http://<ALAMAT_IP_LOKAL_ANDA>:3000');
});