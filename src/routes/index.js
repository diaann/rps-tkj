
const express = require('express');
const router = express.Router(); // wadah kumpulan route (url) di file ini, nanti dipasang ke app utama di src/index.js
const fs = require('fs');
const path = require('path');

// multer = library yg menangkap file yg diupload lewat form (<input type="file">).
// dibungkus try/catch: kalau package-nya belum di-install (npm install belum jalan),
// multer tetap bernilai null dan aplikasi tetap jalan (cuma fitur upload yg dimatikan
// otomatis, lihat pengecekan "if (!uploadRpsFile)" di route POST /upload-rps di bawah).
let multer = null;
try {
  multer = require('multer');
} catch (error) {
  console.warn('[UPLOAD RPS] Package multer belum terinstall. Jalankan npm install untuk mengaktifkan upload RPS.');
}
// fungsi yg baca isi file .docx & panggil python (lihat src/utils/rpsDocxParser.js)
const { parseRpsDocxBuffer } = require('../utils/rpsDocxParser');

// alamat file2 "database" (json) yg dipakai di file ini
const usersPath = path.join(__dirname, '..', 'database', 'users.json');
const rpsPath = path.join(__dirname, '..', 'database', 'rps.json');
const rpsHistoryPath = path.join(__dirname, '..', 'database', 'rps_history.json'); // tempat riwayat revisi disimpan
const cplsPath = path.join(__dirname, '..', 'database', 'cpls.json');
const mahasiswaPath = path.join(__dirname, '..', 'database', 'mahasiswa.json');
const kelasPath = path.join(__dirname, '..', 'database', 'kelas.json');
const configPath = path.join(__dirname, '..', 'database', 'config.json');
const uploadRpsDir = path.join(__dirname, '..', '..', 'uploads', 'rps-docx'); // folder taruh file .docx yg diupload

// bikin folder uploads/rps-docx kalau belum ada. { recursive: true } artinya kalau folder
// induknya juga belum ada, ikut dibikinkan semua sekaligus (tidak perlu bikin satu-satu).
function ensureUploadDir() {
  if (!fs.existsSync(uploadRpsDir)) {
    fs.mkdirSync(uploadRpsDir, { recursive: true });
  }
}

// hapus 1 file dari disk. dibungkus supaya kalau gagal (misal filenya sudah kehapus),
// tidak bikin error, cuma lewat saja (callback kosong `() => {}`).
function safeUnlink(filePath) {
  if (!filePath) return;
  fs.unlink(filePath, () => {});
}

// konfigurasi multer: aturan bagaimana file yg diupload itu diterima & disimpan.
// kalau multer null (belum diinstall), uploadRpsFile null juga.
const uploadRpsFile = multer ? multer({
  // storage = ke mana & dgn nama apa file yg diupload disimpan di disk
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      // "destination" = folder tujuan. ensureUploadDir() dipanggil dulu tiap kali
      // ada upload, jaga2 kalau foldernya terhapus.
      ensureUploadDir();
      cb(null, uploadRpsDir);
    },
    filename: (req, file, cb) => {
      // "filename" = nama file yg dipakai pas disimpan (bukan nama asli dari user,
      // biar tidak ada 2 file numpuk dengan nama yg sama).
      const ext = path.extname(file.originalname || '').toLowerCase() || '.docx'; // ambil ekstensi, misal ".docx"
      const safeBase = path.basename(file.originalname || 'rps', ext) // ambil nama file tanpa ekstensi
        .replace(/[^a-z0-9-_]+/gi, '-') // ganti karakter aneh (spasi, simbol, dll) jadi strip "-"
        .replace(/-+/g, '-')            // rapikan strip yg dobel jadi 1 strip 
        .replace(/^-|-$/g, '')          // buang strip di paling awal/akhir
        .slice(0, 80) || 'rps';         // batasi panjang nama, kalau ujung2nya kosong pakai "rps"
      // nama file akhir = angka waktu sekarang + nama yg sudah dibersihkan + ekstensi.
      // angka waktu di depan (Date.now()) bikin nama filenya pasti unik walau 2 orang upload
      // file dgn nama asli yg sama persis di waktu yg beda.
      cb(null, `${Date.now()}-${safeBase}${ext}`);
    }
  }),
  // fileFilter = aturan tolak file sebelum disimpan, kalau tidak sesuai syarat
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const isDocx = ext === '.docx' ||
      file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (!isDocx) {
      // panggil cb dgn error = tolak file, nanti errornya tertangkap di route POST /upload-rps
      return cb(new Error('File harus berformat Word (.docx).'));
    }
    cb(null, true); // cb(null, true) = file diterima, lanjut disimpan
  },
  limits: { fileSize: 15 * 1024 * 1024 } // batas ukuran file: 15 x 1024 x 1024 byte = 15 MB
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
  // rpsData.cpl_descriptions adalah object map {kode: deskripsi}, bukan array
  // yang urut sesuai selectedCpls. ensureArray() akan membungkusnya jadi
  // [ {seluruh object} ], sehingga saat di-assign per-index di bawah, elemen
  // pertama selectedCpls (mis. CPL02) ditimpa dengan object utuh
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


