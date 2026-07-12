
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
let multer = null; //memuat  package multer (middleware express untuk menangani upload)
try {
  multer = require('multer');
} catch (error) {
  console.warn('[UPLOAD RPS] Package multer belum terinstall. Jalankan npm install untuk mengaktifkan upload RPS.');
}
const { parseRpsDocxBuffer } = require('../utils/rpsDocxParser'); //impor fungsi parseRpsDocxBuffer dari modul rpsDocxParser.js. jembatan menuji logika ekstraksi python

const usersPath = path.join(__dirname, '..', 'database', 'users.json'); //mendefinisikan path berkas2 json
const rpsPath = path.join(__dirname, '..', 'database', 'rps.json');
const rpsHistoryPath = path.join(__dirname, '..', 'database', 'rps_history.json');
const cplsPath = path.join(__dirname, '..', 'database', 'cpls.json');
const configPath = path.join(__dirname, '..', 'database', 'config.json');
const uploadRpsDir = path.join(__dirname, '..', '..', 'uploads', 'rps-docx');

function ensureUploadDir() { //fungsi yg membuat folder scr rekursif jika belumada
  if (!fs.existsSync(uploadRpsDir)) {
    fs.mkdirSync(uploadRpsDir, { recursive: true });
  }
}

function safeUnlink(filePath) { //fungsi yg menghapus file tanpa adanya error jika gagal
  if (!filePath) return;
  fs.unlink(filePath, () => {});
}

const uploadRpsFile = multer ? multer({ //objek multer
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      ensureUploadDir();
      cb(null, uploadRpsDir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.docx';
      const safeBase = path.basename(file.originalname || 'rps', ext)
        .replace(/[^a-z0-9-_]+/gi, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80) || 'rps';
      cb(null, `${Date.now()}-${safeBase}${ext}`);
    }
  }),
  fileFilter: (req, file, cb) => { //menolak file yg ekstensi nya bukan docx
    const ext = path.extname(file.originalname || '').toLowerCase();
    const isDocx = ext === '.docx' ||
      file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (!isDocx) {
      return cb(new Error('File harus berformat Word (.docx).'));
    }
    cb(null, true);
  },
  limits: { fileSize: 15 * 1024 * 1024 } //max filenya 15mb
}) : null;

