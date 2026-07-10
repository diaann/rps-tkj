#!/usr/bin/env python3
"""
rps_common.py

Util & logika ekstraksi yang dipakai oleh docx_extractor.py (Word,
python-docx).

Begitu data sudah dalam bentuk generik "daftar tabel -> daftar baris ->
daftar sel (string atau None)", logika buat mengenali kode CPL/CPMK/Sub-CPMK,
mengklasifikasi kolom Sumatif (Kuis/Tugas/Ujian/PjBL/Lainnya), dan membaca
blok naratif (Deskripsi Singkat, Materi Kajian, Pustaka, Dosen Pengampu, Mata
Kuliah Syarat) dikumpulkan di sini supaya terpisah rapi dari kode baca tabel
docx-nya sendiri.
"""

import re

MONTHS = {
    "januari": 1, "februari": 2, "maret": 3, "april": 4, "mei": 5, "juni": 6,
    "juli": 7, "agustus": 8, "september": 9, "oktober": 10, "november": 11, "desember": 12,
    "january": 1, "february": 2, "march": 3, "may": 5, "june": 6, "july": 7,
    "august": 8, "october": 10, "december": 12,
}

# ---------------------------------------------------------------------------
# Util teks
# ---------------------------------------------------------------------------

def clean(s):
    if not s:
        return ""
    s = str(s)
    s = s.replace("\u00a0", " ")
    s = re.sub(r"[\u200b-\u200d\ufeff]", "", s)
    s = s.replace("\uf0de", "=>").replace("\uf0e0", "=>")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def clean_multiline(s):
    if not s:
        return ""
    lines = [clean(l) for l in str(s).replace("\r", "\n").split("\n")]
    return "\n".join(l for l in lines if l)


def split_numbered_list(s):
    text = clean_multiline(s)
    if not text:
        return []
    flat = text.replace("\n", " ")
    flat = re.sub(r"(?:^|\s)(\d{1,2})[.)]\s+", r"\n\1. ", flat)
    flat = re.sub(r"(?:^|\s)[-•]\s+", r"\n- ", flat)
    items = []
    for item in flat.split("\n"):
        item = re.sub(r"^\d{1,2}[.)]\s*", "", item)
        item = re.sub(r"^-\s*", "", item)
        item = item.strip()
        if item:
            items.append(item)
    return items or ([clean(text)] if clean(text) else [])


def pad_code(prefix, number):
    s = str(number or "").strip()
    m = re.match(r"0*(\d+)(\.\d+)?", s)
    if not m:
        return ""
    integer_part = m.group(1).zfill(2)
    decimal_part = m.group(2) or ""
    return f"{prefix}{integer_part}{decimal_part}"


