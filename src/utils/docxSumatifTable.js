// Manipulasi XML mentah (word/document.xml) untuk mengubah tabel "Korelasi
// antara CP dan Asesmen" di template.docx dari 5 kolom SUMATIF tetap
// (Kuis/Tugas/Ujian/PjBL/Lainnya) jadi N kolom dinamis sesuai kategori yang
// benar-benar dipakai RPS tsb (lihat src/utils/sumatifColumns.js).
//
// Prinsip: kolom baru dibuat dengan MENGKLON sel yang sudah ada (bukan
// ditulis dari nol) supaya styling (font, border, alignment) identik. Sel
// baru cuma berisi placeholder baru ({sumatif_hdr_N} / {sumatif_N}) -- nilai
// sebenarnya tetap disuntik lewat docxtemplater seperti biasa, jadi escaping
// karakter spesial tetap ditangani docxtemplater, bukan modul ini.
//
// Kalau struktur template.docx berubah di masa depan sehingga anchor yang
// dicari di sini tidak ketemu, fungsi ini SENGAJA throw (bukan diam-diam
// lanjut) supaya caller bisa fallback ke template statis lama.

function escapeXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

function distribute(total, n) {
  const base = Math.floor(total / n);
  const rem = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
}

function isTagBoundary(xml, idx) {
  const ch = xml[idx];
  return ch === '>' || ch === ' ' || ch === '/';
}

// Pecah xml jadi daftar elemen top-level <tagName>...</tagName>, dengan
// depth-counting supaya tidak salah tangkap tag lain yang berawalan sama
// (mis. <w:tc> vs <w:tcPr>/<w:tcW>).
function splitTopLevel(xml, tagName) {
  const openPrefix = '<' + tagName;
  const closeTag = '</' + tagName + '>';
  const results = [];
  let searchStart = 0;
  while (true) {
    const openIdx = xml.indexOf(openPrefix, searchStart);
    if (openIdx === -1) break;
    if (!isTagBoundary(xml, openIdx + openPrefix.length)) {
      searchStart = openIdx + openPrefix.length;
      continue;
    }
    const tagCloseIdx = xml.indexOf('>', openIdx);
    if (tagCloseIdx === -1) throw new Error('[sumatif] malformed xml: unterminated tag <' + tagName);
    let depth = 1;
    let cursor = tagCloseIdx + 1;
    while (depth > 0) {
      const nextOpen = xml.indexOf(openPrefix, cursor);
      const nextClose = xml.indexOf(closeTag, cursor);
      if (nextClose === -1) throw new Error('[sumatif] malformed xml: unbalanced <' + tagName + '>');
      if (nextOpen !== -1 && nextOpen < nextClose && isTagBoundary(xml, nextOpen + openPrefix.length)) {
        depth++;
        const innerTagCloseIdx = xml.indexOf('>', nextOpen);
        cursor = innerTagCloseIdx + 1;
      } else {
        depth--;
        cursor = nextClose + closeTag.length;
      }
    }
    results.push({ start: openIdx, end: cursor, xml: xml.slice(openIdx, cursor) });
    searchStart = cursor;
  }
  return results;
}

// Bangun sel <w:tc> baru dengan mengklon styling dari sel prototype yang
// sudah ada, cuma ganti lebar & isi teksnya.
function makeCellFromProto(protoTc, widthTwips, text) {
  const tcPrMatch = protoTc.match(/<w:tcPr>[\s\S]*?<\/w:tcPr>/);
  if (!tcPrMatch) throw new Error('[sumatif] prototype cell has no <w:tcPr>');
  const w = String(Math.max(0, Math.round(Number(widthTwips) || 0)));
  const tcPr = /<w:tcW w:w="\d+" w:type="dxa"\/>/.test(tcPrMatch[0])
    ? tcPrMatch[0].replace(/<w:tcW w:w="\d+" w:type="dxa"\/>/, `<w:tcW w:w="${w}" w:type="dxa"/>`)
    : tcPrMatch[0].replace('<w:tcPr>', `<w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>`);

  const pPrMatch = protoTc.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
  const pPr = pPrMatch ? pPrMatch[0] : '';

  const afterPPr = pPrMatch ? protoTc.slice(protoTc.indexOf(pPrMatch[0]) + pPrMatch[0].length) : protoTc;
  const rPrMatch = afterPPr.match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
  const runRPr = rPrMatch ? rPrMatch[0] : '';

  const safeText = escapeXml(text);
  const run = safeText === '' ? '' : `<w:r>${runRPr}<w:t xml:space="preserve">${safeText}</w:t></w:r>`;

  return `<w:tc>${tcPr}<w:p>${pPr}${run}</w:p></w:tc>`;
}