// util umum
// baca 1 file json dari disk, ubah jadi array/object javascript.
function readJsonFile(filePath, fallbackValue) {
  try {
    if (!fs.existsSync(filePath)) {
      // filenya belum ada sama sekali -> bikin baru isinya fallbackValue (misal [])
      fs.writeFileSync(filePath, JSON.stringify(fallbackValue, null, 2));
      return Array.isArray(fallbackValue) ? [...fallbackValue] : { ...fallbackValue };
    }

    const raw = fs.readFileSync(filePath, 'utf8'); // baca isi file sbg teks
    if (!raw.trim()) {
      // filenya ada tapi kosong -> anggap belum ada, pakai fallback
      return Array.isArray(fallbackValue) ? [...fallbackValue] : { ...fallbackValue };
    }

    return JSON.parse(raw); // ubah teks json jadi array/object javascript
  } catch (error) {
    // kalau ada apa pun yg gagal (misal isi filenya rusak/bukan json valid),
    // jangan bikin sistem crash. catat errornya ke konsol, kembalikan fallback.
    console.error(`Gagal membaca file JSON: ${filePath}`, error);
    return Array.isArray(fallbackValue) ? [...fallbackValue] : { ...fallbackValue };
  }
}

// kebalikan dari readJsonFile: ambil data javascript, ubah jadi teks json, timpa ke file.
function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function sortMahasiswa(mahasiswaList) {
  return [...(Array.isArray(mahasiswaList) ? mahasiswaList : [])].sort((a, b) => {
    const parseKelas = (item) => {
      const raw = String(item && item.kelasId ? item.kelasId : '').trim();
      const match = raw.match(/^(\d+)([A-Za-z])$/i);
      if (!match) {
        return [Number.MAX_SAFE_INTEGER, 0, raw];
      }

      const tingkat = parseInt(match[1], 10) || 0;
      const kelompok = match[2].toUpperCase();
      return [tingkat, kelompok === 'A' ? 0 : 1, raw];
    };

    const left = parseKelas(a);
    const right = parseKelas(b);

    if (left[0] !== right[0]) return left[0] - right[0];
    if (left[1] !== right[1]) return left[1] - right[1];

    const namaA = String(a && a.nama ? a.nama : '').toLowerCase();
    const namaB = String(b && b.nama ? b.nama : '').toLowerCase();
    if (namaA !== namaB) return namaA.localeCompare(namaB);

    const nimA = String(a && a.nim ? a.nim : '');
    const nimB = String(b && b.nim ? b.nim : '');
    if (nimA !== nimB) return nimA.localeCompare(nimB);

    return String(a && a.id ? a.id : '').localeCompare(String(b && b.id ? b.id : ''));
  });
}

function generateStudentId(mahasiswaList, kelasId, existingId) {
  const baseKelas = String(kelasId || '').trim();
  const existingIds = (Array.isArray(mahasiswaList) ? mahasiswaList : [])
    .map(item => String(item && item.id ? item.id : ''))
    .filter(Boolean)
    .filter(id => !existingId || String(id) !== String(existingId));

  const prefix = `${baseKelas}-`;
  const usedNumbers = existingIds
    .filter(id => String(id).startsWith(prefix))
    .map(id => parseInt(String(id).split('-').pop(), 10))
    .filter(number => !Number.isNaN(number));

  let nextNumber = 1;
  while (usedNumbers.includes(nextNumber)) {
    nextNumber += 1;
  }

  return `${baseKelas}-${String(nextNumber).padStart(2, '0')}`;
}

