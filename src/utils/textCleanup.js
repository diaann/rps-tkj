// Pembersihan teks generik untuk data yang masuk ke ekspor Word: membuang
// baris kosong berlebih (2+ newline berturut-turut) yang bisa lolos dari
// input manual (textarea) -- data hasil upload docx sudah bersih dari sononya
// lewat clean_multiline() di src/utils/rps_common.py, tapi jalur input manual
// (src/routes/index.js -> normalizeRpsPayload) tidak melakukan pembersihan
// serupa. Newline TUNGGAL (pemisah baris yang memang disengaja) tidak disentuh.

function collapseExcessBlankLines(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
}

// Jalan rekursif ke seluruh object/array/string dan bersihkan tiap string leaf.
// Tidak memutasi input -- selalu mengembalikan struktur baru.
function cleanTextFields(value) {
  if (typeof value === 'string') return collapseExcessBlankLines(value);
  if (Array.isArray(value)) return value.map(cleanTextFields);
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach(key => {
      out[key] = cleanTextFields(value[key]);
    });
    return out;
  }
  return value;
}

module.exports = {
  collapseExcessBlankLines,
  cleanTextFields,
};