function replaceCellRange(rowXml, fromIdx, count, newCellXmls) {
  const cells = splitTopLevel(rowXml, 'w:tc');
  if (fromIdx + count > cells.length) {
    throw new Error(`[sumatif] cell range out of bounds: fromIdx=${fromIdx} count=${count} total=${cells.length}`);
  }
  const rangeStart = cells[fromIdx].start;
  const rangeEnd = cells[fromIdx + count - 1].end;
  return rowXml.slice(0, rangeStart) + newCellXmls.join('') + rowXml.slice(rangeEnd);
}

function rowGridSpanSum(rowXml) {
  return splitTopLevel(rowXml, 'w:tc').reduce((sum, c) => {
    const m = c.xml.match(/<w:gridSpan w:val="(\d+)"\/>/);
    return sum + (m ? parseInt(m[1], 10) : 1);
  }, 0);
}

const SUMATIF_GRID_START = 5; // index 0-based di <w:tblGrid> tempat blok SUMATIF dimulai
const SUMATIF_GRID_COUNT = 5; // jumlah kolom SUMATIF tetap di template asli (Kuis/Tugas/Ujian/PjBL/Lainnya)
const EXPECTED_GRID_COUNT = 11;

function applyDynamicSumatifColumns(documentXml, columns) {
  const N = columns.length;
  if (!N) throw new Error('[sumatif] columns kosong');

  const anchorIdx = documentXml.indexOf('kuis_display');
  if (anchorIdx === -1) throw new Error('[sumatif] anchor "kuis_display" tidak ditemukan');
  const tblStart = documentXml.lastIndexOf('<w:tbl>', anchorIdx);
  const tblEndTagIdx = documentXml.indexOf('</w:tbl>', anchorIdx);
  if (tblStart === -1 || tblEndTagIdx === -1) throw new Error('[sumatif] <w:tbl> pembungkus tidak ditemukan');
  const tblEnd = tblEndTagIdx + '</w:tbl>'.length;

  let table = documentXml.slice(tblStart, tblEnd);

  if (table.indexOf('<w:tbl>', 1) !== -1) {
    throw new Error('[sumatif] ditemukan <w:tbl> bersarang di dalam tabel asesmen, tidak didukung');
  }
  const requiredAnchors = [
    'tugas_display', 'ujian_display', 'pjbl_display', 'lainnya_display',
    '>SUMATIF<', 'BENTUK ASESMEN', '>Kuis<',
  ];
  requiredAnchors.forEach(a => {
    if (table.indexOf(a) === -1) throw new Error('[sumatif] anchor hilang: ' + a);
  });

  // --- 1) tblGrid: ganti 5 gridCol SUMATIF jadi N gridCol baru ---
  const gridBlockMatch = table.match(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/);
  if (!gridBlockMatch) throw new Error('[sumatif] <w:tblGrid> tidak ditemukan');
  const gridBlock = gridBlockMatch[0];
  const cols = [...gridBlock.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map(m => parseInt(m[1], 10));
  if (cols.length !== EXPECTED_GRID_COUNT) {
    throw new Error(`[sumatif] expected ${EXPECTED_GRID_COUNT} gridCol, got ${cols.length}`);
  }
  const sumatifCols = cols.slice(SUMATIF_GRID_START, SUMATIF_GRID_START + SUMATIF_GRID_COUNT);
  const sumatifTotal = sumatifCols.reduce((a, b) => a + b, 0);
  const formatifWidth = cols[SUMATIF_GRID_START - 1];
  const widths = distribute(sumatifTotal, N);
  const newCols = [
    ...cols.slice(0, SUMATIF_GRID_START),
    ...widths,
    ...cols.slice(SUMATIF_GRID_START + SUMATIF_GRID_COUNT),
  ];
  const newGridBlock = '<w:tblGrid>' + newCols.map(w => `<w:gridCol w:w="${w}"/>`).join('') + '</w:tblGrid>';
  table = table.replace(gridBlock, newGridBlock);

  // --- 2) klasifikasi 5 baris tabel berdasarkan isinya ---
  const rows = splitTopLevel(table, 'w:tr');
  if (rows.length !== 5) throw new Error(`[sumatif] expected 5 <w:tr>, got ${rows.length}`);

  const rowTop = rows.find(r => r.xml.includes('BENTUK ASESMEN'));
  const rowMid = rows.find(r => r.xml.includes('>SUMATIF<'));
  const rowSub = rows.find(r => r.xml.includes('>Kuis<'));
  const rowLoop = rows.find(r => r.xml.includes('kuis_display'));
  const rowTotal = rows.find(r => r !== rowTop && r !== rowMid && r !== rowSub && r !== rowLoop);
  if (!rowTop || !rowMid || !rowSub || !rowLoop || !rowTotal) {
    throw new Error('[sumatif] gagal mengklasifikasi baris tabel asesmen');
  }

  // --- 3) row "BENTUK ASESMEN": gridSpan 6 -> 1+N, tcW += (sumatifTotal tetap sama) ---
  const topCells = splitTopLevel(rowTop.xml, 'w:tc');
  const topTargetIdx = topCells.findIndex(c => c.xml.includes('BENTUK ASESMEN'));
  if (topTargetIdx === -1) throw new Error('[sumatif] sel "BENTUK ASESMEN" tidak ditemukan');
  const topTarget = topCells[topTargetIdx];
  const newTopTarget = topTarget.xml
    .replace(/<w:gridSpan w:val="\d+"\/>/, `<w:gridSpan w:val="${1 + N}"/>`)
    .replace(/<w:tcW w:w="\d+" w:type="dxa"\/>/, `<w:tcW w:w="${formatifWidth + sumatifTotal}" w:type="dxa"/>`);
  const newRowTop = rowTop.xml.slice(0, topTarget.start) + newTopTarget + rowTop.xml.slice(topTarget.end);

  // --- 4) row "SUMATIF": gridSpan 5 -> N (dihapus kalau N===1), tcW -> sumatifTotal ---
  const midCells = splitTopLevel(rowMid.xml, 'w:tc');
  const midTargetIdx = midCells.findIndex(c => c.xml.includes('>SUMATIF<'));
  if (midTargetIdx === -1) throw new Error('[sumatif] sel "SUMATIF" tidak ditemukan');
  const midTarget = midCells[midTargetIdx];
  let newMidTarget = midTarget.xml.replace(/<w:tcW w:w="\d+" w:type="dxa"\/>/, `<w:tcW w:w="${sumatifTotal}" w:type="dxa"/>`);
  newMidTarget = N === 1
    ? newMidTarget.replace(/<w:gridSpan w:val="\d+"\/>/, '')
    : newMidTarget.replace(/<w:gridSpan w:val="\d+"\/>/, `<w:gridSpan w:val="${N}"/>`);
  const newRowMid = rowMid.xml.slice(0, midTarget.start) + newMidTarget + rowMid.xml.slice(midTarget.end);

  // --- 5) row header sub-kolom (Kuis/Tugas/Ujian/PjBL/Lainnya) -> N sel klon ---
  const subCells = splitTopLevel(rowSub.xml, 'w:tc');
  if (subCells.length !== EXPECTED_GRID_COUNT) throw new Error(`[sumatif] row header sub-kolom: expected ${EXPECTED_GRID_COUNT} sel, got ${subCells.length}`);
  if (!subCells[SUMATIF_GRID_START].xml.includes('>Kuis<')) throw new Error('[sumatif] posisi sel "Kuis" tidak sesuai perkiraan');
  const headerProto = subCells[SUMATIF_GRID_START].xml;
  const newHeaderCells = columns.map((c, i) => makeCellFromProto(headerProto, widths[i], `{sumatif_hdr_${i}}`));
  const newRowSub = replaceCellRange(rowSub.xml, SUMATIF_GRID_START, SUMATIF_GRID_COUNT, newHeaderCells);

  // --- 6) row loop data ({kuis_display} dst.) -> N sel klon ---
  const loopCells = splitTopLevel(rowLoop.xml, 'w:tc');
  if (loopCells.length !== EXPECTED_GRID_COUNT) throw new Error(`[sumatif] row data loop: expected ${EXPECTED_GRID_COUNT} sel, got ${loopCells.length}`);
  if (!loopCells[SUMATIF_GRID_START].xml.includes('kuis_display')) throw new Error('[sumatif] posisi sel "kuis_display" tidak sesuai perkiraan');
  const dataProto = loopCells[SUMATIF_GRID_START].xml;
  const newDataCells = columns.map((c, i) => makeCellFromProto(dataProto, widths[i], `{sumatif_${i}}`));
  const newRowLoop = replaceCellRange(rowLoop.xml, SUMATIF_GRID_START, SUMATIF_GRID_COUNT, newDataCells);

  // --- 7) row total -> N sel klon kosong ---
  const totalCells = splitTopLevel(rowTotal.xml, 'w:tc');
  if (totalCells.length !== EXPECTED_GRID_COUNT) throw new Error(`[sumatif] row total: expected ${EXPECTED_GRID_COUNT} sel, got ${totalCells.length}`);
  const emptyProto = totalCells[SUMATIF_GRID_START].xml;
  const newEmptyCells = widths.map(w => makeCellFromProto(emptyProto, w, ''));
  const newRowTotal = replaceCellRange(rowTotal.xml, SUMATIF_GRID_START, SUMATIF_GRID_COUNT, newEmptyCells);

  // --- 8) susun ulang tabel dengan baris-baris baru, urutan asli dipertahankan ---
  const replacements = new Map([
    [rowTop, newRowTop],
    [rowMid, newRowMid],
    [rowSub, newRowSub],
    [rowLoop, newRowLoop],
    [rowTotal, newRowTotal],
  ]);
  let rebuilt = '';
  let cursor = 0;
  rows.forEach(row => {
    rebuilt += table.slice(cursor, row.start);
    rebuilt += replacements.get(row);
    cursor = row.end;
  });
  rebuilt += table.slice(cursor);
  table = rebuilt;

  // --- 9) post-condition: total gridSpan tiap baris & jumlah gridCol harus konsisten ---
  const expectedSpan = 6 + N;
  const finalRows = splitTopLevel(table, 'w:tr');
  if (finalRows.length !== 5) throw new Error('[sumatif] jumlah baris berubah setelah transformasi');
  finalRows.forEach((r, i) => {
    const sum = rowGridSpanSum(r.xml);
    if (sum !== expectedSpan) {
      throw new Error(`[sumatif] grid mismatch di baris ${i}: sum=${sum} expected=${expectedSpan}`);
    }
  });
  const finalGridBlock = table.match(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/)[0];
  const finalColCount = [...finalGridBlock.matchAll(/<w:gridCol/g)].length;
  if (finalColCount !== expectedSpan) {
    throw new Error(`[sumatif] jumlah gridCol (${finalColCount}) != expected (${expectedSpan})`);
  }

  return documentXml.slice(0, tblStart) + table + documentXml.slice(tblEnd);
}

module.exports = {
  escapeXml,
  distribute,
  splitTopLevel,
  makeCellFromProto,
  applyDynamicSumatifColumns,
  SUMATIF_GRID_START,
};