def extract_cp_tree(all_tables):
    """
    Menyusuri baris-baris tabel (semua halaman) dan membangun pohon
    CPL -> CPMK -> Sub-CPMK berdasarkan kode yang terdeteksi di kolom kiri
    tiap baris tabel, dipasangkan dengan teks deskripsi di kolom kanannya.
    """
    cpl_desc = {}
    cpl_order = []
    cpmk_map = {}
    cpmk_order = []
    subcpmk_map = {}
    subcpmk_order = []

    current_cpl = None
    current_cpmk = None
    in_cp_section = False
    stop_section = False

    for table in all_tables:
        for row in table:
            cells_raw = [c for c in row]
            cells = [clean_multiline(c) for c in cells_raw if c and clean_multiline(c)]
            if not cells:
                continue
            joined = " ".join(cells)

            if re.search(r"CPL[\s-]?PRODI\s+yang\s+dibebankan", joined, re.I):
                in_cp_section = True
                continue
            if re.search(r"Korelasi\s+(?:antara\s+)?CP\s+dan\s+(?:asesmen|assessmen|assessment)", joined, re.I):
                stop_section = True
            if not in_cp_section:
                continue
            if stop_section:
                break

            # baris label pemisah, bukan data
            if re.fullmatch(r"CPL\s*(?:=>|⇒|->)?\s*Capaian\s+Pembelajaran\s+Mata\s+Kuliah\s*(?:\(CPMK\))?", joined, re.I):
                continue
            if re.fullmatch(r"CPMK\s*(?:=>|⇒|->)?\s*Sub-?CPMK", joined, re.I):
                continue

            first_cell = cells[0]
            rest_cells = cells[1:]
            rest = " ".join(rest_cells) if rest_cells else ""
            first_cell_stripped = first_cell.strip()
            first_cell_nows = re.sub(r"\s+", "", first_cell_stripped)
            is_pure_cpl = bool(re.fullmatch(r"CPL-?0*\d+", first_cell_nows, re.I))
            is_pure_cpmk = bool(re.fullmatch(r"CPMK-?0*\d+(?:\.\d+)?", first_cell_nows, re.I))

            # --- Pola "3 sel terpisah": [KodeCPL, KodeCPMK, deskripsi] --
            # ditemukan di beberapa template (mis. Arsitektur Sistem Operasi,
            # Dasar Keamanan Siber) yang TIDAK menggabung kode+deskripsi dalam
            # 1 sel seperti template lain, tapi memisahkannya per kolom.
            if is_pure_cpl and rest_cells and re.fullmatch(r"CPMK\s*0*\d+(?:\.\d+)?", rest_cells[0].strip(), re.I):
                cpl_code = pad_code("CPL", re.search(r"\d+", first_cell_stripped).group())
                current_cpl = cpl_code
                if cpl_code not in cpl_order:
                    cpl_order.append(cpl_code)
                cpmk_code = pad_code("CPMK", re.search(r"\d+", rest_cells[0]).group())
                current_cpmk = cpmk_code
                desc = clean(" ".join(rest_cells[1:]))
                if cpmk_code not in cpmk_map:
                    cpmk_order.append(cpmk_code)
                    cpmk_map[cpmk_code] = {"id": cpmk_code, "cpl_code": cpl_code, "deskripsi": desc}
                elif desc:
                    cpmk_map[cpmk_code]["deskripsi"] = (cpmk_map[cpmk_code]["deskripsi"] + " " + desc).strip()
                continue

            # --- Pola "3 sel terpisah": [KodeCPMK, "Sub-CPMK N", deskripsi] ---
            if is_pure_cpmk and len(rest_cells) >= 2:
                sub_label_match = re.fullmatch(r"Sub[\s\-]*CPMK\s*0*(\d+)\s*[:\-]?\s*", rest_cells[0].strip(), re.I)
                if sub_label_match:
                    cpmk_code = pad_code("CPMK", re.search(r"\d+", first_cell_stripped).group())
                    current_cpmk = cpmk_code
                    if cpmk_code not in cpmk_map:
                        cpmk_order.append(cpmk_code)
                        cpmk_map[cpmk_code] = {"id": cpmk_code, "cpl_code": current_cpl or "", "deskripsi": ""}
                    sub_num = int(sub_label_match.group(1))
                    sub_key = (cpmk_code, sub_num)
                    desc = clean(" ".join(rest_cells[1:]))
                    if sub_key not in subcpmk_map:
                        subcpmk_order.append(sub_key)
                        subcpmk_map[sub_key] = {"global_number": sub_num, "cpmk_id": cpmk_code, "deskripsi": desc}
                    elif desc:
                        subcpmk_map[sub_key]["deskripsi"] = (subcpmk_map[sub_key]["deskripsi"] + " " + desc).strip()
                    continue

            # --- Pola "2 sel": [KodeCPMK, "Sub-CPMK N: deskripsi..."] --
            # deskripsi Sub-CPMK menyatu LANGSUNG di sel yang sama (bukan sel
            # terpisah), bisa juga berisi BEBERAPA Sub-CPMK sekaligus. ---
            if is_pure_cpmk and len(rest_cells) == 1 and re.match(r"^Sub[\s\-]*CPMK", rest_cells[0].strip(), re.I):
                cpmk_id_match = re.search(r"\d+(?:\.\d+)?", first_cell_stripped)
                cpmk_id = pad_code("CPMK", cpmk_id_match.group()) if cpmk_id_match else ""
                current_cpmk = cpmk_id or current_cpmk
                if cpmk_id and cpmk_id not in cpmk_map:
                    cpmk_order.append(cpmk_id)
                    cpmk_map[cpmk_id] = {"id": cpmk_id, "cpl_code": current_cpl or "", "deskripsi": ""}
                owner = cpmk_id or current_cpmk or (cpmk_order[-1] if cpmk_order else "")
                for sub_match in re.finditer(
                    r"Sub[\s\-]*CPMK\s*0*(\d+)\s*[:\-]?\s*(.*?)(?=Sub[\s\-]*CPMK\s*0*\d+|$)",
                    rest_cells[0], re.I | re.S,
                ):
                    sub_num = int(sub_match.group(1))
                    sub_key = (owner, sub_num)
                    desc = clean(sub_match.group(2))
                    if sub_key not in subcpmk_map:
                        subcpmk_order.append(sub_key)
                        subcpmk_map[sub_key] = {"global_number": sub_num, "cpmk_id": owner, "deskripsi": desc}
                    elif desc:
                        subcpmk_map[sub_key]["deskripsi"] = (subcpmk_map[sub_key]["deskripsi"] + " " + desc).strip()
                continue

            # --- Pola "2 sel": [KodeCPMK, deskripsi] -- kolom CPL kosong
            # karena rowspan (barisnya lanjutan dari CPL yang sama). ---
            if is_pure_cpmk and rest_cells and not re.match(r"^Sub[\s\-]*CPMK", rest_cells[0].strip(), re.I):
                cpmk_id_match = re.search(r"\d+(?:\.\d+)?", first_cell_stripped)
                cpmk_code = pad_code("CPMK", cpmk_id_match.group()) if cpmk_id_match else ""
                current_cpmk = cpmk_code
                desc = clean(" ".join(rest_cells))
                if cpmk_code not in cpmk_map:
                    cpmk_order.append(cpmk_code)
                    cpmk_map[cpmk_code] = {"id": cpmk_code, "cpl_code": current_cpl or "", "deskripsi": desc}
                elif desc:
                    cpmk_map[cpmk_code]["deskripsi"] = (cpmk_map[cpmk_code]["deskripsi"] + " " + desc).strip()
                continue

            # Sel kode bisa memuat lebih dari satu kode bertumpuk (rowspan
            # tervisualisasikan sebagai baris-baris teks dalam 1 sel), mis.
            # "CPMK1\nCPMK2\nCPMK3". Pecah dulu jadi token per baris.
            # Kadang satu kode tunggal kepotong jadi 2 baris gara-gara lebar
            # kolom sempit (mis. "CPM\nK2" seharusnya "CPMK2"). Coba dulu
            # anggap seluruh sel (tanpa spasi/newline) sebagai SATU kode;
            # baru kalau itu tidak cocok, baru dianggap beberapa kode
            # bertumpuk dan dipecah per baris seperti biasa.
            whole_cell_as_code = re.sub(r"\s+", "", first_cell)
            if re.fullmatch(r"CPL-?0*\d+", whole_cell_as_code, re.I) or re.fullmatch(r"CPMK-?0*\d+(?:\.\d+)?", whole_cell_as_code, re.I):
                code_tokens = [whole_cell_as_code]
            else:
                raw_tokens = [t.strip() for t in re.split(r"[\n,]+", first_cell) if t.strip()]
                # Kadang "CPMK" dan nomornya kepisah jadi 2 baris/token sendiri
                # (mis. baris "CPMK" lalu baris "06.1" di paragraf berikutnya).
                # Gabungkan pasangan token "CPMK"/"CPL" polos + token angka
                # yang mengikutinya jadi satu kode utuh.
                code_tokens = []
                i = 0
                while i < len(raw_tokens):
                    tok = raw_tokens[i]
                    if re.fullmatch(r"CPL|CPMK", tok, re.I) and i + 1 < len(raw_tokens) and re.fullmatch(r"0*\d+(?:\.\d+)?", raw_tokens[i + 1]):
                        code_tokens.append(tok + raw_tokens[i + 1])
                        i += 2
                    else:
                        code_tokens.append(tok)
                        i += 1
            cpl_tokens = [pad_code("CPL", m.group(1)) for tok in code_tokens
                          for m in [re.fullmatch(r"\s*CPL\s*0*(\d+)\s*", tok, re.I)] if m]
            cpmk_tokens = [pad_code("CPMK", m.group(1)) for tok in code_tokens
                           for m in [re.fullmatch(r"\s*CPMK\s*0*(\d+(?:\.\d+)?)\s*", tok, re.I)] if m]

            has_subcpmk_marker_in_rest = bool(re.search(r"Sub[\s\-]*CPMK\s*0*\d+", rest, re.I))
            has_cpmk_marker_in_rest = bool(re.search(r"CPMK\s*0*\d+(?:\.\d+)?", rest, re.I))

            # --- Baris kelanjutan lintas-halaman (1 sel saja, tanpa kolom kode
            # terpisah karena rowspan terpotong batas halaman) ---
            if len(cells) == 1 and re.match(r"^Sub[\s\-]*CPMK\s*0*\d+", first_cell, re.I):
                target_cpmk = current_cpmk or (cpmk_order[-1] if cpmk_order else None)
                if target_cpmk:
                    for sub_match in re.finditer(
                        r"Sub[\s\-]*CPMK\s*0*(\d+)\s*[:\-]?\s*(.*?)(?=Sub[\s\-]*CPMK\s*0*\d+|$)",
                        first_cell, re.I | re.S,
                    ):
                        sub_num = int(sub_match.group(1))
                        sub_key = (target_cpmk, sub_num)
                        desc = clean(sub_match.group(2))
                        if sub_key not in subcpmk_map:
                            subcpmk_order.append(sub_key)
                            subcpmk_map[sub_key] = {"global_number": sub_num, "cpmk_id": target_cpmk, "deskripsi": desc}
                        elif desc:
                            subcpmk_map[sub_key]["deskripsi"] = (subcpmk_map[sub_key]["deskripsi"] + " " + desc).strip()
                continue
            if len(cells) == 1 and re.match(r"^CPMK\s*0*\d+(?:\.\d+)?\s*[:\-]?\s*\S", first_cell, re.I):
                m = re.match(r"^CPMK\s*0*(\d+(?:\.\d+)?)\s*[:\-]?\s*(.*)", first_cell, re.I | re.S)
                cpmk_id = pad_code("CPMK", m.group(1))
                desc = clean(m.group(2))
                current_cpmk = cpmk_id
                if cpmk_id not in cpmk_map:
                    cpmk_order.append(cpmk_id)
                    cpmk_map[cpmk_id] = {"id": cpmk_id, "cpl_code": current_cpl or "", "deskripsi": desc}
                elif desc:
                    cpmk_map[cpmk_id]["deskripsi"] = (cpmk_map[cpmk_id]["deskripsi"] + " " + desc).strip()
                continue

            # --- Baris kode CPL (satu atau lebih kode bertumpuk dalam 1 sel) ---
            if cpl_tokens and not cpmk_tokens and not has_subcpmk_marker_in_rest and not has_cpmk_marker_in_rest:
                for code in cpl_tokens:
                    current_cpl = code
                    if code not in cpl_order:
                        cpl_order.append(code)
                    if rest and (code not in cpl_desc or not cpl_desc[code]):
                        cpl_desc[code] = rest
                continue

            # --- Baris "CPL02  CPMK01: deskripsi..." (kolom CPL diulang di tabel CPMK).
            # Satu sel "rest" ini kadang berisi BEBERAPA entri CPMK sekaligus
            # (dipisah newline antar paragraf), jadi harus di-looping (finditer),
            # bukan diambil satu match saja -- kalau cuma satu match, sisa
            # CPMK lain di sel yang sama akan ketelan jadi bagian deskripsi
            # CPMK pertama saja (bug yang sempat kejadian). ---
            if cpl_tokens and has_cpmk_marker_in_rest:
                current_cpl = cpl_tokens[-1]
                cpmk_matches = list(re.finditer(
                    r"CPMK\s*0*(\d+(?:\.\d+)?)\s*[:\-]?\s*(.*?)(?=CPMK\s*0*\d+(?:\.\d+)?\s*[:\-]|$)",
                    rest, re.I | re.S,
                ))
                for cpmk_match in cpmk_matches:
                    cpmk_id = pad_code("CPMK", cpmk_match.group(1))
                    desc = clean(cpmk_match.group(2))
                    current_cpmk = cpmk_id
                    if cpmk_id not in cpmk_map:
                        cpmk_order.append(cpmk_id)
                        cpmk_map[cpmk_id] = {"id": cpmk_id, "cpl_code": current_cpl, "deskripsi": desc}
                    elif desc:
                        cpmk_map[cpmk_id]["deskripsi"] = (cpmk_map[cpmk_id]["deskripsi"] + " " + desc).strip()
                continue

            # --- Baris kode CPMK (satu atau lebih kode bertumpuk) berpasangan
            # dengan sel Sub-CPMK yang berisi beberapa subCPMKn sekaligus ---
            if cpmk_tokens and has_subcpmk_marker_in_rest:
                for cpmk_id in cpmk_tokens:
                    if cpmk_id not in cpmk_map:
                        cpmk_order.append(cpmk_id)
                        cpmk_map[cpmk_id] = {"id": cpmk_id, "cpl_code": current_cpl or "", "deskripsi": ""}
                current_cpmk = cpmk_tokens[-1]

                sub_matches = list(re.finditer(
                    r"Sub[\s\-]*CPMK\s*0*(\d+)\s*[:\-]?\s*(.*?)(?=Sub[\s\-]*CPMK\s*0*\d+|$)",
                    rest, re.I | re.S,
                ))
                for i, sub_match in enumerate(sub_matches):
                    sub_num = int(sub_match.group(1))
                    desc = clean(sub_match.group(2))
                    # Pemetaan Sub-CPMK ke CPMK: berpasangan urut kalau jumlahnya
                    # sama; kalau Sub-CPMK lebih banyak, sisanya ikut kode CPMK
                    # terakhir dalam tumpukan (pola paling umum pada template RPS).
                    owner = cpmk_tokens[i] if i < len(cpmk_tokens) else cpmk_tokens[-1]
                    sub_key = (owner, sub_num)
                    if sub_key not in subcpmk_map:
                        subcpmk_order.append(sub_key)
                        subcpmk_map[sub_key] = {"global_number": sub_num, "cpmk_id": owner, "deskripsi": desc}
                    elif desc:
                        subcpmk_map[sub_key]["deskripsi"] = (subcpmk_map[sub_key]["deskripsi"] + " " + desc).strip()
                continue

            if cpmk_tokens and not rest:
                current_cpmk = cpmk_tokens[-1]
                for cpmk_id in cpmk_tokens:
                    if cpmk_id not in cpmk_map:
                        cpmk_order.append(cpmk_id)
                        cpmk_map[cpmk_id] = {"id": cpmk_id, "cpl_code": current_cpl or "", "deskripsi": ""}
                continue

        if stop_section:
            break

    cpl_list = [{"code": c, "deskripsi": cpl_desc.get(c, "")} for c in cpl_order]
    cpmk_list = [cpmk_map[i] for i in cpmk_order]
    # PENTING: subcpmk_map dikunci per (cpmk_id, nomor_asli_di_dokumen) supaya
    # dua Sub-CPMK milik CPMK BERBEDA yang kebetulan diberi nomor lokal sama
    # oleh dosen (mis. template yang menomori Sub-CPMK ulang dari 1 di tiap
    # CPMK, bukan menerus) tidak saling tertimpa/tergabung jadi satu entri --
    # itu akar masalah "1 CPMK harusnya cuma py 1 Sub-CPMK tapi kebaca 3" dan
    # sebaliknya. Nomor tampil (global_number) di-generate ULANG di sini
    # secara berurutan sesuai urutan kemunculan asli di dokumen, BUKAN dari
    # angka mentah hasil parsing teks -- supaya selalu 1,2,3,... rapi, tidak
    # "acak" mengikuti apa pun angka yang kebetulan tertulis di sumbernya.
    # "raw_number" (nomor asli hasil parsing teks) dipertahankan terpisah
    # karena tabel "Korelasi antara CP dan Asesmen" (extract_assessment_rows)
    # mengacu ke Sub-CPMK pakai nomor MENTAH yang sama seperti tertulis di
    # dokumen, bukan nomor tampilan yang sudah diurutkan ulang di atas.
    subcpmk_list = []
    for idx, key in enumerate(subcpmk_order):
        entry = dict(subcpmk_map[key])
        entry["raw_number"] = entry["global_number"]
        entry["global_number"] = idx + 1
        subcpmk_list.append(entry)
    return cpl_list, cpmk_list, subcpmk_list