// bikin salinan dari sebuah objek (deep copy)
// dengan cara bah objeknya jadi teks json (JSON.stringify), lalu ubah balik jadi objek baru (JSON.parse)
// penting untuk fitur Riwayat Revisi
// setelah itu snapshot RPS ke riwayat, snapshot itu harus jadi objek yg berdiri sendiri, kalau RPS
// aslinya diubah, snapshot lama di riwayat tidak boleh ikut berubah.
function clonePlainObject(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

// ambil semua data user dari users.json
function getAllUsers() {
  return readJsonFile(usersPath, []);
}

// cari 1 user berdasarkan id-nya
function getUserById(userId) {
  return getAllUsers().find(u => String(u.id) === String(userId));
}

// data user (dari users.json) isinya lumayan banyak (password, dll). fungsi ini
// "meringkas" jadi 4 info penting yg perlu dicatat sbg "siapa yg buat revisi ini", yaitu
// id, username, email, role. kalau usernya null/kosong (misal revisi dibuat otomatis
// oleh sistem, bukan oleh aksi user beneran), dipakai fallbackName sbg nama penggantinya.
function getEditorFromUser(user, fallbackName = 'System') {
  return {
    id: user && user.id ? user.id : null,
    username: user && user.username ? user.username : fallbackName,
    email: user && user.email ? user.email : '',
    role: user && user.role ? user.role : 'system'
  };
}

// cari 1 RPS dari daftar RPS berdasarkan id
function getRpsById(rpsList, rpsId) {
  return rpsList.find(r => String(r.id) === String(rpsId));
}

// cek user yg login boleh buka/ubah RPS ini atau tidak. hasilnya true kalau dia admin
// atau kalau dia adalah pemilik RPS itu sendiri
// (userId di data RPS sama dgn id user yg login). selain itu, hasilnya false.
function canAccessRps(req, rpsItem) {
  if (!req.session.user || !rpsItem) return false;
  return req.session.user.role === 'admin' || String(rpsItem.userId) === String(req.session.user.id);
}

// kamus/label nama field mentah RPS -> label yg enak dibaca, dipakai di halaman Riwayat Revisi
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

// khusus nama field di dalam Sub-CPMK (durasi, bobot, dst)
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

// data RPS itu isinya field2 mentah kayak "sub_cpmk[CPMK01][1][durasi]", nama field
// seperti itu jelas tdk bagus kalau ditampilkan apa adanya ke user di halaman Riwayat Revisi.
// fungsi ini mengubah hal tsb menjadi kalimat yg enak dibaca, misal jadi "Sub-CPMK CPMK01.1 - Durasi".
function humanizeFieldName(key) {
  // cek apa formatnya "sub_cpmk[KODE][NOMOR][NAMA_FIELD]"?
  let m = key.match(/^sub_cpmk\[(CPMK\d+)\]\[(\d+)\]\[(\w+)\]/);
  if (m) {
    // m[1]=kode cpmk, m[2]=nomor lokal, m[3]=nama field asli (misal "durasi")
    const label = SUB_CPMK_FIELD_LABELS[m[3]] || m[3]; // cari label di kamus. kalau tidak ada, pakai apa adanya
    return `Sub-CPMK ${m[1]}.${m[2]} - ${label}`;
  }
  // kalau bukan, cek format "cpmk[KODE][NAMA_FIELD]"
  m = key.match(/^cpmk\[(CPMK\d+)\]\[(\w+)\]/);
  if (m) {
    const fieldLabels = { deskripsi: 'Deskripsi', cpl_code: 'Kode CPL', cpl_description: 'Deskripsi CPL' };
    return `${m[1]} - ${fieldLabels[m[2]] || m[2]}`;
  }
  // bukan keduanya -> berarti field tingkat-RPS biasa (misal "nama_mk"), cari di kamus FIELD_LABELS
  return FIELD_LABELS[key] || key;
}

// nilai sebuah field perlu "diratakan" sebelum dibandingkan, biar tidak salah dianggap
// "berubah" padahal sebenernya isinya sama. contoh kasus yg mau dihindari:
//   - array ['a', 'b'] vs ['b', 'a'] isinya sama, cuma urutannya beda -> harus dianggap sama
//   - undefined vs '' (string kosong) dua-duanya sama2 "kosong" -> harus dianggap sama
function normalizeValueForCompare(value) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) {
    // .sort() di sini yg membuat urutan array tidak dianggap penting, semua array
    // diurutkan dulu sebelum digabung jadi 1 string, jadi ['a','b'] dan ['b','a']
    // akan menghasilkan string perbandingan yg sama.
    return value.map(v => String(v).trim()).filter(v => v !== '').sort().join(' ');
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value).trim();
}

// FUNGSI PENTING: bandingin 2 snapshot RPS (before = versi lama, after = versi baru),
// hasilnya daftar NAMA FIELD MENTAH yg nilainya beda. dipakai di 2 tempat:
// 1) getChangedFieldNames di bawah (bikin daftar label "apa saja yg berubah")
// 2) langsung di halaman detail RPS (view-rps.ejs), untuk highlight kuning bagian yg berubah
function getChangedFieldKeys(before, after) {
  // field ini dilewatkan (tidak ikut dibandingin), krn isinya hanya "cerminan"
  // otomatis dari field lain. misal "pustaka_pendukung" (tanpa []) selalu diisi sama
  // persis kayak "pustaka_pendukung[]" oleh normalizeRpsPayload(). jadi kalau
  // tidak dilewatkan, 1 perubahan pustaka bisa terhitung 2x jadi keliatan "berubah 2 field".
  const ignoredFields = new Set([
    'updated_at', 'updated_by', 'updated_by_username', 'cpl_descriptions',
    'dosen_pengampu', 'pustaka_utama', 'pustaka_pendukung', 'cpl', 'dosen_pengembang_rps'
  ]);
  const beforeObj = before || {};
  const afterObj = after || {};
  // gabungkan semua nama field yg ada di versi lama dan versi baru (pakai Set biar tidak dobel)
  const keys = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]);
  const changedKeys = [];

  keys.forEach(key => {
    if (ignoredFields.has(key)) return; // skip field yg dikecualikan di atas
    const beforeValue = normalizeValueForCompare(beforeObj[key]);
    const afterValue = normalizeValueForCompare(afterObj[key]);
    if (beforeValue !== afterValue) {
      changedKeys.push(key); // nilainya beda -> field ini dianggap "berubah"
    }
  });

  return changedKeys;
}

// sama kayak getChangedFieldKeys, tapi hasil akhirnya udah dalam bentuk label yg enak
// dibaca (lewat humanizeFieldName), bukan nama field mentah. inilah yg dipakai buat
// nampilin daftar "field apa aja yg berubah" di halaman Riwayat Revisi.
function getChangedFieldNames(before, after) {
  const seenLabels = new Set();
  const labels = [];
  getChangedFieldKeys(before, after).sort().forEach(key => {
    const label = humanizeFieldName(key);
    if (!seenLabels.has(label)) {
      // dicek dulu biar label yg sama (misal 2 field beda tp label akhirnya kebetulan sama)
      // tidak muncul dobel di daftar
      seenLabels.add(label);
      labels.push(label);
    }
  });
  return labels;
}