function ensureArray(value) {
  if (value === undefined || value === null || value === '') {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function buildCplDescriptionMap(rpsData) {
  const selectedCpls = ensureArray(rpsData.cpl && rpsData.cpl.length ? rpsData.cpl : rpsData['cpl[]']);
  // jangan fallback ke rpsData.cpl_descriptions
  // rpsData.cpl_descriptions adalah OBJECT map {kode: deskripsi}, bukan array
  // yang urut sesuai selectedCpls. ensureArray() akan membungkusnya jadi
  // [ {seluruh object} ], sehingga saat di-assign per-index di bawah, elemen
  // pertama selectedCpls (mis. CPL02) malah ditimpa dengan OBJECT utuh
  // -> muncul sebagai "[object Object]" saat dirender.
  const submittedDescriptions = ensureArray(
    rpsData['cpl_deskripsi[]'] !== undefined ? rpsData['cpl_deskripsi[]']
      : rpsData.cpl_deskripsi !== undefined ? rpsData.cpl_deskripsi
        : rpsData.cpl_description !== undefined ? rpsData.cpl_description
          : []
  );

  const cplDescriptions = (rpsData.cpl_descriptions && typeof rpsData.cpl_descriptions === 'object' && !Array.isArray(rpsData.cpl_descriptions))
    ? { ...rpsData.cpl_descriptions }
    : {};

  selectedCpls.forEach((code, index) => {
    if (submittedDescriptions[index]) {
      cplDescriptions[code] = submittedDescriptions[index];
    }
  });

  Object.keys(rpsData).forEach(key => {
    const codeMatch = key.match(/^cpmk\[(CPMK\d+)\]\[cpl_code\]$/);
    if (!codeMatch) {
      return;
    }

    const cpmkId = codeMatch[1];
    const code = rpsData[key];
    const description = rpsData[`cpmk[${cpmkId}][cpl_description]`];

    if (code && description && !cplDescriptions[code]) {
      cplDescriptions[code] = description;
    }
  });

  return cplDescriptions;
}

function normalizeRpsPayload(payload) {
  const rpsData = { ...payload };
  const multiFields = ['dosen_pengampu', 'pustaka_utama', 'pustaka_pendukung', 'cpl', 'dosen_pengembang_rps'];

  multiFields.forEach(field => {
    const bracketKey = `${field}[]`;
    const rawValue = rpsData[bracketKey] !== undefined ? rpsData[bracketKey] : rpsData[field];
    const values = ensureArray(rawValue);

    if (values.length > 0) {
      rpsData[bracketKey] = values;
      rpsData[field] = field === 'dosen_pengembang_rps' && values.length === 1 ? values[0] : values;
    }
  });

  if (rpsData.mata_kuliah_syarat !== undefined && rpsData.mk_syarat === undefined) {
    rpsData.mk_syarat = rpsData.mata_kuliah_syarat;
  } else if (rpsData.mk_syarat !== undefined && rpsData.mata_kuliah_syarat === undefined) {
    rpsData.mata_kuliah_syarat = rpsData.mk_syarat;
  }

  const cplDescriptions = buildCplDescriptionMap(rpsData);
  if (Object.keys(cplDescriptions).length > 0) {
    rpsData.cpl_descriptions = cplDescriptions;
  }

  delete rpsData.cpl_description;
  delete rpsData.cpl_deskripsi;

  return rpsData;
}


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

// salin dalam2 (deep copy) sebuah objek RPS, biar aman disimpan sbg snapshot revisi tanpa ikut kebawa perubahan
function clonePlainObject(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function getAllUsers() {
  return readJsonFile(usersPath, []);
}

function getUserById(userId) {
  return getAllUsers().find(u => String(u.id) === String(userId));
}

// bungkus data user jadi bentuk ringkas {id, username, email, role} buat dicatat sbg pembuat revisi
function getEditorFromUser(user, fallbackName = 'System') {
  return {
    id: user && user.id ? user.id : null,
    username: user && user.username ? user.username : fallbackName,
    email: user && user.email ? user.email : '',
    role: user && user.role ? user.role : 'system'
  };
}

function getRpsById(rpsList, rpsId) {
  return rpsList.find(r => String(r.id) === String(rpsId));
}

// cek RPS ini boleh diakses user yg login: admin bebas, dosen cuma boleh RPS miliknya sendiri
function canAccessRps(req, rpsItem) {
  if (!req.session.user || !rpsItem) return false;
  return req.session.user.role === 'admin' || String(rpsItem.userId) === String(req.session.user.id);
}

// kamus: nama field mentah RPS -> label yg enak dibaca, dipakai di halaman Riwayat Revisi
const FIELD_LABELS = {
  nama_mk: 'Nama Mata Kuliah',
  kode_mk: 'Kode MK',
  rumpun_mk: 'Rumpun MK',
  semester: 'Semester',
  tahun_akademik: 'Tahun Akademik',
  mata_kuliah_syarat: 'Mata Kuliah Syarat',
  mk_syarat: 'Mata Kuliah Syarat',
  sks_teori: 'SKS Teori',
  sks_praktikum: 'SKS Praktikum',
  tanggal_penyusunan: 'Tanggal Penyusunan',
  dosen_pengampu: 'Dosen Pengampu',
  'dosen_pengampu[]': 'Dosen Pengampu',
  deskripsi_singkat_mk: 'Deskripsi Singkat MK',
  materi_kajian: 'Materi Kajian',
  indikator_cpl: 'Indikator CPL',
  bentuk_pembelajaran: 'Bentuk Pembelajaran',
  metode_pembelajaran: 'Metode Pembelajaran',
  strategi_pembelajaran: 'Strategi Pembelajaran',
  modalitas: 'Modalitas',
  pustaka_utama: 'Pustaka Utama',
  'pustaka_utama[]': 'Pustaka Utama',
  pustaka_pendukung: 'Pustaka Pendukung',
  'pustaka_pendukung[]': 'Pustaka Pendukung',
  penjamin_mutu: 'Penjamin Mutu',
  dosen_pengembang_rps: 'Dosen Pengembang RPS',
  'dosen_pengembang_rps[]': 'Dosen Pengembang RPS',
  koordinator_program_studi: 'Koordinator Program Studi',
  cpl: 'CPL yang Dipilih',
  'cpl[]': 'CPL yang Dipilih',
  cpl_deskripsi: 'Deskripsi CPL',
  'cpl_deskripsi[]': 'Deskripsi CPL'
};

// sama, tapi khusus nama field di dalam Sub-CPMK (durasi, bobot, dst)
const SUB_CPMK_FIELD_LABELS = {
  cpl: 'CPL terkait',
  durasi: 'Durasi',
  media: 'Media',
  deskripsi: 'Deskripsi',
  pekan_awal: 'Pekan Awal',
  pekan_akhir: 'Pekan Akhir',
  materi: 'Materi',
  indikator: 'Indikator',
  teknik_kriteria: 'Teknik & Kriteria',
  modalitas: 'Modalitas',
  metode_luring: 'Metode Luring',
  metode_daring: 'Metode Daring',
  bentuk_pembelajaran: 'Bentuk Pembelajaran',
  strategi_pembelajaran: 'Strategi Pembelajaran',
  sumber_belajar: 'Sumber Belajar',
  alat_bahan: 'Alat & Bahan',
  pengalaman_belajar: 'Pengalaman Belajar',
  bentuk_penilaian: 'Bentuk Penilaian',
  bobot: 'Bobot',
  formatif_nama: 'Nama Formatif',
  formatif_bobot: 'Bobot Formatif',
  sumatif_kuis_nama: 'Nama Kuis',
  sumatif_kuis_bobot: 'Bobot Kuis',
  sumatif_tugas_nama: 'Nama Tugas',
  sumatif_tugas_bobot: 'Bobot Tugas',
  sumatif_ujian_nama: 'Nama Ujian',
  sumatif_ujian_bobot: 'Bobot Ujian',
  sumatif_pjbl_nama: 'Nama PjBL',
  sumatif_pjbl_bobot: 'Bobot PjBL',
  sumatif_presentasi_nama: 'Nama Presentasi',
  sumatif_presentasi_bobot: 'Bobot Presentasi',
  sumatif_lainnya: 'Penilaian Lainnya',
  global_number: 'Nomor Urut'
};

// Ubah nama field mentah (mis. "sub_cpmk[CPMK01][1][durasi]") jadi label yang
// gampang dibaca manusia (mis. "Sub-CPMK CPMK01.1 - Durasi").
function humanizeFieldName(key) {
  let m = key.match(/^sub_cpmk\[(CPMK\d+)\]\[(\d+)\]\[(\w+)\]/);
  if (m) {
    const label = SUB_CPMK_FIELD_LABELS[m[3]] || m[3];
    return `Sub-CPMK ${m[1]}.${m[2]} - ${label}`;
  }
  m = key.match(/^cpmk\[(CPMK\d+)\]\[(\w+)\]/);
  if (m) {
    const fieldLabels = { deskripsi: 'Deskripsi', cpl_code: 'Kode CPL', cpl_description: 'Deskripsi CPL' };
    return `${m[1]} - ${fieldLabels[m[2]] || m[2]}`;
  }
  return FIELD_LABELS[key] || key;
}

// Ratakan nilai supaya perbandingan tidak salah anggap "berubah" hanya
// karena urutan checkbox/array beda atau ada spasi/kosong yang tidak
// signifikan (mis. array kosong vs undefined vs string kosong).
function normalizeValueForCompare(value) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) {
    return value.map(v => String(v).trim()).filter(v => v !== '').sort().join(' ');
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value).trim();
}

// Bandingkan dua snapshot RPS dan kembalikan daftar KEY MENTAH (mis.
// "sub_cpmk[CPMK01][1][durasi]") yang nilainya benar-benar beda. Dipakai baik
// untuk membuat ringkasan label (getChangedFieldNames) maupun untuk menandai
// field mana yang berubah langsung di halaman detail RPS (lihat view-rps.ejs).
function getChangedFieldKeys(before, after) {
  // cpl_descriptions cuma peta turunan yang dihitung ulang otomatis dari
  // cpl_deskripsi[] tiap kali simpan -- membandingkannya cuma menduplikasi
  // sinyal yang sudah ditangkap oleh cpl_deskripsi[] dan bikin noise.
  // Field seperti "pustaka_pendukung" (tanpa []) juga cuma cermin dari
  // "pustaka_pendukung[]" -- normalizeRpsPayload() selalu mengisi keduanya
  // dengan nilai yang SAMA, jadi kalau tidak dikecualikan, satu perubahan
  // bisa kehitung 2x (satu dari versi bracket, satu dari versi non-bracket).
  const ignoredFields = new Set([
    'updated_at', 'updated_by', 'updated_by_username', 'cpl_descriptions',
    'dosen_pengampu', 'pustaka_utama', 'pustaka_pendukung', 'cpl', 'dosen_pengembang_rps'
  ]);
  const beforeObj = before || {};
  const afterObj = after || {};
  const keys = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]);
  const changedKeys = [];

  keys.forEach(key => {
    if (ignoredFields.has(key)) return;
    const beforeValue = normalizeValueForCompare(beforeObj[key]);
    const afterValue = normalizeValueForCompare(afterObj[key]);
    if (beforeValue !== afterValue) {
      changedKeys.push(key);
    }
  });

  return changedKeys;
}