# ---------------------------------------------------------------------------
# Korelasi CP & Asesmen (bobot penilaian per Sub-CPMK)
# ---------------------------------------------------------------------------

SUMATIF_BUCKET_PATTERNS = [
    ("kuis", re.compile(r"kuis|quiz", re.I)),
    ("tugas", re.compile(r"tugas|laporan|refleksi|rekomendasi", re.I)),
    ("ujian", re.compile(r"ujian|\buts\b|\buas\b", re.I)),
    ("pjbl", re.compile(r"pjbl", re.I)),
    # HANYA "pjbl" (Project Based Learning), BUKAN "pbl" (Problem Based
    # Learning) -- dua istilah beda yang kebetulan mirip. Jangan pernah
    # tambahkan "pbl" ke pattern ini; PBL harus tetap jatuh ke "lainnya".
    # Terima juga varian salah eja umum "Persentasi" (tertukar dgn kata
    # "persentase") -- beberapa dokumen RPS memang menulisnya begitu.
    ("presentasi", re.compile(r"presentasi|persentasi", re.I)),
]


def classify_sumatif_column(label_text):
    """Petakan nama kolom Sumatif dari dokumen ke salah satu bucket tetap
    (Kuis/Tugas/Ujian/PjBL/Presentasi), atau 'lainnya' kalau tidak cocok
    satupun -- supaya PBL/Studi Kasus/Proyek/Unjuk Kerja/Praktik/dst yang
    berbeda-beda per dokumen tidak hilang, tapi tetap tertampung (di
    Lainnya) alih-alih dibuang."""
    for bucket, pattern in SUMATIF_BUCKET_PATTERNS:
        if pattern.search(label_text):
            return bucket
    return "lainnya"