// cek 1 nilai field: dianggap "kosong" apa nggak. dipakai sama classifyFieldChange di bawah.
function isEmptyFieldValue(value) {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.every(v => String(v).trim() === ''); // semua elemennya kosong
  if (typeof value === 'object') return Object.keys(value).length === 0; // objek tanpa isi
  return String(value).trim() === '';
}

// buat 1 field yg diketahui berubah, tentuin jenis perubahannya termasuk yg mana:
// - "added"    = sebelumnya kosong, sekarang keisi (dosen NAMBAHIN sesuatu)
// - "removed"  = sebelumnya keisi, sekarang kosong (ATAU khusus field berbentuk daftar
//                kayak pustaka/dosen, kalau jumlah itemnya BERKURANG walau belum kosong total)
// - "modified" = selain 2 kasus di atas (isinya diubah, bukan cuma ditambah/dikurangi)
// hasil klasifikasi ini yg nentuin warna badge +/-/~ di halaman Riwayat Revisi.
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

// hitung TOTAL berapa banyak field yg ke-ADD, ke-REMOVE, dan ke-MODIFY antara 2 snapshot.
// hasilnya (mis. {added: 2, removed: 0, modified: 1}) dipakai nampilin badge "+2 ~1" di
// halaman Riwayat Revisi, biar user langsung tau seberapa besar suatu revisi mengubah RPS.
function getChangeStats(before, after) {
  const beforeObj = before || {};
  const afterObj = after || {};
  const stats = { added: 0, removed: 0, modified: 0 };

  getChangedFieldKeys(before, after).forEach(key => {
    stats[classifyFieldChange(beforeObj[key], afterObj[key])] += 1;
  });

  return stats;
}

// cari data revisi yg PERSIS 1 langkah SEBELUM revisi tertentu (revisions harus sudah
// terurut dari lama ke baru). dipakai buat bandingin "versi ini" vs "versi sebelumnya".
// hasilnya null kalau revisi yg dimaksud adalah yg PERTAMA (ga ada versi sebelumnya).
function getPreviousRevisionData(revisions, targetRevision) {
  const idx = revisions.findIndex(rev => String(rev.id) === String(targetRevision.id));
  if (idx <= 0) return null;
  return revisions[idx - 1].data;
}

// hitung id angka berikutnya buat item baru (dipakai baik utk id RPS baru maupun id revisi baru).
// caranya: cari angka id TERBESAR yg udah ada di antara semua item, lalu +1.
function getNextNumericId(items) {
  if (!items || items.length === 0) return 1; // belum ada item sama sekali -> mulai dari 1
  return Math.max(...items.map(item => parseInt(item.id || 0, 10))) + 1;
}

// ambil SEMUA revisi milik 1 RPS tertentu dari rps_history.json, diurutkan dari
// revisi paling lama (v1) ke paling baru, biar gampang ditelusuri urutannya.
function getRpsRevisions(rpsId) {
  const history = readJsonFile(rpsHistoryPath, []);
  return history
    .filter(item => String(item.rps_id) === String(rpsId)) // ambil punya RPS ini aja
    .sort((a, b) => (parseInt(a.revision_number, 10) || 0) - (parseInt(b.revision_number, 10) || 0));
}

// **FUNGSI PALING PENTING DI FITUR RIWAYAT REVISI.**
// tugasnya: bikin 1 entri revisi baru & simpan ke rps_history.json.
// dipanggil setiap kali RPS dibuat/diubah/dipulihkan, lihat pemanggilannya di
// route upload (di atas), route edit-rps, dan route revert (di bawah).
function createRpsRevision(rpsItem, editorUser, options = {}) {
  const history = readJsonFile(rpsHistoryPath, []); // ambil SEMUA revisi (dari SEMUA RPS)
  const rpsId = parseInt(rpsItem.id, 10);
  const revisionsForRps = history.filter(item => parseInt(item.rps_id, 10) === rpsId);
  // nomor revisi berikutnya (v1, v2, v3, ...) KHUSUS untuk RPS ini aja
  const revisionNumber = revisionsForRps.length
    ? Math.max(...revisionsForRps.map(item => parseInt(item.revision_number || 0, 10))) + 1
    : 1; // belum ada revisi sama sekali -> ini jadi v1

  const editor = getEditorFromUser(editorUser, options.fallbackEditorName || 'System');
  // ini objek 1 entri revisi yg bakal disimpan
  const revision = {
    id: getNextNumericId(history),
    rps_id: rpsId,
    revision_number: revisionNumber,
    revision_name: `v${revisionNumber}`, // nama yg ditampilin ke user, misal "v3"
    action: options.action || 'edit', // jenis aksi: 'edit'/'upload_docx'/'revert'/'initial'/dst
    message: options.message || '', // pesan bebas, misal "RPS diperbarui"
    edited_at: options.edited_at || new Date().toISOString(),
    edited_by: editor.id,
    edited_by_username: editor.username,
    edited_by_email: editor.email,
    edited_by_role: editor.role,
    changed_fields: Array.isArray(options.changed_fields) ? options.changed_fields : [], // daftar label field yg berubah
    change_stats: options.change_stats || null, // {added, removed, modified} dari getChangeStats
    source_revision_id: options.source_revision_id || null, // diisi kalau ini hasil revert dari revisi lain
    source_revision_name: options.source_revision_name || null,
    // BAGIAN PALING PENTING: salinan LENGKAP data RPS pada saat ini, bukan cuma catatan
    // "apa yg berubah". inilah yg bikin fitur ini bisa nampilin isi lengkap versi manapun,
    // atau memulihkan (revert) ke versi manapun, kapan pun dibutuhkan.
    data: clonePlainObject(rpsItem)
  };

  history.push(revision); // tambahin revisi baru ke daftar
  writeJsonFile(rpsHistoryPath, history); // simpan balik SELURUH daftar revisi ke file
  return revision;
}

