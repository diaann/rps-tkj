// Auto-merge kolom FORMATIF di tabel "Korelasi antara CP dan Asesmen" untuk
// baris-baris sub-CPMK BERURUTAN yang nilai formatif_nama-nya sama persis --
// murni berdasarkan kesamaan teks berurutan, TIDAK peduli batas CPMK (kalau
// CPMK01..04 semuanya sama, semua baris jadi 1 sel gabungan).
//
// Beda dari applyDynamicSumatifColumns (jalan SEBELUM docxtemplater render,
// karena mengubah struktur satu baris template yang dipakai berulang oleh
// loop {#sub_cpmk}), transform ini WAJIB jalan SETELAH render: baru sesudah
// loop di-unroll docxtemplater jadi N <w:tr> konkret, tiap baris bisa dikasih
// <w:tcPr> vMerge yang berbeda-beda (restart / continue / tidak sama sekali).

const { splitTopLevel, SUMATIF_GRID_START } = require('./docxSumatifTable');

const FORMATIF_CELL_IDX = SUMATIF_GRID_START - 1;

function normFormatif(v) {
  return (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();
}

// subCpmkArray -> array flag sepanjang subCpmkArray.length: 'restart' (baris
// pertama sebuah grup >=2 baris identik berurutan), 'continue' (baris
// lanjutan grup itu), atau 'none' (baris berdiri sendiri, tidak digabung apa pun).
function computeFormatifMergeGroups(subCpmkArray) {
  const subs = Array.isArray(subCpmkArray) ? subCpmkArray : [];
  const flags = new Array(subs.length).fill('none');
  let i = 0;
  while (i < subs.length) {
    const val = normFormatif(subs[i].formatif_nama);
    let j = i + 1;
    while (j < subs.length && normFormatif(subs[j].formatif_nama) === val) {
      j++;
    }
    const groupLen = j - i;
    if (groupLen >= 2) {
      flags[i] = 'restart';
      for (let k = i + 1; k < j; k++) flags[k] = 'continue';
    }
    i = j;
  }
  return flags;
}

function insertVMerge(cellXml, vMergeTag) {
  const tcPrMatch = cellXml.match(/<w:tcPr>[\s\S]*?<\/w:tcPr>/);
  if (!tcPrMatch) throw new Error('[formatif-merge] sel FORMATIF tidak punya <w:tcPr>');
  const newTcPr = tcPrMatch[0].replace('<w:tcPr>', `<w:tcPr>${vMergeTag}`);
  return cellXml.replace(tcPrMatch[0], newTcPr);
}

// Kosongkan isi <w:p> (buang semua <w:r>, pertahankan <w:pPr> kalau ada) --
// konvensi standar Word untuk sel lanjutan vertical-merge: Word mengabaikan
// isinya, tapi dikosongkan biar tidak ada teks "hantu" kalau dibuka software lain.
function emptyParagraphText(cellXml) {
  // <w:p> hasil render docxtemplater biasanya punya atribut (w14:paraId dst.),
  // jadi anchor-nya "<w:p" + boundary, bukan literal "<w:p>" polos.
  return cellXml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/, m => {
    const pPrMatch = m.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
    return `<w:p>${pPrMatch ? pPrMatch[0] : ''}</w:p>`;
  });
}

// documentXml: word/document.xml SETELAH doc.render() (loop sudah di-unroll).
// mergeFlags: hasil computeFormatifMergeGroups(), harus sepanjang jumlah baris data.
function applyFormatifVMerge(documentXml, mergeFlags) {
  if (!mergeFlags.some(f => f !== 'none')) return documentXml;

  const anchor = 'BENTUK ASESMEN';
  const anchorIdx = documentXml.indexOf(anchor);
  if (anchorIdx === -1) throw new Error('[formatif-merge] anchor "BENTUK ASESMEN" tidak ditemukan');
  const tblStart = documentXml.lastIndexOf('<w:tbl>', anchorIdx);
  const tblEndTagIdx = documentXml.indexOf('</w:tbl>', anchorIdx);
  if (tblStart === -1 || tblEndTagIdx === -1) throw new Error('[formatif-merge] <w:tbl> pembungkus tidak ditemukan');
  const tblEnd = tblEndTagIdx + '</w:tbl>'.length;

  let table = documentXml.slice(tblStart, tblEnd);
  if (table.indexOf('<w:tbl>', 1) !== -1) {
    throw new Error('[formatif-merge] ditemukan <w:tbl> bersarang, tidak didukung');
  }

  const rows = splitTopLevel(table, 'w:tr');
  const rowTopIdx = rows.findIndex(r => r.xml.includes('BENTUK ASESMEN'));
  const rowMidIdx = rows.findIndex(r => r.xml.includes('>SUMATIF<'));
  if (rowTopIdx === -1 || rowMidIdx === -1) throw new Error('[formatif-merge] baris header tabel asesmen tidak ditemukan');

  // urutan baris: [rowTop, rowMid, rowSubHeader, ...dataRows, rowTotal]
  const dataStart = rowMidIdx + 2;
  const dataEnd = rows.length - 1;
  const dataRows = rows.slice(dataStart, dataEnd);
  if (dataRows.length !== mergeFlags.length) {
    throw new Error(`[formatif-merge] jumlah baris data (${dataRows.length}) != mergeFlags (${mergeFlags.length})`);
  }

  const replacements = new Map();
  dataRows.forEach((row, i) => {
    const flag = mergeFlags[i];
    if (flag === 'none') return;
    const cells = splitTopLevel(row.xml, 'w:tc');
    if (cells.length <= FORMATIF_CELL_IDX) throw new Error('[formatif-merge] jumlah sel baris data tidak sesuai perkiraan');
    const cell = cells[FORMATIF_CELL_IDX];
    let newCellXml = flag === 'restart'
      ? insertVMerge(cell.xml, '<w:vMerge w:val="restart"/>')
      : emptyParagraphText(insertVMerge(cell.xml, '<w:vMerge/>'));
    const newRow = row.xml.slice(0, cell.start) + newCellXml + row.xml.slice(cell.end);
    replacements.set(row, newRow);
  });

  let rebuilt = '';
  let cursor = 0;
  rows.forEach(row => {
    rebuilt += table.slice(cursor, row.start);
    rebuilt += replacements.has(row) ? replacements.get(row) : row.xml;
    cursor = row.end;
  });
  rebuilt += table.slice(cursor);
  table = rebuilt;

  const finalRows = splitTopLevel(table, 'w:tr');
  if (finalRows.length !== rows.length) {
    throw new Error('[formatif-merge] jumlah baris berubah setelah transformasi');
  }

  return documentXml.slice(0, tblStart) + table + documentXml.slice(tblEnd);
}

module.exports = {
  FORMATIF_CELL_IDX,
  normFormatif,
  computeFormatifMergeGroups,
  applyFormatifVMerge,
};