def extract_assessment_rows(all_tables, assume_in_section=False):
    """Baris tabel 'Korelasi antara CP dan Asesmen': untuk tiap Sub-CPMK,
    ambil Formatif + rincian Sumatif (Kuis/Tugas/Ujian/PjBL/Lainnya) sesuai
    kolom yang BENERAN ada di dokumen tsb -- bukan filter dulu baru tebak, karena
    itu yang bikin datanya ketuker/hilang (kolom kosong ikut kebuang, posisi
    kolom jadi geser). Di sini baris mentah (termasuk sel kosong/None) tetap
    dipertahankan supaya index kolom Sub-CPMK tsb selalu sama artinya dengan
    index kolom yang sama di baris header.

    assume_in_section: set True kalau `all_tables` yang diberikan SUDAH
    dipastikan berasal dari dalam bagian Korelasi (mis. tabel bersarang/
    nested table hasil docx_extractor.py) sehingga tidak perlu lagi menunggu
    baris teks "Korelasi antara CP dan Asesmen" utk mengaktifkan mode baca --
    penting karena tabel bersarang itu ikut sel yang justru muncul SEBELUM
    baris teks pemicu tsb kalau dibaca terpisah dari tabel utamanya, jadi
    kalau tetap menunggu pemicu, seluruh isi tabel bersarang keburu
    terlewati/tidak pernah dianggap "in_section" (bug yang sempat kejadian).
    """
    rows_out = {}
    in_section = assume_in_section
    col_bucket = {}   # index kolom -> 'kuis'/'tugas'/'ujian'/'pjbl'/'lainnya'
    col_label = {}    # index kolom -> label asli (dipakai sebagai nama utk 'lainnya')
    formatif_idx = None
    bp_mp_idx = None  # index kolom "Bentuk dan Metode Pembelajaran" (di antara Sub-CPMK & Formatif)
    bp_mp_label = ""  # label asli kolom tsb -- dipakai untuk menentukan bentuk vs metode saat fallback
    header_seen = False
    pending_header = None  # kandidat header TERAKHIR yang dilihat, di-commit begitu baris data pertama muncul

    for table in all_tables:
        for row in table:
            display_cells = [clean_multiline(c) if c else "" for c in row]
            non_empty_texts = [c for c in display_cells if c]
            if not non_empty_texts:
                continue
            joined = " ".join(non_empty_texts)

            if re.search(r"Korelasi\s+(?:antara\s+)?CP\s+dan\s+(?:[Aa]sesmen|[Aa]ssessmen|[Aa]ssessment)", joined, re.I):
                in_section = True
                header_seen = False
                col_bucket = {}
                col_label = {}
                formatif_idx = None
                bp_mp_idx = None
                bp_mp_label = ""
                pending_header = None
                continue
            if re.search(r"Deskripsi\s+Singkat", joined, re.I):
                in_section = False
            if not in_section:
                continue

            # Baris header sub-kolom Sumatif: tabel RPS sering punya header
            # berlapis 2-3 baris (mis. "BENTUK ASESMEN" -> "FORMATIF"/
            # "SUMATIF" -> nama kategori asli seperti "Tugas"/"Tes Tertulis"/
            # "Laporan"). Kita HARUS ambil baris level-TERDALAM (paling
            # rinci), bukan yang pertama ketemu -- kalau langsung commit di
            # baris pertama yang punya sel "FORMATIF", baris "SUMATIF" (1 sel
            # gabungan) bisa keburu terkunci sebagai header alih-alih baris
            # sesudahnya yang sudah dipecah per kategori. Makanya tiap baris
            # yang MASIH terlihat seperti header (ada sel "FORMATIF" persis,
            # atau >=2 sel cocok kata kunci kategori) hanya disimpan sbg
            # KANDIDAT ("pending_header", menimpa kandidat sebelumnya) --
            # baru di-commit begitu baris PERTAMA yang BUKAN header (mis.
            # baris data asli) ditemukan.
            if not header_seen:
                formatif_hit = next((i for i, c in enumerate(display_cells) if c and re.fullmatch(r"formatif", c, re.I)), None)
                # PENTING: baris DATA kadang menyebut kata kunci kategori di
                # dalam kalimat deskriptif juga (mis. "Quiz dan Tanya jawab.
                # (2%)" sebagai isi Formatif, atau "Tes Tertulis.(13%)" sbg
                # isi Sumatif) -- itu BUKAN baris header, cuma kebetulan
                # memuat kata yang sama. Bedanya: sel LABEL header tidak
                # pernah memuat angka persen SUNGGUHAN (mis. "Tugas (%)"
                # cuma placeholder tanpa angka), sedangkan sel DATA punya
                # angka persen konkret (mis. "(2%)"). Jadi sel yang sudah
                # mengandung "angka%" dikeluarkan dari kandidat "hits" supaya
                # baris data tidak disangka baris header lain (bug yang
                # sempat kejadian: pending_header tidak pernah ke-commit
                # karena baris data terus dianggap header baru).
                hits = [
                    (i, c) for i, c in enumerate(display_cells)
                    if c and re.search(
                        r"kuis|quiz|tugas|laporan|refleksi|rekomendasi|ujian|uts|uas|pjbl|"
                        r"presentasi|persentasi|studi\s*kasus|\bpbl\b|lainnya|tes\s*tertulis|unjuk\s*kerja|"
                        r"proyek|observasi|rubrik|portofolio|praktik|makalah|dokumentasi",
                        c, re.I,
                    )
                    and not re.search(r"formatif|sumatif|bentuk\s+asesmen", c, re.I)
                    and not re.search(r"\d\s*%", c)
                ]
                is_header_candidate = formatif_hit is not None or len(hits) >= 2
                if is_header_candidate:
                    bp_mp_hit = next(
                        (i for i, c in enumerate(display_cells)
                         if c and re.search(r"bentuk.{0,20}pembelajaran|metode.{0,20}pembelajaran", c, re.I)),
                        None
                    )
                    bobot_total_hit = next(
                        (i for i, c in enumerate(display_cells) if c and re.search(r"bobot\s*(total|penilaian)?", c, re.I)),
                        None
                    )
                    hit_indices = [i for i, _ in hits]
                    if formatif_hit is not None:
                        range_start = formatif_hit + 1
                    elif hit_indices:
                        range_start = min(hit_indices)
                    else:
                        range_start = None
                    if range_start is None:
                        range_end = None
                    elif bobot_total_hit is not None and bobot_total_hit > range_start:
                        range_end = bobot_total_hit
                    else:
                        # JANGAN batasi range_end ke kata kunci terakhir yang
                        # dikenali (hit_indices) -- kalau dokumen punya kategori
                        # Sumatif yang namanya TIDAK ada di whitelist manapun
                        # (mis. "Proyek", "Praktik", "Rubrik/Portofolio") dan
                        # kebetulan diletakkan di ekor baris header, kolom itu
                        # akan terpotong dari range dan datanya hilang total --
                        # bukan cuma gagal diklasifikasi, TAPI SAMA SEKALI TIDAK
                        # PERNAH DIBACA (bug yang dilaporkan: kategori selain
                        # Kuis/Tugas/Ujian/PjBL/Presentasi tidak pernah masuk ke
                        # Lainnya). Sebagai gantinya, cakup sampai sel BERLABEL
                        # (bukan kosong, bukan penanda Formatif/Sumatif/Bobot,
                        # bukan sel data berisi "angka%") TERAKHIR di baris ini --
                        # apa pun nama kategorinya tetap tertampung, nanti
                        # classify_sumatif_column yang menentukan bucket-nya
                        # (atau "lainnya" kalau tidak cocok satupun).
                        last_labelish = None
                        for i in range(range_start, len(display_cells)):
                            c = display_cells[i]
                            if (
                                c
                                and not re.search(r"formatif|sumatif|bentuk\s+asesmen|bobot\s*(total|penilaian)?", c, re.I)
                                and not re.search(r"\d\s*%", c)
                            ):
                                last_labelish = i
                        range_end = (last_labelish + 1) if last_labelish is not None else range_start
                    cand_col_bucket = {}
                    cand_col_label = {}
                    if range_start is not None and range_end is not None:
                        for i in range(range_start, range_end):
                            label = display_cells[i] if i < len(display_cells) else ""
                            label = re.sub(r"\(%\)|%", "", label).strip()
                            if not label:
                                continue
                            cand_col_bucket[i] = classify_sumatif_column(label)
                            cand_col_label[i] = label or cand_col_bucket[i].title()
                    pending_header = {
                        "col_bucket": cand_col_bucket,
                        "col_label": cand_col_label,
                        "formatif_idx": formatif_hit,
                        "bp_mp_idx": bp_mp_hit,
                        "bp_mp_label": display_cells[bp_mp_hit] if bp_mp_hit is not None else "",
                    }
                    continue
                elif pending_header is not None:
                    col_bucket = pending_header["col_bucket"]
                    col_label = pending_header["col_label"]
                    formatif_idx = pending_header["formatif_idx"]
                    bp_mp_idx = pending_header["bp_mp_idx"]
                    bp_mp_label = pending_header["bp_mp_label"]
                    header_seen = True
                    # SENGAJA tidak "continue" -- baris ini sendiri adalah
                    # baris data pertama, lanjut diproses di bawah.
                else:
                    continue

            # Nomor Sub-CPMK: coba dulu cari sel yang secara eksplisit
            # berlabel "Sub-CPMK N" / "SUB-CPMK N" (format yang dipakai
            # banyak template, mis. "SUB-CPMK 1") -- ini tidak ambigu sama
            # sekali, jadi dicek DULU sebelum heuristik angka polos di bawah.
            # Tanpa ini, sel seperti "CPL 01"/"CPMK 1" (berisi spasi) akan
            # keburu memicu kondisi "break" di heuristik lama sebelum sempat
            # mencapai sel Sub-CPMK yang sesungguhnya -- baris jadi terlewati
            # dan bobot Kuis/Tugas/Ujian-nya hilang seluruhnya.
            sub_idx = None
            sub_num = None
            for i, c in enumerate(display_cells):
                if i in col_bucket or i == formatif_idx:
                    break
                m = re.search(r"Sub[\s\-]*CPMK[\s\-]*0*(\d{1,2})\b", c, re.I)
                if m:
                    sub_idx = i
                    sub_num = int(m.group(1))
                    break

            if sub_idx is None:
                # Fallback: kolom digit pendek TERAKHIR sebelum mentok ke teks
                # panjang (deskripsi Bentuk/Metode Pembelajaran) atau ke kolom
                # asesmen. Bukan sekadar "digit pertama yang ketemu", karena
                # kolom CPL/CPMK di depannya juga sering berupa angka polos
                # (mis. "03") yang gampang ketuker sama nomor Sub-CPMK.
                for i, c in enumerate(display_cells):
                    if i in col_bucket or i == formatif_idx:
                        break
                    if c and re.fullmatch(r"0*(\d{1,2})", c):
                        sub_idx = i
                        sub_num = int(re.fullmatch(r"0*(\d{1,2})", c).group(1))
                    elif c and (" " in c or len(c) > 10):
                        break

            if sub_idx is None:
                continue

            entry = rows_out.setdefault(sub_num, {
                "kuis": None, "tugas": None, "ujian": None, "pjbl": None, "presentasi": None, "lainnya": [],
                "formatif": "", "formatif_bobot": "",
                "bentuk_pembelajaran": "", "metode_pembelajaran": "",
            })
            if formatif_idx is not None and formatif_idx < len(display_cells) and display_cells[formatif_idx]:
                raw_formatif = display_cells[formatif_idx]
                bare_num = re.fullmatch(r"(\d{1,3}(?:[.,]\d+)?)\s*%?", raw_formatif.strip())
                if bare_num:
                    entry["formatif_bobot"] = bare_num.group(1).replace(",", ".")
                else:
                    percent_match = re.search(r"\(?\s*(\d{1,3}(?:[.,]\d+)?)\s*%\s*\)?", raw_formatif)
                    if percent_match:
                        entry["formatif_bobot"] = percent_match.group(1).replace(",", ".")
                        entry["formatif"] = clean(raw_formatif[:percent_match.start()] + " " + raw_formatif[percent_match.end():]).strip(" ,.-")
                    else:
                        entry["formatif"] = raw_formatif
            if bp_mp_idx is not None and bp_mp_idx < len(display_cells) and display_cells[bp_mp_idx]:
                bp_mp_text = display_cells[bp_mp_idx]
                bp_match = re.search(r"BP\s*:?\s*(.*?)(?=(?:[,;\n]\s*)?MP\s*:|$)", bp_mp_text, re.I | re.S)
                mp_match = re.search(r"MP\s*:?\s*(.*)", bp_mp_text, re.I | re.S)
                bentuk = clean(bp_match.group(1)) if bp_match else ""
                metode = clean(mp_match.group(1)) if mp_match else ""
                if bentuk:
                    entry["bentuk_pembelajaran"] = bentuk
                if metode:
                    entry["metode_pembelajaran"] = metode
                if not bentuk and not metode:
                    # Tidak ada penanda "BP:"/"MP:" eksplisit di isi selnya --
                    # tentukan field tujuan dari LABEL HEADER kolom itu sendiri
                    # (mis. kolom yang cuma berjudul "Metode Pembelajaran" tanpa
                    # "Bentuk" sama sekali harusnya masuk metode_pembelajaran,
                    # bukan bentuk_pembelajaran).
                    is_metode_only = bool(re.search(r"metode", bp_mp_label, re.I)) and not re.search(r"bentuk", bp_mp_label, re.I)
                    if is_metode_only:
                        entry["metode_pembelajaran"] = clean(bp_mp_text)
                    else:
                        entry["bentuk_pembelajaran"] = clean(bp_mp_text)
            for i, bucket in col_bucket.items():
                if i >= len(row):
                    continue
                raw_val = row[i]
                val = clean_multiline(raw_val) if raw_val else ""
                if not val:
                    continue
                # Ambil bobot & nama dengan hati-hati: JANGAN asal ambil angka
                # pertama yang ketemu di teks, karena nama item sendiri bisa
                # mengandung angka (mis. "Kuis 1", "Tugas 2") yang BUKAN bobot.
                # Prioritas: (1) kalau seluruh isi sel cuma angka polos (boleh
                # ada %), itu langsung bobotnya, tanpa nama. (2) kalau ada pola
                # "angka%" (dengan/tanpa kurung) di dalam teks, itu yang jadi
                # bobot, sisanya jadi nama. (3) fallback: angka di ujung teks.
                val_stripped = val.strip()
                bare_match = re.fullmatch(r"(\d{1,3}(?:[.,]\d+)?)\s*%?", val_stripped)
                if bare_match:
                    bobot = bare_match.group(1).replace(",", ".")
                    name_part = ""
                else:
                    percent_match = re.search(r"\(?\s*(\d{1,3}(?:[.,]\d+)?)\s*%\s*\)?", val)
                    if percent_match:
                        bobot = percent_match.group(1).replace(",", ".")
                        name_part = clean(val[:percent_match.start()] + " " + val[percent_match.end():]).strip(" ,.-")
                    else:
                        fallback_match = re.search(r"(\d{1,3}(?:[.,]\d+)?)\s*$", val_stripped)
                        if fallback_match:
                            bobot = fallback_match.group(1).replace(",", ".")
                            name_part = clean(val[:fallback_match.start()]).strip(" ,.-")
                        else:
                            bobot = ""
                            name_part = clean(val)
                # Sebagian template pakai header kolom GENERIK "Lainnya" sebagai
                # satu-satunya kolom "tampung semua", padahal ISI selnya per
                # baris sebenarnya menyebutkan nama asesmen yang jelas (mis.
                # header cuma "Lainnya" tapi isinya "Presentasi 1 (15%)").
                # Kalau cuma percaya klasifikasi dari HEADER, item seperti itu
                # akan SELALU nyangkut di 'lainnya' walau sebenarnya cocok
                # bucket tetap (Presentasi/dst) -- bug nyata yang dilaporkan:
                # bobot Presentasi tidak pernah masuk ke field Presentasi sama
                # sekali walau kolomnya ADA dan datanya kebaca (cuma salah
                # ditampung sebagai 'lainnya'). Jadi kalau bucket dari header
                # adalah 'lainnya', coba klasifikasi ULANG dari nama itemnya
                # sendiri -- yang lebih spesifik & lebih dipercaya di sini.
                effective_bucket = bucket
                if bucket == "lainnya" and name_part:
                    refined = classify_sumatif_column(name_part)
                    if refined != "lainnya":
                        effective_bucket = refined

                if effective_bucket == "lainnya":
                    entry["lainnya"].append({
                        "nama": name_part or col_label.get(i, "Lainnya"),
                        "bobot": bobot
                    })
                else:
                    prev = entry.get(effective_bucket)
                    if prev is None:
                        entry[effective_bucket] = {"nama": name_part, "bobot": bobot}
                    else:
                        # Dua kolom/baris berbeda kebetulan diklasifikasi ke
                        # bucket yang sama (mis. kolom "Tugas" DAN "Laporan"
                        # sama-sama cocok bucket 'tugas') -- daripada yang
                        # kedua diam-diam hilang, taruh di Lainnya supaya
                        # tetap tertampung.
                        entry["lainnya"].append({
                            "nama": name_part or col_label.get(i, "Lainnya"),
                            "bobot": bobot
                        })

            # Bobot total baris = sel numerik TERAKHIR YANG TERISI (bukan
            # cells[-1] harfiah -- sering ada sel kosong/None trailing di
            # ekor baris akibat kolom tabel yang tidak selalu genap kena).
            trailing_numeric = next(
                (m.group(1) for c in reversed(display_cells)
                 for m in [re.fullmatch(r"(\d{1,3}(?:[.,]\d+)?)\s*%?", c.strip())] if m),
                None
            )
            if trailing_numeric:
                entry["bobot_total"] = trailing_numeric

    return rows_out