// RPS yg dibuat SEBELUM fitur Riwayat Revisi ini ada, otomatis belum punya riwayat sama
// sekali. fungsi ini mastiin setiap RPS minimal punya 1 revisi ("versi awal") sebelum
// dilanjut diedit/dipulihkan. kalau tidak begini, RPS lama itu tidak akan pernah bisa
// "dipulihkan ke kondisi sebelum diedit pertama kali", soalnya tidak ada snapshot-nya.
function ensureInitialRevision(rpsItem, editorUser) {
  if (!rpsItem || !rpsItem.id) return null;
  const existingRevisions = getRpsRevisions(rpsItem.id);
  if (existingRevisions.length > 0) {
    // udah pernah punya revisi -> tidak usah bikin apa2 lagi, cukup balikin yg pertama
    return existingRevisions[0];
  }

  // belum pernah punya revisi sama sekali -> bikinin 1 sbg "titik awal"
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

// ROUTE tampilkan detail 1 RPS versi TERKINI (bukan versi arsip). ini yg dibuka
// pas user klik "Lihat" di halaman daftar RPS.
router.get('/history/view/:id', isAuthenticated, (req, res) => {
  const rpsId = req.params.id;
  const rawData = fs.readFileSync(rpsPath);
  const rps = JSON.parse(rawData);
  let item;
  if (req.session.user.role === 'admin') {
    item = rps.find(r => String(r.id) === String(rpsId)); // admin boleh liat RPS siapa aja
  } else {
    item = rps.find(r => String(r.id) === String(rpsId) && r.userId === req.session.user.id); // dosen cuma boleh liat miliknya
  }

  // cari tau field mana aja yg berubah di revisi PALING TERAKHIR, biar bisa disorot
  // kuning langsung di halaman detailnya (bukan cuma keliatan di halaman Riwayat Revisi).
  let changedFieldKeys = [];
  if (item) {
    const revisions = getRpsRevisions(item.id);
    if (revisions.length >= 2) {
      // minimal harus ada 2 revisi (biar ada "versi sebelumnya" buat dibandingin)
      const latest = revisions[revisions.length - 1];
      changedFieldKeys = getChangedFieldKeys(getPreviousRevisionData(revisions, latest), latest.data);
    }
  }

  // changedFieldKeys dikirim ke view-rps.ejs, dipakai di sana buat kasih class css
  // "highlight kuning" ke bagian2 yg berubah (lihat sub-bab soal changedClass di view-rps.ejs)
  res.render('view-rps', { title: 'Detail RPS', user: req.session.user, rps: item, changedFieldKeys });
});


// ROUTE tampilkan daftar SEMUA revisi milik 1 RPS (halaman "Riwayat Revisi").
router.get('/history/rps/:id', isAuthenticated, (req, res) => {
  const rpsId = req.params.id;
  const rps = readJsonFile(rpsPath, []);
  const item = getRpsById(rps, rpsId);

  if (!canAccessRps(req, item)) {
    return res.status(404).send('RPS not found or you do not have permission to view its history.');
  }

  // kalau RPS ini dibuat sebelum fitur Riwayat Revisi ada (jadi belum ada riwayatnya
  // sama sekali), bikinin dulu "versi awal" biar halaman ini tidak kosong melompong.
  ensureInitialRevision(item, getUserById(item.userId) || req.session.user);

  // ambil semua revisi punya RPS ini, terus "dandanin" tiap entrinya dgn info tambahan
  // yg dibutuhin tampilan (nama pengedit, jumlah field yg berubah).
  const revisions = getRpsRevisions(rpsId).map(revision => {
    const editor = getUserById(revision.edited_by);
    return {
      ...revision, // semua field revisi asli tetap ikut
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

// ROUTE tampilkan isi RPS pada 1 VERSI ARSIP tertentu (bukan versi terkini).
// dibuka pas user klik "Lihat" pada salah satu baris di daftar Riwayat Revisi.
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

  // PERHATIKAN: rps yg dikirim ke view di sini adalah revision.data (data versi ARSIP-nya),
  // BUKAN data RPS yg aktif sekarang. isRevision:true & backUrl dipakai view-rps.ejs buat
  // nampilin banner kuning "kamu lagi liat versi lama" + tombol kembali ke daftar riwayat
  // (bukan ke halaman detail RPS biasa) jadi 1 halaman view-rps.ejs bisa dipakai
  // buat 2 keperluan sekaligus: liat versi terkini ATAUPUN liat versi arsip.
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

// ROUTE proses tombol "Pulihkan versi ini". mengganti RPS yg lagi aktif dgn isi
// dari salah satu versi arsip yg dipilih user.
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

  const currentRps = rps[index]; // RPS yg lagi aktif SEBELUM dipulihkan (dipakai buat hitung apa yg berubah)
  const restoredRps = clonePlainObject(revision.data); // salinan data dari versi arsip yg dipilih

  // walaupun isinya diambil dari versi lama, id/kepemilikan/tanggal-dibuat HARUS tetap ikut
  // dokumen yg AKTIF SEKARANG biar RPS-nya tetap "RPS yg sama", cuma isinya yg dipulihkan.
  restoredRps.id = rpsId;
  restoredRps.userId = currentRps.userId;
  restoredRps.created_at = currentRps.created_at || restoredRps.created_at || null;
  restoredRps.updated_at = new Date().toISOString();
  restoredRps.updated_by = req.session.user.id;
  restoredRps.updated_by_username = req.session.user.username;

  // hitung apa aja yg berubah akibat pemulihan ini (dibandingin dgn kondisi SEBELUM dipulihkan)
  const changedFields = getChangedFieldNames(currentRps, restoredRps);
  const changeStats = getChangeStats(currentRps, restoredRps);
  rps[index] = restoredRps; // RPS aktif sekarang resmi jadi versi yg dipulihkan
  writeJsonFile(rpsPath, rps);

  // pemulihan ini SENDIRI dicatat lagi sbg revisi BARU (bukan menghapus revisi2 yg ada
  // di antaranya) jadi kalau ternyata pemulihannya salah pilih, masih bisa dilacak
  // & dipulihkan lagi ke versi lain kapan pun, tidak ada jejak yg hilang.
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

// ROUTE INI DIPANGGIL TIAP KALI TOMBOL "Update RPS" DITEKAN DI HALAMAN EDIT RPS.
// selain nyimpen perubahannya, di sinilah revisi baru tercipta (lihat createRpsRevision
// di bagian bawah fungsi ini) jadi route ini jadi salah satu "sumber utama" data
// yg masuk ke fitur Riwayat Revisi.
router.post('/edit-rps/:id', isAuthenticated, (req, res) => {
  const rpsId = parseInt(req.params.id, 10);
  const updatedRpsData = normalizeRpsPayload(req.body); // rapiin data form yg baru dikirim

  const rawData = fs.readFileSync(rpsPath);
  let rps = JSON.parse(rawData);

  const index = rps.findIndex(r => r.id === rpsId);

  if (index === -1) {
    return res.status(404).send('RPS not found.');
  }

  // cuma pemilik RPS atau admin yg boleh nyimpen perubahan
  if (rps[index].userId !== req.session.user.id && req.session.user.role !== 'admin') {
    return res.status(403).send('You do not have permission to edit this RPS.');
  }

  // gabungin data LAMA dgn data BARU dari form (data baru menimpa yg lama kalau ada field yg sama)
  const originalRps = rps[index]; // simpan dulu versi SEBELUM diedit, dipakai buat perbandingan nanti
  const newRpsData = normalizeRpsPayload({ ...originalRps, ...updatedRpsData });

  // walaupun admin yg ngedit, kepemilikan RPS-nya (userId) TETAP milik dosen aslinya, tidak ikut pindah
  newRpsData.userId = originalRps.userId;

  // field cpmk[...] & sub_cpmk[...] yg LAMA dibuang dulu, biar nanti diganti TOTAL sama yg
  // baru dari form. kalau tidak gini, sub-cpmk yg dihapus user di form tidak akan beneran
  // kehapus dari data tersimpan (soalnya cuma "ditimpa sebagian", bukan diganti semua).
  const fieldsToKeep = Object.keys(newRpsData).filter(k => !k.startsWith('cpmk[') && !k.startsWith('sub_cpmk['));
  let cleanedRps = {};
  fieldsToKeep.forEach(k => {
    cleanedRps[k] = newRpsData[k];
  });

  // baru sekarang gabungin lagi dgn cpmk/sub_cpmk yg BARU dari form
  const finalRpsData = normalizeRpsPayload({ ...cleanedRps, ...updatedRpsData });

  // kunci ulang field2 penting supaya tidak ikut berubah gara2 isi form (jaga2 kalau ada
  // field tersembunyi yg ke-utak-atik)
  finalRpsData.id = rpsId;
  finalRpsData.userId = originalRps.userId;
  finalRpsData.created_at = originalRps.created_at || null;
  finalRpsData.updated_at = new Date().toISOString();
  finalRpsData.updated_by = req.session.user.id;
  finalRpsData.updated_by_username = req.session.user.username;

  // BAGIAN RIWAYAT REVISI DIMULAI DI SINI:
  // bandingin versi SEBELUM (originalRps) & SESUDAH (finalRpsData) diedit, buat tau
  // field apa aja yg berubah + statistiknya (added/removed/modified).
  const changedFields = getChangedFieldNames(originalRps, finalRpsData);
  const changeStats = getChangeStats(originalRps, finalRpsData);

  // kalau RPS ini blm pernah punya riwayat sama sekali (RPS lama dari sebelum fitur ini
  // ada), bikinin dulu "versi awal"-nya, biar nanti masih bisa dipulihkan ke kondisi
  // SEBELUM edit yg pertama kali ini terjadi.
  ensureInitialRevision(originalRps, getUserById(originalRps.userId) || req.session.user);

  rps[index] = finalRpsData; // RPS aktif resmi diganti dgn versi baru

  writeJsonFile(rpsPath, rps); // simpan ke rps.json

  // catat hasil edit ini sbg 1 revisi baru di riwayat (lihat createRpsRevision di atas)
  createRpsRevision(finalRpsData, req.session.user, {
    action: 'edit',
    message: 'RPS diperbarui',
    changed_fields: changedFields,
    change_stats: changeStats
  });

  // halaman Edit RPS ngirim form-nya pakai fetch() javascript (bukan submit form biasa),
  // jadi responnya harus JSON, bukan redirect ke halaman lain.
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

    // Ikut hapus semua riwayat edit (rps_history) milik RPS ini. kalau
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

// ROUTE GET. dibuka pas user klik menu "Upload RPS". tugasnya cuma nampilin
// halaman formnya (upload-rps.ejs), belum ada proses apa2. error & success sengaja
// dikirim null krn ini kondisi awal (baru buka halaman, belum ada aksi apa2 yg terjadi).
router.get('/upload-rps', isAuthenticated, (req, res) => {
  res.render('upload-rps', { title: 'Upload RPS', user: req.session.user, error: null, success: null });
});

// ROUTE POST. ini yg jalan pas user klik tombol "Upload" di form. alurnya:
// 1) tangkep file yg diupload lewat multer
// 2) file-nya dibaca & "dibedah" isinya (manggil skrip python di belakang layar)
// 3) hasil bedahannya dirapiin jadi RPS baru & disimpan
// 4) user diarahkan ke halaman detail RPS yg baru jadi
router.post('/upload-rps', isAuthenticated, (req, res) => {
  if (!uploadRpsFile) {
    // uploadRpsFile null artinya package multer belum ke-install (lihat bagian atas file ini).
    // daripada aplikasi error/crash, kasih pesan yg jelas ke user apa yg harus dilakukan.
    return res.status(500).render('upload-rps', {
      title: 'Upload RPS',
      user: req.session.user,
      success: null,
      error: 'Fitur upload file belum aktif karena package multer belum terinstall. Jalankan npm install, lalu restart server.'
    });
  }

  // uploadRpsFile.single('rpsFile') = middleware multer yg nangkep 1 file dari field
  // bernama "rpsFile" (harus sama persis dgn name="rpsFile" di <input> pada form html-nya).
  // setelah file ketangkep & disimpan ke disk (sesuai konfigurasi storage di atas),
  // hasilnya (nama file, path di disk, dst) otomatis ditaruh di req.file, lalu callback
  // async (uploadError) => {...} ini dijalankan.
  uploadRpsFile.single('rpsFile')(req, res, async (uploadError) => {
    if (uploadError) {
      // gagal pas proses upload itu sendiri, misal: file bukan .docx (ditolak fileFilter),
      // atau ukurannya kelewat 15MB (ditolak limits.fileSize).
      return res.status(400).render('upload-rps', {
        title: 'Upload RPS',
        user: req.session.user,
        success: null,
        error: uploadError.message || 'Gagal mengupload file.'
      });
    }

    if (!req.file) {
      // req.file kosong artinya user klik "Upload" tanpa milih file sama sekali
      return res.status(400).render('upload-rps', {
        title: 'Upload RPS',
        user: req.session.user,
        success: null,
        error: 'Pilih file Word (.docx) terlebih dahulu.'
      });
    }

    // dari sini file-nya UDAH ADA & VALID di disk (di req.file.path).
    // try/catch dipasang krn proses baca .docx (lewat python) bisa gagal macem2
    // (dokumen rusak, format tidak dikenali, python error, dst).
    try {
      const config = readJsonFile(configPath, {}); // config.json isinya nilai2 default (mis. nama penjamin mutu)
      const fileBuffer = fs.readFileSync(req.file.path); // baca isi file dari disk sbg data mentah (Buffer)

      // INI BAGIAN INTINYA: fileBuffer dikasih ke parseRpsDocxBuffer, yg di baliknya bakal
      // manggil skrip python buat "membedah" tabel di dalam file .docx (lihat rpsDocxParser.js
      // & docx_extractor.py). hasilnya (rpsData) itu data RPS yg formatnya udah sama kayak
      // kalau user isi form Edit RPS manual, siap langsung dipakai/disimpan.
      // "fallback" isinya nilai cadangan kalau ada bagian dokumen yg gagal kebaca, misal
      // kalau nama penjamin mutu tidak ketemu di dokumen, dipakai config.penjamin_mutu.
      const { rpsData } = await parseRpsDocxBuffer(fileBuffer, {
        fileName: req.file.originalname,
        fallback: {
          username: req.session.user.username,
          penjamin_mutu: config.penjamin_mutu || '',
          koordinator_program_studi: config.koordinator_program_studi || '',
          activeCplId: config.activeCplId || ''
        }
      });

      // sampai sini rpsData udah siap. sekarang tinggal disimpan jadi RPS baru:
      const rps = readJsonFile(rpsPath, []); // ambil semua RPS yg udah ada
      const newId = getNextNumericId(rps); // hitung id baru (angka terbesar + 1)
      const now = new Date().toISOString();

      // gabungin hasil ekstraksi (rpsData) dgn info kepemilikan & waktu.
      // normalizeRpsPayload = fungsi yg merapikan struktur field2-nya (didefinisikan di
      // bagian lain file ini), supaya bentuknya konsisten sama RPS yg dibuat lewat form manual.
      const finalRpsData = normalizeRpsPayload({
        ...rpsData,
        id: newId,
        userId: req.session.user.id, // penanda "RPS ini punya siapa"
        created_at: now,
        updated_at: now,
        updated_by: req.session.user.id,
        updated_by_username: req.session.user.username
      });

      rps.push(finalRpsData); // tambahin RPS baru ke daftar
      writeJsonFile(rpsPath, rps); // simpan balik SELURUH daftar RPS (lama + baru) ke rps.json

      // langsung catat sbg revisi PERTAMA di riwayat (lihat createRpsRevision di bawah,
      // bagian Riwayat Revisi) jadi RPS hasil upload otomatis punya jejak riwayat sejak awal,
      // bukan baru punya riwayat pas diedit yg pertama kali.
      createRpsRevision(finalRpsData, req.session.user, {
        action: 'upload_docx',
        message: `RPS dibuat dari upload Word: ${req.file.originalname || 'file'}`
      });

      safeUnlink(req.file.path); // file .docx yg tadi disimpan sementara di disk, hapus (udah tidak perlu lagi)
      // arahkan browser ke halaman detail RPS yg baru dibuat. ?uploaded=1 dipakai halaman
      // tujuan buat nampilin notifikasi "berhasil diupload".
      return res.redirect(`/history/view/${newId}?uploaded=1`);
    } catch (error) {
      // apa pun yg gagal di blok try di atas (paling sering: python gagal baca dokumen)
      // ditangkep di sini, biar user dikasih pesan yg jelas, bukan halaman error putih polos.
      console.error('[UPLOAD RPS] Gagal mengekstrak file:', error);
      safeUnlink(req.file && req.file.path); // bersihin file sementara meskipun gagal
      return res.status(500).render('upload-rps', {
        title: 'Upload RPS',
        user: req.session.user,
        success: null,
        error: `Gagal membaca isi file. ${error.message || 'Format file mungkin tidak terbaca.'}`
      });
    }
  });
});

// Admin: manage mahasiswa page
router.get('/admin/mahasiswa', isAuthenticated, isAdmin, (req, res) => {
  const mahasiswa = readJsonFile(mahasiswaPath, []);
  const kelas = readJsonFile(kelasPath, []);
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const pageSize = 20;

  const sortedMahasiswa = sortMahasiswa(mahasiswa);
  const totalPages = Math.max(1, Math.ceil(sortedMahasiswa.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const pagedMahasiswa = sortedMahasiswa.slice(startIndex, startIndex + pageSize);

  res.render('admin-mahasiswa', {
    title: 'Admin - Kelola Mahasiswa',
    user: req.session.user,
    mahasiswa: pagedMahasiswa,
    kelas,
    req,
    currentPage: safePage,
    totalPages,
    totalItems: sortedMahasiswa.length
  });
});

router.post('/admin/mahasiswa', isAuthenticated, isAdmin, (req, res) => {
  const nim = String(req.body.nim || '').trim();
  const nama = String(req.body.nama || '').trim();
  const kelasId = String(req.body.kelasId || '').trim();

  if (!nim || !nama || !kelasId) {
    return res.redirect('/admin/mahasiswa?error=missing');
  }

  const mahasiswa = readJsonFile(mahasiswaPath, []);
  const exists = mahasiswa.some(item => String(item.nim) === nim);

  if (exists) {
    return res.redirect('/admin/mahasiswa?error=duplicate');
  }

  const id = generateStudentId(mahasiswa, kelasId);

  mahasiswa.push({ id, nim, nama, kelasId });
  writeJsonFile(mahasiswaPath, mahasiswa);

  return res.redirect('/admin/mahasiswa?saved=1');
});

router.post('/admin/mahasiswa/update/:id', isAuthenticated, isAdmin, (req, res) => {
  const currentId = String(req.params.id || '').trim();
  const nim = String(req.body.nim || '').trim();
  const nama = String(req.body.nama || '').trim();
  const kelasId = String(req.body.kelasId || '').trim();

  if (!nim || !nama || !kelasId) {
    return res.redirect('/admin/mahasiswa?error=missing');
  }

  const mahasiswa = readJsonFile(mahasiswaPath, []);
  const index = mahasiswa.findIndex(item => String(item.id) === currentId);

  if (index === -1) {
    return res.redirect('/admin/mahasiswa?error=not-found');
  }

  const duplicate = mahasiswa.some((item, idx) => {
    if (idx === index) return false;
    return String(item.nim) === nim;
  });

  if (duplicate) {
    return res.redirect('/admin/mahasiswa?error=duplicate');
  }

  const generatedId = generateStudentId(mahasiswa, kelasId, mahasiswa[index].id);

  mahasiswa[index] = { ...mahasiswa[index], id: generatedId, nim, nama, kelasId };
  writeJsonFile(mahasiswaPath, mahasiswa);

  return res.redirect('/admin/mahasiswa?updated=1');
});

router.post('/admin/mahasiswa/delete/:id', isAuthenticated, isAdmin, (req, res) => {
  const currentId = String(req.params.id || '').trim();
  const mahasiswa = readJsonFile(mahasiswaPath, []);
  const filtered = mahasiswa.filter(item => String(item.id) !== currentId);

  if (filtered.length === mahasiswa.length) {
    return res.redirect('/admin/mahasiswa?error=not-found');
  }

  writeJsonFile(mahasiswaPath, filtered);
  return res.redirect('/admin/mahasiswa?deleted=1');
});

module.exports = router;