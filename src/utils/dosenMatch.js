// modul kecil buat nyocokin nama dosen pengampu (teks bebas dari form/dokumen) ke akun
// user yg terdaftar (users.json). dipakai supaya co-dosen yg namanya cocok bisa otomatis
// dapat akses edit RPS pas upload docx. sengaja SEDERHANA: cuma exact-match setelah nama
// dinormalisasi (gelar dibuang), TIDAK ada fuzzy/typo-tolerant matching -- kalau tidak
// yakin cocok, mending dilewati (biar bisa dihubungkan manual belakangan) drpd salah
// nyambungin ke akun orang lain.

// daftar gelar/sapaan yg suka nempel di depan nama, mis. "Dr. Ir. Budi" -> "Budi"
const HONORIFIC_PREFIXES = [
  'prof', 'dr', 'ir', 'drs', 'dra', 'h', 'hj'
];

// buang gelar akademik & sapaan dari nama mentah, sisain nama intinya aja buat dibandingkan
function normalizeDosenName(raw) {
  let name = String(raw || '')
    .split(',')[0] // gelar di belakang nama (S.T., M.Kom, PhD, dst) selalu setelah koma pertama
    .trim();

  // lucuti sapaan/gelar di depan nama, bisa nempel berlapis (mis. "Dr. Ir. Budi")
  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const prefix of HONORIFIC_PREFIXES) {
      const re = new RegExp(`^${prefix}\\.?\\s+`, 'i');
      if (re.test(name)) {
        name = name.replace(re, '');
        stripped = true;
      }
    }
  }

  return name
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// cari SATU akun dosen aktif yg nama_lengkap-nya (ternormalisasi) persis sama dgn `name`.
// balikin null kalau tidak ada yg cocok ATAU ada lebih dari 1 yg cocok (ambigu) --
// keduanya sengaja diperlakukan sama: jangan nebak, biarkan tidak terhubung.
function findActiveDosenIdByName(name, users) {
  const target = normalizeDosenName(name);
  if (!target) return null;

  const candidates = (Array.isArray(users) ? users : []).filter(u =>
    u.role === 'dosen' &&
    u.status === 'active' &&
    u.nama_lengkap &&
    normalizeDosenName(u.nama_lengkap) === target
  );

  return candidates.length === 1 ? candidates[0].id : null;
}

// convenience wrapper: dari daftar nama dosen_pengampu (teks bebas), balikin array PARALEL
// (urutan & panjang sama persis dgn namesArray) berisi id user yg cocok, atau null kalau
// nama itu tidak ke-match ke akun manapun. dipakai supaya tiap baris dosen_pengampu bisa
// "diingat" terhubung ke akun yg mana (atau tidak terhubung sama sekali).
function matchDosenPengampuToUserIds(namesArray, users) {
  return (Array.isArray(namesArray) ? namesArray : [])
    .map(name => findActiveDosenIdByName(name, users));
}

module.exports = {
  normalizeDosenName,
  findActiveDosenIdByName,
  matchDosenPengampuToUserIds
};