// sama seperti getChangedFieldKeys, tapi hasilnya label yg enak dibaca (buat ditampilkan ke user)
function getChangedFieldNames(before, after) {
  const seenLabels = new Set();
  const labels = [];
  getChangedFieldKeys(before, after).sort().forEach(key => {
    const label = humanizeFieldName(key);
    if (!seenLabels.has(label)) {
      seenLabels.add(label);
      labels.push(label);
    }
  });
  return labels;
}

// cek satu nilai field dianggap "kosong" apa nggak (dipakai buat klasifikasi added/removed/modified)
function isEmptyFieldValue(value) {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.every(v => String(v).trim() === '');
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return String(value).trim() === '';
}

// Klasifikasikan satu perubahan field: "added" (sebelumnya kosong, sekarang
// ada isi), "removed" (sebelumnya ada isi, sekarang kosong ATAU untuk field
// berisi daftar/checkbox seperti pustaka/dosen -- jumlah itemnya berkurang,
// walau daftarnya belum sampai kosong total), atau "modified" (isi beda tapi
// bukan sekadar tambah/kurang item).
function classifyFieldChange(beforeValue, afterValue) {
  const beforeEmpty = isEmptyFieldValue(beforeValue);
  const afterEmpty = isEmptyFieldValue(afterValue);
  if (beforeEmpty && !afterEmpty) return 'added';
  if (!beforeEmpty && afterEmpty) return 'removed';

  if (Array.isArray(beforeValue) || Array.isArray(afterValue)) {
    const toItems = v => (Array.isArray(v) ? v : [v]).map(x => String(x).trim()).filter(Boolean);
    const beforeItems = toItems(beforeValue);
    const afterItems = toItems(afterValue);
    if (afterItems.length < beforeItems.length) return 'removed';
    if (afterItems.length > beforeItems.length) return 'added';
  }

  return 'modified';
}

// Hitung berapa field yang DITAMBAH, DIHAPUS/berkurang isinya, dan DIUBAH --
// supaya badge di halaman History menunjukkan +/- yang sesuai isi
// sebenarnya, bukan cuma berdasar jenis aksi (edit/revert).
function getChangeStats(before, after) {
  const beforeObj = before || {};
  const afterObj = after || {};
  const stats = { added: 0, removed: 0, modified: 0 };

  getChangedFieldKeys(before, after).forEach(key => {
    stats[classifyFieldChange(beforeObj[key], afterObj[key])] += 1;
  });

  return stats;
}

// Cari data revisi TEPAT SEBELUM revisi tertentu (berdasarkan revision_number)
// untuk keperluan diff -- null kalau revisi ini yang paling pertama.
function getPreviousRevisionData(revisions, targetRevision) {
  const idx = revisions.findIndex(rev => String(rev.id) === String(targetRevision.id));
  if (idx <= 0) return null;
  return revisions[idx - 1].data;
}

// ID angka berikutnya buat item baru (RPS baru / revisi baru), tinggal +1 dari yg terbesar
function getNextNumericId(items) {
  if (!items || items.length === 0) return 1;
  return Math.max(...items.map(item => parseInt(item.id || 0, 10))) + 1;
}

// Mengambil revisi RPD berdasarkan rps_id
function getRpsRevisions(rpsId) {
  const history = readJsonFile(rpsHistoryPath, []);
  return history
    .filter(item => String(item.rps_id) === String(rpsId))
    .sort((a, b) => (parseInt(a.revision_number, 10) || 0) - (parseInt(b.revision_number, 10) || 0));
}

// INTI fitur Riwayat Revisi: simpan 1 entri revisi baru (snapshot lengkap RPS saat ini) ke rps_history.json
function createRpsRevision(rpsItem, editorUser, options = {}) {
  const history = readJsonFile(rpsHistoryPath, []);
  const rpsId = parseInt(rpsItem.id, 10);
  const revisionsForRps = history.filter(item => parseInt(item.rps_id, 10) === rpsId);
  // nomor revisi berikutnya (v1, v2, v3, ...) khusus utk RPS ini
  const revisionNumber = revisionsForRps.length
    ? Math.max(...revisionsForRps.map(item => parseInt(item.revision_number || 0, 10))) + 1
    : 1;

  const editor = getEditorFromUser(editorUser, options.fallbackEditorName || 'System');
  const revision = {
    id: getNextNumericId(history),
    rps_id: rpsId,
    revision_number: revisionNumber,
    revision_name: `v${revisionNumber}`,
    action: options.action || 'edit',
    message: options.message || '',
    edited_at: options.edited_at || new Date().toISOString(),
    edited_by: editor.id,
    edited_by_username: editor.username,
    edited_by_email: editor.email,
    edited_by_role: editor.role,
    changed_fields: Array.isArray(options.changed_fields) ? options.changed_fields : [],
    change_stats: options.change_stats || null,
    source_revision_id: options.source_revision_id || null,
    source_revision_name: options.source_revision_name || null,
    data: clonePlainObject(rpsItem) // <- salinan LENGKAP RPS saat ini, bukan cuma daftar perubahannya
  };

  history.push(revision);
  writeJsonFile(rpsHistoryPath, history);
  return revision;
}