def parse_embedded_assessment(text):
    """Fallback untuk template RPS yang SAMA SEKALI TIDAK punya tabel
    'Korelasi antara CP dan Asesmen' terpisah -- rincian Formatif/Sumatif
    (Kuis/Tugas/Ujian/PjBL beserta bobotnya) malah ditulis sebagai teks bebas
    di dalam sel 'Teknik & Kriteria Penilaian' pada tabel rencana mingguan itu
    sendiri, misalnya:

        Bentuk Penilaian
        Formatif:
        Partisipasi diskusi, tanya jawab di kelas.
        Sumatif:
        Kuis 1 (5%)
        Laporan Singkat 1 (10%)

    atau digabung 1 baris dengan koma ("Kuis 2 (5%), Tugas Analisis 2 (10%),
    UTS (5%)"). Dipanggil HANYA sebagai fallback ketika tabel Korelasi
    terpisah tidak ditemukan/kosong untuk Sub-CPMK tsb -- supaya bobot
    Kuis/Tugas/Ujian/PjBL/Lainnya tetap tertangkap alih-alih hilang begitu
    saja (bug yang dilaporkan: dokumen dengan format ini bobot sumatifnya
    sama sekali tidak masuk, padahal field nama+bobot sudah tersedia).
    """
    result = {
        "formatif": "", "formatif_bobot": "",
        "kuis": None, "tugas": None, "ujian": None, "pjbl": None, "presentasi": None, "lainnya": [],
        "bobot_total": "",
    }
    if not text:
        return result

    # PENTING: ambil kemunculan TERAKHIR dari tiap penanda "Formatif"/
    # "Sumatif", bukan yang PERTAMA ditemukan (re.search biasa). Beberapa
    # dokumen menulis label gabungan di awal sel, mis. "Bentuk Penilaian
    # Sumatif:" (cuma judul kolom, bukan isi) SEBELUM penanda "Formatif:" /
    # "Sumatif:" yang sesungguhnya -- kalau ambil kemunculan pertama, isi
    # Formatif malah ikut ketelan jadi bagian daftar Sumatif juga (bug yang
    # sempat kejadian: 1 butir Formatif nyasar dobel ke Lainnya).
    formatif_markers = list(re.finditer(r"Formatif\s*:?", text, re.I))
    sumatif_markers = list(re.finditer(r"Sumatif\s*:?", text, re.I))
    sumatif_marker = sumatif_markers[-1] if sumatif_markers else None
    formatif_candidates = [m for m in formatif_markers if not sumatif_marker or m.start() < sumatif_marker.start()]
    formatif_marker = formatif_candidates[-1] if formatif_candidates else None

    if formatif_marker:
        formatif_end = sumatif_marker.start() if sumatif_marker else len(text)
        formatif_text = text[formatif_marker.end():formatif_end]
        formatif_text = re.split(r"\n?\s*Teknik\s+Penilaian\s*:", formatif_text, maxsplit=1, flags=re.I)[0]
        formatif_text = clean(formatif_text)
        bare_bobot = re.fullmatch(r"(\d{1,3}(?:[.,]\d+)?)\s*%?", formatif_text)
        if bare_bobot:
            result["formatif_bobot"] = bare_bobot.group(1).replace(",", ".")
        else:
            percent_match = re.search(r"\(?\s*(\d{1,3}(?:[.,]\d+)?)\s*%\s*\)?", formatif_text)
            if percent_match:
                result["formatif_bobot"] = percent_match.group(1).replace(",", ".")
                result["formatif"] = clean(formatif_text[:percent_match.start()] + " " + formatif_text[percent_match.end():]).strip(" ,.-")
            else:
                result["formatif"] = formatif_text

    if not sumatif_marker:
        return result
    sumatif_text = re.split(r"\bKriteria\s*:", text[sumatif_marker.end():], maxsplit=1, flags=re.I)[0]

    # Tiap butir Sumatif dipisah newline ATAU koma -- dokumen menulisnya
    # dengan gaya yang tidak konsisten (satu butir per baris, atau digabung
    # dalam 1 baris dipisah koma).
    for raw in re.split(r"[\n,]+", sumatif_text):
        raw = raw.strip(" .;:")
        if not raw:
            continue
        item_match = re.match(r"(.*?)\(?\s*(\d{1,3}(?:[.,]\d+)?)\s*%\s*\)?\s*$", raw)
        if not item_match:
            continue  # butir tanpa bobot numerik (mis. "MCQ" saja) -- lewati
        name = clean(item_match.group(1)).strip(" :()-")
        if not name:
            continue
        bobot = item_match.group(2).replace(",", ".")
        bucket = classify_sumatif_column(name)
        if bucket != "lainnya" and result.get(bucket) is None:
            result[bucket] = {"nama": name, "bobot": bobot}
        else:
            result["lainnya"].append({"nama": name, "bobot": bobot})

    # "bobot_total" (bobot keseluruhan minggu tsb) SENGAJA tidak dihitung di
    # sini -- pemanggil (docx_extractor.py) sudah punya sumber lebih andal
    # untuk itu: kolom "Bobot Penilaian (%)" milik tabel rencana mingguan itu
    # sendiri (satu angka utuh per minggu).
    return result


