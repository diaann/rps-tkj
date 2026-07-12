#!/usr/bin/env python3
"""
rps_common.py

util & logic ekstraksi yg dipakai docx_extractor.py. input-nya generik:
list of table -> list of row -> list of cell (string/None).
isinya: kenalin kode cpl/cpmk/sub-cpmk, klasifikasi kolom sumatif, baca blok naratif.
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

# bersihkan whitespace aneh & karakter tak terlihat dari teks hasil ekstraksi
def clean(s):
    if not s:
        return ""
    s = str(s)
    s = s.replace("\u00a0", " ")
    s = re.sub(r"[\u200b-\u200d\ufeff]", "", s)
    s = s.replace("\uf0de", "=>").replace("\uf0e0", "=>")
    s = re.sub(r"\s+", " ", s).strip()
    return s


# sama seperti clean(), tapi jaga batas antar baris (buat isi sel yg banyak paragraf)
def clean_multiline(s):
    if not s:
        return ""
    lines = [clean(l) for l in str(s).replace("\r", "\n").split("\n")]
    return "\n".join(l for l in lines if l)


# pecah 1 sel isinya daftar bernomor/bullet ("1. ...", "- ...") jadi list per butir
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


# angka mentah -> kode baku 2 digit, mis. pad_code("CPMK", "6.1") -> "CPMK06.1"
def pad_code(prefix, number):
    s = str(number or "").strip()
    m = re.match(r"0*(\d+)(\.\d+)?", s)
    if not m:
        return ""
    integer_part = m.group(1).zfill(2)
    decimal_part = m.group(2) or ""
    return f"{prefix}{integer_part}{decimal_part}"


# cari pola "CPMKx ... Sub-CPMKy" yg nempel di 1 sel yg sama -> pasangan CPMK-SubCPMK yg pasti benar
def find_authoritative_subcpmk_owners(all_tables):
    owners = {}
    pattern = re.compile(r"CPMK\s*0*(\d+(?:\.\d+)?)\D{0,20}?Sub[\s\-]*CPMK\s*0*(\d+)\b", re.I | re.S)
    for table in all_tables:
        for row in table:
            for cell in row:
                if not cell:
                    continue
                for m in pattern.finditer(cell):
                    cpmk_id = pad_code("CPMK", m.group(1))
                    sub_num = int(m.group(2))
                    owners.setdefault(sub_num, cpmk_id)
    return owners


# fungsi paling penting di file ini: susun CPL -> CPMK -> Sub-CPMK dari baris2 tabel
def extract_cp_tree(all_tables, authoritative_owners=None):
    # susuri semua baris tabel, bangun cpl -> cpmk -> sub-cpmk dari kode di kolom + deskripsinya.
    # authoritative_owners (opsional): pemetaan sub-cpmk->cpmk yg udah pasti benar, biar ga cuma nebak posisi
    if authoritative_owners is None:
        authoritative_owners = find_authoritative_subcpmk_owners(all_tables)

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

            # pola 1: 3 sel terpisah [cpl, cpmk, deskripsi]
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

            # pola 2: 3 sel terpisah [cpmk, "sub-cpmk n", deskripsi]
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

            # pola 3: 2 sel [cpmk, "sub-cpmk n: deskripsi..."], sel ke-2 bisa berisi beberapa sub-cpmk sekaligus
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

            # pola 4: 2 sel [cpmk, deskripsi], kolom cpl kosong krn rowspan (lanjutan cpl yg sama)
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

            # sel kode bisa berisi banyak kode bertumpuk ("CPMK1\nCPMK2"), pecah jadi token per baris.
            # anggap 1 sel = 1 kode utuh (jaga2 kepotong 2 baris kayak "CPM\nK2"),
            # baru fallback ke pecah per baris kalau ga cocok.
            whole_cell_as_code = re.sub(r"\s+", "", first_cell)
            if re.fullmatch(r"CPL-?0*\d+", whole_cell_as_code, re.I) or re.fullmatch(r"CPMK-?0*\d+(?:\.\d+)?", whole_cell_as_code, re.I):
                code_tokens = [whole_cell_as_code]
            else:
                raw_tokens = [t.strip() for t in re.split(r"[\n,]+", first_cell) if t.strip()]
                # gabung token "CPMK"/"CPL" polos + angka di token berikutnya jadi 1 kode utuh
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

            # baris lanjutan lintas-halaman (cuma 1 sel, rowspan kepotong batas halaman)
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

            # baris kode cpl (1 atau lebih kode bertumpuk dalam 1 sel)
            if cpl_tokens and not cpmk_tokens and not has_subcpmk_marker_in_rest and not has_cpmk_marker_in_rest:
                for code in cpl_tokens:
                    current_cpl = code
                    if code not in cpl_order:
                        cpl_order.append(code)
                    if rest and (code not in cpl_desc or not cpl_desc[code]):
                        cpl_desc[code] = rest
                continue

            # baris "CPL02 CPMK01: deskripsi..." 1 sel bisa berisi beberapa cpmk, makanya loop finditer
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

            # baris kode cpmk (bertumpuk) berpasangan dgn sel sub-cpmk yg isinya beberapa sub-cpmk
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
                    # prioritas: pemetaan pasti dari authoritative_owners. fallback: tebak posisi
                    # berpasangan urut (sub-cpmk ke-i <-> cpmk ke-i) ini sering salah, upaya terakhir aja
                    owner = authoritative_owners.get(sub_num) or (
                        cpmk_tokens[i] if i < len(cpmk_tokens) else cpmk_tokens[-1]
                    )
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
    # key subcpmk_map = (cpmk_id, nomor asli) biar sub-cpmk beda cpmk yg kebetulan
    # nomornya sama (template reset nomor tiap cpmk) ga saling ketiban
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
    ("presentasi", re.compile(r"presentasi|persentasi", re.I)),
]


# nama kolom Sumatif (mis. "Tes Tertulis") -> salah 1 bucket tetap: kuis/tugas/ujian/pjbl/presentasi/lainnya
def classify_sumatif_column(label_text):
    for bucket, pattern in SUMATIF_BUCKET_PATTERNS:
        if pattern.search(label_text):
            return bucket
    return "lainnya"


# baca tabel "Korelasi antara CP dan Asesmen": bobot Formatif & Sumatif per Sub-CPMK
def extract_assessment_rows(all_tables, assume_in_section=False):
    # assume_in_section=True: skip nunggu trigger text "korelasi cp & asesmen",
    # langsung anggap semua baris di dalam section (dipakai buat nested table)
    rows_out = {}
    in_section = assume_in_section
    col_bucket = {}   # index kolom -> 'kuis'/'tugas'/'ujian'/'pjbl'/'lainnya'
    col_label = {}    # index kolom -> label asli (dipakai sebagai nama utk 'lainnya')
    formatif_idx = None
    bp_mp_idx = None  # index kolom "Bentuk dan Metode Pembelajaran" (di antara Sub-CPMK & Formatif)
    bp_mp_label = ""  # label asli kolom tsb dipakai untuk menentukan bentuk vs metode saat fallback
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

            # header sumatif sering berlapis 2-3 baris ("bentuk asesmen" -> "formatif"/"sumatif" ->
            # nama kategori asli). ambil level PALING DALAM: tiap baris yg masih mirip header cuma
            # disimpen jadi kandidat (pending_header), baru di-commit pas ketemu baris data pertama.
            if not header_seen:
                formatif_hit = next((i for i, c in enumerate(display_cells) if c and re.fullmatch(r"formatif", c, re.I)), None)

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
                    and "\n" not in c
                    and "," not in c
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
                    # ga "continue" baris ini baris data pertama, lanjut diproses di bawah
                else:
                    continue

            # cari sel yg eksplisit berlabel "sub-cpmk n"
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
                # fallback: digit pendek TERAKHIR sebelum mentok teks panjang, bukan digit pertama,
                # soalnya kolom cpl/cpmk di depan juga sering angka polos yg gampang ketuker
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
                    # ga ada penanda "bp:"/"mp:" eksplisit -> tentuin dari label header kolomnya sendiri
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
                # ambil bobot & nama, prioritas: (1) sel cuma angka polos = bobot tanpa nama,
                # (2) ada pola "angka%" di tengah teks = bobot + sisanya nama, (3) fallback angka di ujung
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
                        # 2 kolom beda kebetulan sama-sama masuk bucket ini -> yg kedua ke lainnya
                        entry["lainnya"].append({
                            "nama": name_part or col_label.get(i, "Lainnya"),
                            "bobot": bobot
                        })

            # bobot total = sel numerik TERAKHIR yg keisi (bukan cells[-1] literal,
            # suka ada sel kosong nyangkut di ekor baris)
            trailing_numeric = next(
                (m.group(1) for c in reversed(display_cells)
                for m in [re.fullmatch(r"(\d{1,3}(?:[.,]\d+)?)\s*%?", c.strip())] if m),
                None
            )
            if trailing_numeric:
                entry["bobot_total"] = trailing_numeric

    return rows_out


# fallback kalau dokumen tidak punya tabel Korelasi: baca bobot dari teks bebas "Formatif:/Sumatif:"
def parse_embedded_assessment(text):
    result = {
        "formatif": "", "formatif_bobot": "",
        "kuis": None, "tugas": None, "ujian": None, "pjbl": None, "presentasi": None, "lainnya": [],
        "bobot_total": "",
    }
    if not text:
        return result

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

    # tiap butir sumatif dipisah newline atau koma (dokumen ga konsisten nulisnya)
    for raw in re.split(r"[\n,]+", sumatif_text):
        raw = raw.strip(" .;:")
        if not raw:
            continue
        item_match = re.match(r"(.*?)\(?\s*(\d{1,3}(?:[.,]\d+)?)\s*%\s*\)?\s*$", raw)
        if not item_match:
            continue  # butir tanpa bobot numerik (mis. "MCQ" saja) lewati
        name = clean(item_match.group(1)).strip(" :()-")
        if not name:
            continue
        bobot = item_match.group(2).replace(",", ".")
        bucket = classify_sumatif_column(name)
        if bucket != "lainnya" and result.get(bucket) is None:
            result[bucket] = {"nama": name, "bobot": bobot}
        else:
            result["lainnya"].append({"nama": name, "bobot": bobot})

    return result


# ---------------------------------------------------------------------------
# Blok naratif (Deskripsi Singkat, Materi Kajian, Pustaka, Dosen Pengampu, Mata Kuliah Syarat)
# ---------------------------------------------------------------------------

# baca blok naratif: Deskripsi Singkat, Materi Kajian, Pustaka, Dosen Pengampu, MK Syarat
def extract_narrative_sections(all_tables):
    deskripsi_parts = []
    materi_parts = []
    utama_parts = []
    pendukung_parts = []
    dosen_parts = []
    syarat_parts = []

    mode = None  # None | 'materi' | 'pustaka_utama' | 'pustaka_pendukung' | 'dosen' | 'syarat'
    passed_weekly = False  # sekali true, permanen biar lampiran jauh setelah minggu ke-16 ga ikut kebaca

    for table in all_tables:
        for row in table:
            if passed_weekly:
                break
            cells = [clean_multiline(c) for c in row if c and clean_multiline(c)]
            if not cells:
                continue

            label_flat = re.sub(r"\s+", " ", cells[0]).strip()
            rest = cells[1:]

            # header rencana mingguan = blok naratif udah selesai
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

            # dosen & mk syarat dibatasin jumlah barisnya, jaga2 tabel lain kebetulan cocok pola ini
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