// buat "versi awal" utk RPS lama yg belum pernah tercatat revisinya (biar tetap bisa dipulihkan nanti)
function ensureInitialRevision(rpsItem, editorUser) {
  if (!rpsItem || !rpsItem.id) return null;
  const existingRevisions = getRpsRevisions(rpsItem.id);
  if (existingRevisions.length > 0) {
    return existingRevisions[0];
  }

  const owner = editorUser || getUserById(rpsItem.userId) || null;
  return createRpsRevision(rpsItem, owner, {
    action: 'initial',
    message: 'Versi awal sebelum ada perubahan',
    fallbackEditorName: owner && owner.username ? owner.username : 'System'
  });
}

// Middleware khusus admin
function isAdmin(req, res, next) {
  // Prevent caching of admin pages
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');

  if (req.session.user && req.session.user.role === 'admin') {
    return next();
  }
  res.status(403).send('Forbidden');
}

// Halaman admin: validasi user
router.get('/admin', isAuthenticated, isAdmin, (req, res) => {
  const rawData = fs.readFileSync(usersPath);
  const users = JSON.parse(rawData);
  // Tampilkan semua user kecuali admin utama
  const filtered = users.filter(u => u.role !== 'admin' || u.email !== 'admin@example.com');
  res.render('admin', { title: 'Admin - Validasi User', user: req.session.user, users: filtered });
});

// Halaman admin: kelola RPS
router.get('/admin/rps', isAuthenticated, isAdmin, (req, res) => {
  const rawRpsData = fs.readFileSync(rpsPath);
  const rps = JSON.parse(rawRpsData);

  const rawUsersData = fs.readFileSync(usersPath);
  const users = JSON.parse(rawUsersData);

  // Add user information to each RPS
  const rpsWithUsers = rps.map(r => {
    const owner = users.find(u => u.id === r.userId);
    return {
      ...r,
      ownerName: owner ? owner.username : 'Unknown User',
      ownerEmail: owner ? owner.email : 'Unknown'
    };
  });

  res.render('admin-rps', {
    title: 'Admin - Kelola RPS',
    user: req.session.user,
    rps: rpsWithUsers,
    users: users
  });
});

// Proses validasi user
router.post('/admin/validate/:id', isAuthenticated, isAdmin, (req, res) => {
  const userId = parseInt(req.params.id);
  const rawData = fs.readFileSync(usersPath);
  const users = JSON.parse(rawData);
  const idx = users.findIndex(u => u.id === userId);
  if (idx !== -1) {
    users[idx].status = 'active';
    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
  }
  res.redirect('/admin');
});

// Ubah role user (hanya admin)
router.post('/admin/change-role/:id', isAuthenticated, isAdmin, (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const { role } = req.body;
  const allowedRoles = ['dosen', 'admin'];
  if (!allowedRoles.includes(role)) {
    if (req.body.ajax === '1') {
      return res.status(400).json({ success: false, message: 'Role tidak valid' });
    }
    return res.status(400).send('Role tidak valid');
  }
  const rawData = fs.readFileSync(usersPath);
  const users = JSON.parse(rawData);
  const idx = users.findIndex(u => u.id === userId);
  if (idx === -1) {
    if (req.body.ajax === '1') {
      return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
    }
    return res.status(404).send('User tidak ditemukan');
  }
  // Cegah admin aktif menurunkan dirinya sendiri agar tidak kehilangan akses
  if (req.session.user.id === userId && users[idx].role === 'admin' && role !== 'admin') {
    if (req.body.ajax === '1') {
      return res.status(400).json({ success: false, message: 'Tidak dapat menurunkan role admin aktif sendiri.' });
    }
    return res.status(400).send('Tidak dapat menurunkan role admin aktif sendiri.');
  }
  const oldRole = users[idx].role;
  const username = users[idx].username;
  users[idx].role = role;
  fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
  console.log(`[ADMIN] Role user username=${username} id=${userId} diubah dari ${oldRole} -> ${role}`);
  // Update session jika user yang diubah adalah yang sedang login
  if (req.session.user.id === userId) {
    req.session.user.role = role;
  }
  if (req.body.ajax === '1') {
    return res.json({ success: true, message: 'Role berhasil diubah', userId, username, oldRole, newRole: role });
  }
  res.redirect('/admin');
});

// Register page
router.get('/register', (req, res) => {
  res.render('register', { title: 'Register' });
});

// Register process
router.post('/register', (req, res) => {
  const { email, username, password } = req.body;
  if (!email || !username || !password) {
    return res.render('register', { title: 'Register', error: 'Semua field wajib diisi.' });
  }
  const rawData = fs.readFileSync(usersPath);
  const users = JSON.parse(rawData);
  if (users.find(u => u.email === email)) {
    return res.render('register', { title: 'Register', error: 'Email sudah terdaftar.' });
  }
  const newUser = {
    id: users.length ? users[users.length - 1].id + 1 : 1,
    email,
    username,
    password,
    role: 'dosen',
    status: 'pending' // Harus divalidasi admin
  };
  users.push(newUser);
  fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
  res.render('login', { title: 'Login', error: 'Registrasi berhasil! Tunggu validasi admin.' });
});

// Middleware to check if user is logged in
function isAuthenticated(req, res, next) {
  // Prevent caching of authenticated pages so back-button doesn't show stale authenticated content
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');

  if (req.session.user) {
    return next();
  }
  res.redirect('/login');
}

// Login page
router.get('/login', (req, res) => {
  // If user already logged in, don't show login page — redirect to appropriate dashboard
  if (req.session && req.session.user) {
    return res.redirect('/');
  }

  res.render('login', { title: 'Login' });
});