# ---------------------------------------------------------------------------
# Blok naratif (Deskripsi Singkat, Materi Kajian, Pustaka, Dosen Pengampu,
# Mata Kuliah Syarat) -- dibaca dari BARIS TABEL (extract_tables), bukan dari
# teks polos. Bagian-bagian ini selalu tampil sebagai baris [label, isi] pada
# tabel identitas RPS; kalau dibaca sebagai teks linear, label yang melipat
# ke banyak baris (mis. "Dosen" / "Pengampu" pada baris terpisah) malah
# nyasar nyatu dengan isi kolom lain -- ini akar masalah "Dosen Pengampu
# tidak terbaca" pada pendekatan lama.
# ---------------------------------------------------------------------------

def extract_narrative_sections(all_tables):
    deskripsi_parts = []
    materi_parts = []
    utama_parts = []
    pendukung_parts = []
    dosen_parts = []
    syarat_parts = []

    mode = None  # None | 'materi' | 'pustaka_utama' | 'pustaka_pendukung' | 'dosen' | 'syarat'
    passed_weekly = False  # sekali True, berhenti permanen (hindari kontaminasi dari
    # lampiran "Rancangan Tugas" dsb. di halaman-halaman jauh setelah rencana mingguan,
    # yang kadang memakai label serupa seperti "Dosen Pengampu" untuk keperluan lain).

    for table in all_tables:
        for row in table:
            if passed_weekly:
                break
            cells = [clean_multiline(c) for c in row if c and clean_multiline(c)]
            if not cells:
                continue

            label_flat = re.sub(r"\s+", " ", cells[0]).strip()
            rest = cells[1:]

            # Baris header rencana mingguan menandakan blok naratif sudah selesai
            # untuk seterusnya (bagian identitas RPS selalu tampil sekali saja,
            # sebelum tabel rencana mingguan, di semua contoh template yang diuji).
            if re.match(r"^Pekan\b|^Mg\s*Ke", label_flat, re.I) or label_flat == "(1)":
                mode = None
                passed_weekly = True
                break

            if re.match(r"^Deskripsi\s+Singkat", label_flat, re.I):
                deskripsi_parts.extend(rest)
                mode = None
                continue

            if re.match(r"^Materi\s+Kajian|^Bahan\s+Kajian", label_flat, re.I):
                materi_parts.extend(rest)
                mode = "materi"
                continue

            if re.match(r"^Pustaka$", label_flat, re.I):
                # "Pustaka" bisa terulang sebagai sel pertama di SETIAP baris
                # (bukan cuma sekali di baris tag) -- baik untuk baris tag
                # "Utama:"/"Pendukung:" itu sendiri MAUPUN baris isi
                # sesudahnya. Mode HANYA boleh berganti kalau baris ini
                # benar-benar berisi sel tag "Utama:"/"Pendukung:"; kalau
                # tidak (baris isi biasa), pertahankan mode yang sedang
                # berjalan -- sebelumnya mode ditebak ulang dari isi baris
                # ini setiap kali, jadi baris isi Pendukung yang kebetulan
                # tidak menyebut kata "Pendukung" di teksnya sendiri ketimpa
                # balik jadi dianggap Utama.
                tag_cell = next(
                    (r for r in rest if re.fullmatch(r"(?:Utama|Pendukung)\s*:?", r.strip(), re.I)),
                    None,
                )
                if tag_cell:
                    mode = "pustaka_pendukung" if re.search(r"Pendukung", tag_cell, re.I) else "pustaka_utama"
                elif mode not in ("pustaka_utama", "pustaka_pendukung"):
                    mode = "pustaka_utama"
                target = pendukung_parts if mode == "pustaka_pendukung" else utama_parts
                for r in rest:
                    if not re.fullmatch(r"(?:Utama|Pendukung)\s*:?", r.strip(), re.I):
                        target.append(r)
                continue

            if re.match(r"^Utama\s*:?$", label_flat, re.I) and not rest:
                mode = "pustaka_utama"
                continue

            if re.match(r"^Pendukung\s*:?$", label_flat, re.I) and not rest:
                mode = "pustaka_pendukung"
                continue

            if re.match(r"^Dosen(?:\s+Pengampu)?$", label_flat, re.I) and rest:
                dosen_parts.extend(rest)
                mode = "dosen"
                continue

            if re.match(r"^Mata\s*kuliah\s+syarat|^Matakuliah\s+syarat", label_flat, re.I):
                syarat_parts.extend(rest if rest else [])
                mode = "syarat"
                continue

            # Baris kelanjutan (1 sel saja, tanpa label baru) -- masuk ke mode aktif.
            # "dosen" & "mk syarat" selalu pendek (beberapa nama / 1 baris syarat);
            # dibatasi jumlah baris supaya kalau ada tabel lain di halaman jauh
            # setelahnya kebetulan cocok pola "1 sel tanpa label", dia tidak ikut
            # "nyasar" tertampung terus-menerus ke field ini.
            if not rest and mode:
                if mode == "materi":
                    materi_parts.append(cells[0])
                elif mode == "pustaka_utama":
                    utama_parts.append(cells[0])
                elif mode == "pustaka_pendukung":
                    pendukung_parts.append(cells[0])
                elif mode == "dosen" and len(dosen_parts) < 6:
                    dosen_parts.append(cells[0])
                elif mode == "syarat" and len(syarat_parts) < 3:
                    syarat_parts.append(cells[0])
                else:
                    mode = None

    def flatten_items(parts):
        items = []
        for p in parts:
            items.extend(split_numbered_list(p))
        # buang sisa nomor halaman yg ikut kebaca sebagai baris tersendiri (mis. "2")
        return [i for i in items if not re.fullmatch(r"\d{1,3}", i)]

    return {
        "deskripsi_singkat_mk": clean(" ".join(deskripsi_parts)),
        "materi_kajian": flatten_items(materi_parts),
        "pustaka_utama": flatten_items(utama_parts),
        "pustaka_pendukung": flatten_items(pendukung_parts),
        "dosen_pengampu": flatten_items(dosen_parts),
        "mk_syarat": clean(" ".join(syarat_parts)),
    }


# ---------------------------------------------------------------------------
# Rencana pembelajaran mingguan (tabel akhir, berulang antar halaman)
# ---------------------------------------------------------------------------

