// Menentukan daftar kolom "Bentuk Asesmen Sumatif" yang dinamis per RPS,
// dipakai oleh export.js (route /export/word-1-dinamis/:id) dan
// docxSumatifTable.js untuk membangun ulang tabel Word sesuai kategori
// yang benar-benar dipakai RPS tsb (bukan 5 kolom tetap Kuis/Tugas/Ujian/PjBL/Lainnya).

const FIXED_CATEGORIES = [
  { key: 'kuis', label: 'Kuis' },
  { key: 'tugas', label: 'Tugas' },
  { key: 'ujian', label: 'Ujian' },
  { key: 'pjbl', label: 'PjBL' },
  { key: 'presentasi', label: 'Presentasi' },
];

const MAX_SUMATIF_COLS = 6;
const PLACEHOLDER_EMPTY = '-';

function normText(v) {
  return (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();
}

function normKey(v) {
  return normText(v).toLowerCase();
}

function isUsed(nama, bobot) {
  return normText(nama) !== '' || normText(bobot) !== '';
}

function parseLainnya(raw) {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.filter(item => item && typeof item === 'object') : [];
  } catch (e) {
    return [];
  }
}

function cellText(label, nama, bobot) {
  const namaTrim = normText(nama);
  const bobotTrim = normText(bobot).replace(/%\s*$/, '');
  const hasNama = namaTrim !== '' && normKey(namaTrim) !== normKey(label);
  const hasBobot = bobotTrim !== '';
  if (hasNama && hasBobot) return `${namaTrim} (${bobotTrim}%)`;
  if (hasNama) return namaTrim;
  if (hasBobot) return `${bobotTrim}%`;
  return PLACEHOLDER_EMPTY;
}

// Kumpulkan daftar kolom sumatif dinamis dari semua sub_cpmk sebuah RPS.
// Urutan: kategori tetap (kanonik) dulu (kalau dipakai), lalu entri "lainnya"
// sesuai urutan kemunculan pertama di data.
function buildSumatifColumns(subCpmkArray) {
  const subs = Array.isArray(subCpmkArray) ? subCpmkArray : [];
  const columns = [];
  const keyToColumn = new Map();

  FIXED_CATEGORIES.forEach(cat => {
    const used = subs.some(sub => isUsed(sub[`sumatif_${cat.key}_nama`], sub[`sumatif_${cat.key}_bobot`]));
    if (used) {
      const col = { kind: 'fixed', key: cat.key, label: cat.label };
      columns.push(col);
      keyToColumn.set(cat.key, col);
    }
  });

  subs.forEach(sub => {
    const items = parseLainnya(sub.sumatif_lainnya);
    items.forEach(item => {
      if (!isUsed(item.nama, item.bobot)) return;
      const namaNorm = normText(item.nama);
      const key = namaNorm === '' ? '__unnamed__' : normKey(namaNorm);
      const label = namaNorm === '' ? 'Lainnya' : namaNorm;
      if (keyToColumn.has(key)) return;
      const col = { kind: 'lainnya', key, label };
      columns.push(col);
      keyToColumn.set(key, col);
    });
  });

  if (columns.length === 0) {
    return [{ kind: 'empty', key: '__empty__', label: 'Sumatif' }];
  }

  if (columns.length > MAX_SUMATIF_COLS) {
    return [{ kind: 'collapsed', key: '__collapsed__', label: 'Sumatif', sourceColumns: columns }];
  }

  return columns;
}

// Nilai sel per sub_cpmk untuk daftar kolom yang sudah ditentukan.
// Return: { sumatif_0: 'Nama (Bobot%)', sumatif_1: '-', ... }
function buildSumatifRowValues(sub, columns) {
  const result = {};

  if (columns.length === 1 && columns[0].kind === 'collapsed') {
    const parts = columns[0].sourceColumns
      .map(col => rowValueForColumn(sub, col))
      .filter(text => text && text !== PLACEHOLDER_EMPTY);
    result.sumatif_0 = parts.length ? parts.join('\n') : PLACEHOLDER_EMPTY;
    return result;
  }

  if (columns.length === 1 && columns[0].kind === 'empty') {
    result.sumatif_0 = PLACEHOLDER_EMPTY;
    return result;
  }

  columns.forEach((col, i) => {
    result[`sumatif_${i}`] = rowValueForColumn(sub, col);
  });
  return result;
}

function rowValueForColumn(sub, col) {
  if (col.kind === 'fixed') {
    return cellText(col.label, sub[`sumatif_${col.key}_nama`], sub[`sumatif_${col.key}_bobot`]);
  }
  if (col.kind === 'lainnya') {
    const items = parseLainnya(sub.sumatif_lainnya).filter(item => {
      const namaNorm = normText(item.nama);
      const key = namaNorm === '' ? '__unnamed__' : normKey(namaNorm);
      return key === col.key;
    });
    const texts = items
      .map(item => cellText(col.label, item.nama, item.bobot))
      .filter(text => text && text !== PLACEHOLDER_EMPTY);
    return texts.length ? texts.join('\n') : PLACEHOLDER_EMPTY;
  }
  return PLACEHOLDER_EMPTY;
}

// Bangun data siap-pakai untuk render: daftar kolom + object header (sumatif_hdr_0, ...)
// dan sub_cpmk yang sudah disisipi sumatif_0, sumatif_1, ...
function buildSumatifRenderData(subCpmkArray) {
  const subs = Array.isArray(subCpmkArray) ? subCpmkArray : [];
  const columns = buildSumatifColumns(subs);
  const headerData = {};
  columns.forEach((col, i) => {
    headerData[`sumatif_hdr_${i}`] = col.label;
  });
  return { columns, headerData };
}

module.exports = {
  FIXED_CATEGORIES,
  MAX_SUMATIF_COLS,
  PLACEHOLDER_EMPTY,
  normText,
  normKey,
  isUsed,
  parseLainnya,
  cellText,
  buildSumatifColumns,
  buildSumatifRowValues,
  buildSumatifRenderData,
};