// Login process
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const rawData = fs.readFileSync(usersPath);
  const users = JSON.parse(rawData);

  const user = users.find(u => u.email === email && u.password === password);
  if (user) {
    if (user.status && user.status !== 'active') {
      return res.render('login', { title: 'Login', error: 'Akun Anda belum divalidasi admin.' });
    }
    req.session.user = user;
    // Redirect to root — root will forward to the appropriate dashboard
    return res.redirect('/');
  } else {
    res.render('login', { title: 'Login', error: 'Invalid email or password' });
  }
});

// Logout
router.get('/logout', (req, res) => {
  // Destroy session and then redirect in callback to ensure session cleared before redirect
  req.session.destroy(err => {
    // Clear cookie (if any) to be safe
    if (req.session) {
      try { req.session = null; } catch (e) { }
    }
    res.clearCookie && res.clearCookie('connect.sid');
    res.redirect('/login');
  });
});

// Dashboard - redirect to history
router.get('/', isAuthenticated, (req, res) => {
  // Admin users should see the admin RPS management page
  if (req.session.user && req.session.user.role === 'admin') {
    return res.redirect('/admin/rps');
  }
  res.redirect('/history');
});

// RPS form - accessible via /create-rps
router.get('/create-rps', isAuthenticated, (req, res) => {
  // Load CPL sets and config defaults (penjamin_mutu, koordinator_program_studi)
  let cpls = [];
  let config = {};
  try {
    const rawCpls = fs.readFileSync(cplsPath);
    const allCpls = JSON.parse(rawCpls);
    cpls = allCpls;
  } catch (e) {
    cpls = [];
  }
  try {
    const rawCfg = fs.readFileSync(configPath);
    config = rawCfg ? JSON.parse(rawCfg) : {};
  } catch (e) {
    config = {};
  }

  // Determine active CPL list to present (content array) and expose its id
  let activeCplContent = [];
  let activeCplId = null;
  if (cpls && cpls.length > 0) {
    const aid = config.activeCplId || cpls[0].id;
    const active = cpls.find(x => String(x.id) === String(aid)) || cpls[0];
    activeCplContent = active.content || [];
    activeCplId = active.id || aid;
  }

  res.render('rps', {
    title: 'Buat RPS Baru',
    user: req.session.user,
    cpls: activeCplContent,
    activeCplId: activeCplId,
    penjamin_mutu: config.penjamin_mutu || '',
    koordinator_program_studi: config.koordinator_program_studi || ''
  });
});

// Save RPS data
router.post('/save-rps', isAuthenticated, (req, res) => {
  const rpsData = normalizeRpsPayload(req.body);
  rpsData.userId = req.session.user.id;
  const rps = readJsonFile(rpsPath, []);

  // Generate id unik
  let newId = 1;
  if (rps.length > 0) {
    const maxId = Math.max(...rps.map(r => r.id || 0));
    newId = maxId + 1;
  }
  rpsData.id = newId;
  rpsData.created_at = new Date().toISOString();
  rpsData.updated_at = rpsData.created_at;
  rpsData.updated_by = req.session.user.id;
  rpsData.updated_by_username = req.session.user.username;

  rps.push(rpsData);

  writeJsonFile(rpsPath, rps);

  // Simpan versi awal ke document history.
  createRpsRevision(rpsData, req.session.user, {
    action: 'create',
    message: 'Versi awal saat RPS dibuat'
  });

  // Instead of redirecting, send a success response
  res.json({ success: true, message: 'RPS berhasil disimpan!', id: newId });
});

// History page
router.get('/history', isAuthenticated, (req, res) => {
  // If admin, send them to admin RPS management page instead of history
  if (req.session.user && req.session.user.role === 'admin') {
    return res.redirect('/admin/rps');
  }

  const rawData = fs.readFileSync(rpsPath);
  const rps = JSON.parse(rawData);
  const userRps = rps.filter(r => r.userId === req.session.user.id);
  res.render('history', { title: 'History', user: req.session.user, rps: userRps });
});

// View detail RPS
router.get('/history/view/:id', isAuthenticated, (req, res) => {
  const rpsId = req.params.id;
  const rawData = fs.readFileSync(rpsPath);
  const rps = JSON.parse(rawData);
  let item;
  if (req.session.user.role === 'admin') {
    item = rps.find(r => String(r.id) === String(rpsId));
  } else {
    item = rps.find(r => String(r.id) === String(rpsId) && r.userId === req.session.user.id);
  }

  // Tandai field yang berubah sejak revisi sebelumnya (kalau ada riwayatnya)
  // supaya kelihatan langsung di dalam dokumen, bukan cuma di halaman History.
  let changedFieldKeys = [];
  if (item) {
    const revisions = getRpsRevisions(item.id);
    if (revisions.length >= 2) {
      const latest = revisions[revisions.length - 1];
      changedFieldKeys = getChangedFieldKeys(getPreviousRevisionData(revisions, latest), latest.data);
    }
  }

  res.render('view-rps', { title: 'Detail RPS', user: req.session.user, rps: item, changedFieldKeys });
});


// Riwayat revisi satu dokumen RPS
router.get('/history/rps/:id', isAuthenticated, (req, res) => {
  const rpsId = req.params.id;
  const rps = readJsonFile(rpsPath, []);
  const item = getRpsById(rps, rpsId);

  if (!canAccessRps(req, item)) {
    return res.status(404).send('RPS not found or you do not have permission to view its history.');
  }

  // Untuk dokumen lama yang belum punya history, buat versi awal otomatis.
  ensureInitialRevision(item, getUserById(item.userId) || req.session.user);

  const revisions = getRpsRevisions(rpsId).map(revision => {
    const editor = getUserById(revision.edited_by);
    return {
      ...revision,
      editorName: revision.edited_by_username || (editor ? editor.username : 'System'),
      editorEmail: revision.edited_by_email || (editor ? editor.email : ''),
      changedCount: Array.isArray(revision.changed_fields) ? revision.changed_fields.length : 0
    };
  });

  res.render('rps-history', {
    title: 'Riwayat Revisi RPS',
    user: req.session.user,
    rps: item,
    revisions
  });
});

// Lihat isi RPS pada versi/revisi tertentu
router.get('/history/rps/:id/revision/:revisionId', isAuthenticated, (req, res) => {
  const rpsId = req.params.id;
  const revisionId = req.params.revisionId;
  const rps = readJsonFile(rpsPath, []);
  const item = getRpsById(rps, rpsId);

  if (!canAccessRps(req, item)) {
    return res.status(404).send('RPS not found or you do not have permission to view this revision.');
  }

  const revisions = getRpsRevisions(rpsId);
  const revision = revisions.find(rev => String(rev.id) === String(revisionId));
  if (!revision) {
    return res.status(404).send('Revision not found.');
  }

  const previousData = getPreviousRevisionData(revisions, revision);
  const changedFieldKeys = previousData ? getChangedFieldKeys(previousData, revision.data) : [];

  res.render('view-rps', {
    title: `Detail RPS ${revision.revision_name}`,
    user: req.session.user,
    rps: revision.data,
    isRevision: true,
    revision,
    changedFieldKeys,
    backUrl: `/history/rps/${rpsId}`
  });
});

// Kembalikan RPS ke versi/revisi tertentu
router.post('/history/rps/:id/revision/:revisionId/revert', isAuthenticated, (req, res) => {
  const rpsId = parseInt(req.params.id, 10);
  const revisionId = req.params.revisionId;
  const rps = readJsonFile(rpsPath, []);
  const index = rps.findIndex(item => parseInt(item.id, 10) === rpsId);

  if (index === -1 || !canAccessRps(req, rps[index])) {
    return res.status(404).send('RPS not found or you do not have permission to revert it.');
  }

  const revisions = getRpsRevisions(rpsId);
  const revision = revisions.find(rev => String(rev.id) === String(revisionId));
  if (!revision) {
    return res.status(404).send('Revision not found.');
  }

  const currentRps = rps[index];
  const restoredRps = clonePlainObject(revision.data);

  // ID dan kepemilikan dokumen tetap mengikuti dokumen aktif saat ini.
  restoredRps.id = rpsId;
  restoredRps.userId = currentRps.userId;
  restoredRps.created_at = currentRps.created_at || restoredRps.created_at || null;
  restoredRps.updated_at = new Date().toISOString();
  restoredRps.updated_by = req.session.user.id;
  restoredRps.updated_by_username = req.session.user.username;

  const changedFields = getChangedFieldNames(currentRps, restoredRps);
  const changeStats = getChangeStats(currentRps, restoredRps);
  rps[index] = restoredRps;
  writeJsonFile(rpsPath, rps);

  // pemulihan JUGA dicatat sbg revisi baru (bukan menghapus riwayat di antaranya)
  createRpsRevision(restoredRps, req.session.user, {
    action: 'revert',
    message: `Dikembalikan ke ${revision.revision_name}`,
    changed_fields: changedFields,
    change_stats: changeStats,
    source_revision_id: revision.id,
    source_revision_name: revision.revision_name
  });

  res.redirect(`/history/rps/${rpsId}?reverted=1`);
});

// Edit RPS form
router.get('/edit-rps/:id', isAuthenticated, (req, res) => {
  const rpsId = req.params.id;
  const rawData = fs.readFileSync(rpsPath);
  const rps = JSON.parse(rawData);
  let item;
  if (req.session.user.role === 'admin') {
    item = rps.find(r => String(r.id) === String(rpsId));
  } else {
    item = rps.find(r => String(r.id) === String(rpsId) && r.userId === req.session.user.id);
  }

  if (!item) {
    return res.status(404).send('RPS not found or you do not have permission to edit it.');
  }

  // Load CPLs and config so edit form can use defaults and CPL set
  let cpls = [];
  let config = {};
  try {
    const rawCpls = fs.readFileSync(cplsPath);
    const allCpls = JSON.parse(rawCpls);
    cpls = allCpls;
  } catch (e) {
    cpls = [];
  }
  try {
    const rawCfg = fs.readFileSync(configPath);
    config = rawCfg ? JSON.parse(rawCfg) : {};
  } catch (e) {
    config = {};
  }
  // Determine which CPL set to show for editing.
  // Prefer the CPL set id stored on the RPS (item.id_cpls) if available; otherwise fall back to configured activeCplId.
  let activeCplContent = [];
  let activeCplId = null;
  if (cpls && cpls.length > 0) {
    const preferredId = (item && item.id_cpls) ? item.id_cpls : (config.activeCplId || cpls[0].id);
    const active = cpls.find(x => String(x.id) === String(preferredId)) || cpls[0];
    activeCplContent = active.content || [];
    activeCplId = active.id || preferredId;
  }

  res.render('edit-rps', {
    title: 'Edit RPS',
    user: req.session.user,
    rps: item,
    cpls: activeCplContent,
    activeCplId: activeCplId,
    penjamin_mutu: config.penjamin_mutu || '',
    koordinator_program_studi: config.koordinator_program_studi || ''
  });
});

// Update RPS data
router.post('/edit-rps/:id', isAuthenticated, (req, res) => {
  const rpsId = parseInt(req.params.id, 10);
  const updatedRpsData = normalizeRpsPayload(req.body);

  const rawData = fs.readFileSync(rpsPath);
  let rps = JSON.parse(rawData);

  const index = rps.findIndex(r => r.id === rpsId);

  if (index === -1) {
    return res.status(404).send('RPS not found.');
  }

  // Hanya izinkan user yg membuat atau admin untuk mengedit
  if (rps[index].userId !== req.session.user.id && req.session.user.role !== 'admin') {
    return res.status(403).send('You do not have permission to edit this RPS.');
  }

  // Gabungkan data lama dengan data baru
  const originalRps = rps[index];
  const newRpsData = normalizeRpsPayload({ ...originalRps, ...updatedRpsData });

  // Preserve original userId - don't change ownership when admin edits
  newRpsData.userId = originalRps.userId;

  // Hapus data cpmk dan sub_cpmk lama untuk diganti dengan yang baru
  const fieldsToKeep = Object.keys(newRpsData).filter(k => !k.startsWith('cpmk[') && !k.startsWith('sub_cpmk['));
  let cleanedRps = {};
  fieldsToKeep.forEach(k => {
    cleanedRps[k] = newRpsData[k];
  });

  // Gabungkan dengan data cpmk dan sub_cpmk yang baru dari form
  const finalRpsData = normalizeRpsPayload({ ...cleanedRps, ...updatedRpsData });

  // Pastikan ID tidak berubah
  finalRpsData.id = rpsId;
  finalRpsData.userId = originalRps.userId;
  finalRpsData.created_at = originalRps.created_at || null;
  finalRpsData.updated_at = new Date().toISOString();
  finalRpsData.updated_by = req.session.user.id;
  finalRpsData.updated_by_username = req.session.user.username;

  const changedFields = getChangedFieldNames(originalRps, finalRpsData);
  const changeStats = getChangeStats(originalRps, finalRpsData);

  // Jika RPS lama belum punya riwayat, simpan versi awalnya agar bisa direvert.
  ensureInitialRevision(originalRps, getUserById(originalRps.userId) || req.session.user);

  rps[index] = finalRpsData;

  writeJsonFile(rpsPath, rps);

  // Simpan snapshot setelah edit sebagai revisi baru.
  createRpsRevision(finalRpsData, req.session.user, {
    action: 'edit',
    message: 'RPS diperbarui',
    changed_fields: changedFields,
    change_stats: changeStats
  });

  // Return JSON response instead of redirecting for consistency
  res.json({ success: true, message: 'RPS berhasil diperbarui!', id: rpsId });
});


// Hapus RPS
router.post('/delete-rps/:id', isAuthenticated, (req, res) => {
  const id = parseInt(req.params.id);
  const rawData = fs.readFileSync(rpsPath);
  let rps = JSON.parse(rawData);
  const before = rps.length;

  // Allow admin to delete any RPS, regular users can only delete their own
  if (req.session.user.role === 'admin') {
    rps = rps.filter(r => r.id !== id);
  } else {
    rps = rps.filter(r => r.id !== id || r.userId !== req.session.user.id);
  }

  if (rps.length < before) {
    fs.writeFileSync(rpsPath, JSON.stringify(rps, null, 2));

    // Ikut hapus semua riwayat edit (rps_history) milik RPS ini -- kalau
    // tidak, entrinya jadi sampah yatim yang tetap nyangkut di rps_history.json
    // tanpa RPS induk yang bisa diakses lagi.
    const history = readJsonFile(rpsHistoryPath, []);
    const remainingHistory = history.filter(item => parseInt(item.rps_id, 10) !== id);
    if (remainingHistory.length < history.length) {
      writeJsonFile(rpsHistoryPath, remainingHistory);
    }

    res.json({ success: true });
  } else {
    res.json({ success: false, message: 'Data tidak ditemukan atau bukan milik Anda.' });
  }
});

// Duplikat RPS - allow admin or owner (dosen) to duplicate
router.post('/duplicate-rps/:id', isAuthenticated, (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const rawData = fs.readFileSync(rpsPath);
    const rps = JSON.parse(rawData);
    const idx = rps.findIndex(r => parseInt(r.id, 10) === id);
    if (idx === -1) {
      return res.status(404).json({ success: false, message: 'RPS not found' });
    }

    const original = rps[idx];

    // Permission: admin can duplicate any; dosen can only duplicate their own RPS
    const currentUser = req.session.user;
    if (!(currentUser && (currentUser.role === 'admin' || currentUser.id === original.userId))) {
      return res.status(403).json({ success: false, message: 'Anda tidak memiliki izin untuk menduplikasi RPS ini' });
    }

    // Create a deep-ish clone to avoid accidental shared references
    const cloneSource = JSON.parse(JSON.stringify(original));

    // Create a shallow copy and assign a new unique id
    const newId = rps.length ? (Math.max(...rps.map(x => parseInt(x.id || 0, 10))) + 1) : 1;
    const now = new Date();
    const clone = { ...cloneSource, id: newId };
    // Update created date to now
    clone.tanggal_penyusunan = now.toISOString().slice(0,10);
    // Optionally append note to name to indicate duplicate
    clone.nama_mk = `${original.nama_mk} (Duplikat)`;

    clone.created_at = new Date().toISOString();
    clone.updated_at = clone.created_at;
    clone.updated_by = currentUser.id;
    clone.updated_by_username = currentUser.username;

    rps.push(clone);
    writeJsonFile(rpsPath, rps);

    createRpsRevision(clone, currentUser, {
      action: 'duplicate',
      message: `Diduplikasi dari RPS ID ${original.id}`
    });

    return res.json({ success: true, message: 'RPS berhasil diduplikasi', id: newId });
  } catch (e) {
    console.error('Duplicate RPS error', e);
    return res.status(500).json({ success: false, message: 'Gagal menduplikasi RPS' });
  }
});

// Admin: manage CPL selection and defaults (penjamin_mutu, koordinator)
router.get('/admin/cpl', isAuthenticated, isAdmin, (req, res) => {
  let cpls = [];
  let config = {};
  try {
    const rawCpls = fs.readFileSync(cplsPath);
    cpls = JSON.parse(rawCpls);
  } catch (e) {
    cpls = [];
  }
  try {
    const rawCfg = fs.readFileSync(configPath);
    config = rawCfg ? JSON.parse(rawCfg) : {};
  } catch (e) {
    config = {};
  }

  res.render('admin-cpl', {
    title: 'Admin - Kelola CPL & Defaults',
    user: req.session.user,
    cpls,
    config
  });
});

router.post('/admin/cpl', isAuthenticated, isAdmin, (req, res) => {
  const { activeCplId, penjamin_mutu, koordinator_program_studi } = req.body;
  const cfg = {
    activeCplId: activeCplId || null,
    penjamin_mutu: penjamin_mutu || '',
    koordinator_program_studi: koordinator_program_studi || ''
  };
  try {
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
    return res.redirect('/admin/cpl?saved=1');
  } catch (e) {
    return res.status(500).send('Failed to save config');
  }
});

// Create new CPL set
router.post('/admin/cpl/create', isAuthenticated, isAdmin, (req, res) => {
  const { name, date_created } = req.body;
  let content = [];
  try {
    // content fields arrive as arrays of code[] and desc[] or as a single string
    const codes = req.body['code[]'] || req.body.code || [];
    const descs = req.body['desc[]'] || req.body.desc || [];
    const arrCodes = Array.isArray(codes) ? codes : [codes];
    const arrDescs = Array.isArray(descs) ? descs : [descs];
    for (let i = 0; i < arrCodes.length; i++) {
      if (arrCodes[i]) {
        content.push({ code: arrCodes[i], desc: arrDescs[i] || '' });
      }
    }
  } catch (e) {
    content = [];
  }

  try {
    const raw = fs.readFileSync(cplsPath);
    const sets = JSON.parse(raw);
    const newId = sets.length ? (Math.max(...sets.map(s => parseInt(s.id, 10) || 0)) + 1) : 1;
    const newSet = { id: String(newId), name: name || `CPL Set ${newId}`, date_created: date_created || '', content };
    sets.push(newSet);
    fs.writeFileSync(cplsPath, JSON.stringify(sets, null, 2));
    return res.redirect('/admin/cpl?created=1');
  } catch (e) {
    return res.status(500).send('Failed to create CPL set');
  }
});

// Update existing CPL set
router.post('/admin/cpl/update/:id', isAuthenticated, isAdmin, (req, res) => {
  const id = String(req.params.id);
  const { name, date_created } = req.body;
  try {
    const raw = fs.readFileSync(cplsPath);
    const sets = JSON.parse(raw);
    const idx = sets.findIndex(s => String(s.id) === id);
    if (idx === -1) return res.status(404).send('CPL set not found');

    let content = [];
    const codes = req.body['code[]'] || req.body.code || [];
    const descs = req.body['desc[]'] || req.body.desc || [];
    const arrCodes = Array.isArray(codes) ? codes : [codes];
    const arrDescs = Array.isArray(descs) ? descs : [descs];
    for (let i = 0; i < arrCodes.length; i++) {
      if (arrCodes[i]) content.push({ code: arrCodes[i], desc: arrDescs[i] || '' });
    }

    sets[idx].name = name || sets[idx].name;
    sets[idx].date_created = date_created || sets[idx].date_created;
    sets[idx].content = content;

    fs.writeFileSync(cplsPath, JSON.stringify(sets, null, 2));
    return res.redirect('/admin/cpl?updated=1');
  } catch (e) {
    return res.status(500).send('Failed to update CPL set');
  }
});

// Delete CPL set
router.post('/admin/cpl/delete/:id', isAuthenticated, isAdmin, (req, res) => {
  const id = String(req.params.id);
  try {
    const raw = fs.readFileSync(cplsPath);
    let sets = JSON.parse(raw);
    const before = sets.length;
    sets = sets.filter(s => String(s.id) !== id);
    if (sets.length === before) {
      return res.status(404).send('Not found');
    }
    fs.writeFileSync(cplsPath, JSON.stringify(sets, null, 2));
    return res.redirect('/admin/cpl?deleted=1');
  } catch (e) {
    return res.status(500).send('Failed to delete CPL set');
  }
});

// route get untuk menampilkan halaman (merender halaman upload-rps.ejs), post untuk memproses berkas yg diunggah
router.get('/upload-rps', isAuthenticated, (req, res) => {
  res.render('upload-rps', { title: 'Upload RPS', user: req.session.user, error: null, success: null });
});

router.post('/upload-rps', isAuthenticated, (req, res) => {
  if (!uploadRpsFile) { // multer belum ke-install -> fitur upload dimatikan, kasih pesan error
    return res.status(500).render('upload-rps', {
      title: 'Upload RPS',
      user: req.session.user,
      success: null,
      error: 'Fitur upload file belum aktif karena package multer belum terinstall. Jalankan npm install, lalu restart server.'
    });
  }

  // memanggil uploadRpsFile. middleware membaca field file bernama "rpsFile" dari body dan hasilnya ditaruh di req.file
  uploadRpsFile.single('rpsFile')(req, res, async (uploadError) => {
    if (uploadError) { // gagal pas proses upload-nya sendiri (mis. bukan .docx, kelewat besar)
      return res.status(400).render('upload-rps', {
        title: 'Upload RPS',
        user: req.session.user,
        success: null,
        error: uploadError.message || 'Gagal mengupload file.'
      });
    }

    if (!req.file) { // menangani error
      return res.status(400).render('upload-rps', {
        title: 'Upload RPS',
        user: req.session.user,
        success: null,
        error: 'Pilih file Word (.docx) terlebih dahulu.'
      });
    }

    try {
      const config = readJsonFile(configPath, {});
      const fileBuffer = fs.readFileSync(req.file.path);
      const { rpsData } = await parseRpsDocxBuffer(fileBuffer, { //berhubungan dgn ekstraksi python
        fileName: req.file.originalname,
        fallback: {
          username: req.session.user.username,
          penjamin_mutu: config.penjamin_mutu || '',
          koordinator_program_studi: config.koordinator_program_studi || '',
          activeCplId: config.activeCplId || ''
        }
      });


      // menyimpan data ke rps.json
      const rps = readJsonFile(rpsPath, []);
      const newId = getNextNumericId(rps);
      const now = new Date().toISOString();

      const finalRpsData = normalizeRpsPayload({
        ...rpsData,
        id: newId,
        userId: req.session.user.id,
        created_at: now,
        updated_at: now,
        updated_by: req.session.user.id,
        updated_by_username: req.session.user.username
      });

      rps.push(finalRpsData);
      writeJsonFile(rpsPath, rps);

      // mencatat riwayat edit/revisi pertama
      createRpsRevision(finalRpsData, req.session.user, {
        action: 'upload_docx',
        message: `RPS dibuat dari upload Word: ${req.file.originalname || 'file'}`
      });

      safeUnlink(req.file.path); // arahkan user ke halaman detail rps yg baru dibuat
      return res.redirect(`/history/view/${newId}?uploaded=1`);
    } catch (error) { // ekstraksi python gagal (dokumen rusak/format tidak dikenali, dst)
      console.error('[UPLOAD RPS] Gagal mengekstrak file:', error);
      safeUnlink(req.file && req.file.path);
      return res.status(500).render('upload-rps', {
        title: 'Upload RPS',
        user: req.session.user,
        success: null,
        error: `Gagal membaca isi file. ${error.message || 'Format file mungkin tidak terbaca.'}`
      });
    }
  });
});

module.exports = router;