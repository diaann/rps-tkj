#!/usr/bin/env python3
"""
docx_extractor.py

Ekstraksi terstruktur untuk dokumen RPS dari file Word (.docx), menggunakan
python-docx. Struktur tabel di .docx itu EKSPLISIT di datanya sendiri (baris
& sel yang jelas), tidak perlu ditebak dari posisi garis/koordinat teks.

Halaman sampul (cover) -- kalau ada -- otomatis TIDAK ikut terbaca, karena
skrip ini hanya membaca ISI TABEL, bukan teks paragraf biasa; dan tabel
identitas RPS yang sesungguhnya dicari lewat tanda tangan header-nya sendiri
("MATA KULIAH (MK)" + "KODE" + "SEMESTER"), bukan asal tabel pertama di
dokumen.

Output JSON-nya dikonsumsi oleh sisi Node.js (rpsDocxParser.js) untuk merakit
rpsData yang sama formatnya dengan input manual lewat form.
"""

import sys
import json
import re
import warnings

warnings.filterwarnings("ignore")

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

try:
    import docx
    from docx.oxml.ns import qn
except ImportError:
    print(json.dumps({"error": "python_docx_not_installed"}))
    sys.exit(1)

from rps_common import (
    clean,
    clean_multiline,
    extract_cp_tree,
    extract_assessment_rows,
    extract_narrative_sections,
    parse_embedded_assessment,
)


# ---------------------------------------------------------------------------
# Util baca tabel python-docx
# ---------------------------------------------------------------------------

def dedupe_row(row):
    """python-docx mengembalikan objek Cell yang SAMA berulang-ulang untuk
    tiap kolom grid yang dicakup 1 sel gabungan (merge horizontal) -- bisa
    dicek lewat identitas elemen XML-nya (`cell._tc`). Rapatkan HANYA yang
    memang cell object sama persis (merge asli), BUKAN sekadar teks yang
    kebetulan sama (mis. dua sel yang sama-sama kosong tapi memang berbeda
    kolom) -- kalau pakai teks, dua sel kosong bersebelahan bisa salah
    kegabung jadi satu dan bikin kolom-kolom sesudahnya ikut geser posisi."""
    result = []
    last_tc = None
    for cell in row.cells:
        if cell._tc is last_tc:
            continue
        result.append(clean_multiline(cell.text))
        last_tc = cell._tc
    return result


def table_to_rows(table):
    return [dedupe_row(row) for row in table.rows]


def expand_multiline_cells(rows):
    """Satu sel tabel Word kadang berisi BEBERAPA butir (tiap pustaka/topik
    materi kajian ditulis dosen sebagai paragraf terpisah dalam 1 sel yang
    sama, bukan 1 baris tabel per butir). Beda dengan PDF, newline dari
    `cell.text` python-docx SELALU berarti batas paragraf yang sungguhan
    (bukan jejak line-wrap lebar kolom kertas) -- jadi di sini aman, dan
    malah HARUS dipecah jadi baris tersendiri per butir sebelum diserahkan ke
    extract_narrative_sections, supaya tiap butir tertampung sebagai entri
    terpisah alih-alih ketelan jadi satu string gabungan (bug lama: Materi
    Kajian & Pustaka Utama/Pendukung nyatu jadi 1 baris)."""
    expanded = []
    for row in rows:
        if len(row) < 2:
            expanded.append(row)
            continue
        head = row[:-1]
        lines = [l for l in row[-1].split("\n") if l.strip()]
        if len(lines) <= 1:
            expanded.append(row)
            continue
        expanded.append(list(head) + [lines[0]])
        blank_head = [""] * len(head)
        for line in lines[1:]:
            expanded.append(blank_head + [line])
    return expanded


def find_identity_table_index(tables_as_rows):
    for idx, rows in enumerate(tables_as_rows):
        for row in rows[:6]:
            joined = " ".join(row)
            if (
                re.search(r"MATA\s*KULIAH", joined, re.I)
                and re.search(r"\bKODE\b", joined, re.I)
                and re.search(r"SEMESTER", joined, re.I)
            ):
                return idx
    return None


# ---------------------------------------------------------------------------
# Identitas & Otorisasi -- di docx ini tinggal baca sel per posisi (bukan
# tebak dari geometri kata seperti di PDF), karena strukturnya eksplisit.
# ---------------------------------------------------------------------------

def extract_identity_docx(rows):
    header_idx = None
    for i, row in enumerate(rows):
        joined = " ".join(row)
        if (
            re.search(r"MATA\s*KULIAH", joined, re.I)
            and re.search(r"\bKODE\b", joined, re.I)
            and re.search(r"SEMESTER", joined, re.I)
        ):
            header_idx = i
            break
    if header_idx is None:
        return {}

    value_row = None
    for j in range(header_idx + 1, min(header_idx + 5, len(rows))):
        row = rows[j]
        if re.search(r"OTORISASI", " ".join(row), re.I):
            break
        if any(c.strip() for c in row):
            value_row = row
            break
    if not value_row:
        return {}

    nama_mk = value_row[0] if len(value_row) > 0 else ""
    kode_mk = value_row[1] if len(value_row) > 1 else ""
    rumpun_mk = value_row[2] if len(value_row) > 2 else ""
    rest = value_row[3:]
    joined_rest = " ".join(rest)

    bobot_match = re.search(r"T\s*[=:]?\s*(\d*)\s*P\s*[=:]?\s*(\d*)", joined_rest, re.I)
    sks_teori = bobot_match.group(1) if bobot_match else ""
    sks_praktikum = bobot_match.group(2) if bobot_match else ""

    semester = ""
    tanggal = ""
    for c in rest:
        c_clean = c.strip()
        if not c_clean:
            continue
        if re.fullmatch(r"T\s*[=:]?\s*\d*", c_clean, re.I) or re.fullmatch(r"P\s*[=:]?\s*\d*", c_clean, re.I):
            continue
        if not semester and re.fullmatch(r"\d{1,2}", c_clean):
            semester = c_clean
            continue
        if re.search(r"\d{4}", c_clean) or re.search(
            r"(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|"
            r"january|february|march|may|june|july|august|october|december)",
            c_clean, re.I,
        ):
            tanggal = c_clean

    if re.fullmatch(r"[\?\-\s]*", kode_mk or ""):
        kode_mk = ""

    return {
        "nama_mk": clean(nama_mk),
        "kode_mk": clean(kode_mk),
        "rumpun_mk": clean(rumpun_mk),
        "sks_teori": sks_teori,
        "sks_praktikum": sks_praktikum,
        "semester": semester,
        "tanggal_penyusunan_raw": clean(tanggal),
    }


def extract_otorisasi_docx(rows):
    header_idx = None
    for i, row in enumerate(rows):
        joined = " ".join(row)
        if re.search(r"OTORISASI", joined, re.I) and re.search(r"Pengembang", joined, re.I):
            header_idx = i
            break
    if header_idx is None:
        return {}

    header_row = rows[header_idx]
    # Cari posisi label supaya urutan kolomnya benar walau ada label
    # tambahan (mis. "OTORISASI" ikut terulang sebagai sel pertama).
    pengembang_idx = koordinator_idx = ketua_idx = None
    for i, c in enumerate(header_row):
        if re.fullmatch(r"Pengembang(?:\s+RPS)?", c.strip(), re.I):
            pengembang_idx = i
        elif re.fullmatch(r"Koordinator(?:\s+RMK)?", c.strip(), re.I):
            koordinator_idx = i
        elif re.fullmatch(r"Ketua(?:\s+PRODI)?", c.strip(), re.I):
            ketua_idx = i

    value_row = None
    for j in range(header_idx + 1, min(header_idx + 4, len(rows))):
        row = rows[j]
        if re.search(r"Capaian\s+Pembelajaran|CPL", " ".join(row), re.I):
            break
        if any(c.strip() for c in row):
            value_row = row
            break
    if not value_row:
        return {}

    def get(idx):
        return clean(value_row[idx]) if idx is not None and idx < len(value_row) else ""

    return {
        "pengembang_rps": get(pengembang_idx),
        "koordinator_rmk": get(koordinator_idx),
        "ketua_prodi": get(ketua_idx),
    }


# ---------------------------------------------------------------------------
# Rencana pembelajaran mingguan -- di docx tidak ada masalah lintas-halaman
# seperti PDF, jadi cukup cari baris legenda "(1)".."(8)" atau header berisi
# "Pekan" + "Indikator" + "Teknik", lalu ambil semua baris data sesudahnya.
# ---------------------------------------------------------------------------


# Baris minggu evaluasi (UTS/UAS) biasanya cuma 1 sel gabungan memanjangi
# hampir semua kolom (Sub-CPMK s/d Materi jadi satu), sisanya cuma kolom
# Bobot yang beneran keisi angka -- baris ini TIDAK mewakili Sub-CPMK
# manapun. Kalau tetap dimasukkan ke `weekly`, pemetaan index weekly[idx]
# <-> subcpmk_list[idx] di bawah (extract()) jadi geser utk semua Sub-CPMK
# SESUDAH minggu evaluasi ini -- bug yang bikin nilai bobot UTS/UAS nyasar
# ke kolom Indikator Sub-CPMK berikutnya, sementara Teknik/Metode/Materi
# Sub-CPMK itu jadi kosong (kehabisan kolom akibat sel yang ke-gabung).
EVALUATION_WEEK_PATTERN = re.compile(
    r"ujian\s+tengah\s+semester|ujian\s+akhir\s+semester|\bUTS\b|\bUAS\b|"
    r"evaluasi\s+tengah\s+semester|evaluasi\s+akhir\s+semester",
    re.I,
)


def extract_weekly_plan_docx(all_rows):
    weekly = []
    seen_header = False
    for row in all_rows:
        joined = " ".join(c for c in row if c.strip())
        if not joined:
            continue

        if not seen_header:
            if re.search(r"Pekan|\bMg\s*Ke", joined, re.I) and re.search(r"Indikator|Sub-?CPMK", joined, re.I):
                seen_header = True
            continue

        # Lewati baris legenda "(1)" "(2)" ... "(8)" -- itu bukan data.
        non_empty_cells = [c.strip() for c in row if c.strip()]
        if non_empty_cells and all(re.fullmatch(r"\(\d{1,2}\)", c) for c in non_empty_cells):
            continue

        first_cell = row[0].strip() if row else ""
        pekan_match = re.fullmatch(r"\(?(\d{1,2})\)?(?:\s*[-\u2013]\s*\(?(\d{1,2})\)?)?", first_cell)
        if not pekan_match:
            continue

        # PENTING: pakai indeks TETAP sesuai posisi kolom baku (0=Pekan,
        # 1=Sub-CPMK, 2=Indikator, 3=Teknik&Kriteria, 4=Luring, 5=Daring,
        # 6=Materi, 7=Bobot) -- JANGAN filter sel kosong dulu seperti di
        # pendekatan PDF, karena di docx baris sudah konsisten jumlah selnya;
        # kalau difilter, sel kosong (mis. Daring yang memang tidak diisi)
        # akan bikin kolom-kolom sesudahnya ikut geser posisi.
        def get(i):
            return row[i] if i < len(row) else ""

        # Lewati baris minggu evaluasi (UTS/UAS) -- lihat penjelasan di
        # EVALUATION_WEEK_PATTERN di atas. SENGAJA cuma cek kolom Sub-CPMK
        # (get(1)), BUKAN seluruh baris -- soalnya minggu ajar biasa juga
        # sering menyebut "UTS (5%)" sebagai salah satu komponen bobot di
        # kolom Teknik & Kriteria Penilaian (get(3)); kalau ikut dicek di
        # situ, minggu ajar biasa itu keliru ikut ke-skip juga. Baris
        # evaluasi asli isinya CUMA frasa evaluasi di kolom Sub-CPMK
        # (sel gabungan), tidak ada deskripsi capaian pembelajaran lain.
        if EVALUATION_WEEK_PATTERN.search(get(1)):
            continue

        pekan_awal = pekan_match.group(1)
        pekan_akhir = pekan_match.group(2) or pekan_awal
        bobot_raw = get(7).strip()
        bobot_raw_clean = re.sub(r"\s+", "", bobot_raw)
        bobot_match = re.fullmatch(r"(\d{1,3}(?:[.,]\d+)?)\s*%?", bobot_raw_clean)
        bobot = bobot_match.group(1) if bobot_match else ""

        weekly.append({
            "pekan_awal": pekan_awal,
            "pekan_akhir": pekan_akhir,
            "kemampuan_akhir": get(1),
            "indikator": get(2),
            "teknik_kriteria": get(3),
            "metode_luring": get(4),
            "metode_daring": get(5),
            "materi": get(6),
            "bobot": bobot,
        })
    return weekly


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

STOP_SECTION_PATTERNS = [
    r"TABEL\s+RUBRIK",
    r"JUDUL\s+TUGAS",
    r"RANCANGAN\s+TUGAS",
    r"Aspek\s+Penilaian",
    r"Rubrik\s+Penilaian",
]


def is_stop_section(row):
    joined = " ".join(c for c in row if c.strip())
    return any(re.search(p, joined, re.I) for p in STOP_SECTION_PATTERNS)


def extract(docx_path):
    document = docx.Document(docx_path)
    tables_as_rows = [table_to_rows(t) for t in document.tables]

    anchor_idx = find_identity_table_index(tables_as_rows)
    if anchor_idx is None:
        return {"error": "identity_table_not_found"}

    identity_rows = tables_as_rows[anchor_idx]
    identity = extract_identity_docx(identity_rows)
    otorisasi = extract_otorisasi_docx(identity_rows)

    # PENTING: identitas/otorisasi SELALU ada di tabel pertama (anchor), tapi
    # bagian CP-tree / Asesmen / blok naratif / rencana mingguan KADANG
    # berlanjut ke tabel Word TERPISAH sesudahnya (bukan di sel bersarang
    # tabel yang sama) -- jadi jangan cuma baca identity_rows utk itu semua,
    # gabungkan dulu dengan tabel-tabel top-level berikutnya sampai ketemu
    # tabel lampiran yang jelas tidak terkait (rubrik/tugas terstruktur).
    combined_table_indices = [anchor_idx]
    combined_rows = list(identity_rows)
    for idx in range(anchor_idx + 1, len(tables_as_rows)):
        rows = tables_as_rows[idx]
        if rows and is_stop_section(rows[0]):
            break
        combined_table_indices.append(idx)
        combined_rows.extend(rows)

    # Sel dengan tabel bersarang (nested table) -- ini tempat tabel
    # "Korelasi antara CP dan Asesmen" biasanya berada (di dalam salah satu
    # sel baris "Capaian Pembelajaran (CP)"), dicari di SEMUA tabel yang ikut
    # digabung di atas, bukan cuma tabel anchor.
    # PENTING: simpan objek elemen lxml `cell._tc` itu sendiri di set, BUKAN
    # `id(cell._tc)`. `row.cells` membuat wrapper Cell python-docx yang BARU
    # tiap kali diakses, jadi objek lama bisa langsung di-garbage-collect --
    # begitu itu terjadi, `id()`-nya (alamat memori) BISA DIPAKAI ULANG oleh
    # objek lain yang benar-benar berbeda (gotcha klasik id() di Python).
    # Akibatnya baris tabel yang JAUH dari baris "Capaian Pembelajaran (CP)"
    # (mis. baris ke-21 dari 25 baris) bisa salah kedeteksi "sudah pernah
    # dilihat" padahal itu sel yang berbeda -- tabel Korelasi-nya jadi
    # DIAM-DIAM TERLEWATI walau sebetulnya ADA (bug nyata yang ditemukan pada
    # RPS Bahasa Indonesia, Arsitektur Sistem Operasi, dkk.). Menyimpan objek
    # elemen-nya langsung (bukan id-nya) sekaligus menahan referensi supaya
    # tidak ke-garbage-collect, jadi perbandingan identitasnya valid terus.
    nested_tables_rows = []
    seen_tcs = set()
    for idx in combined_table_indices:
        for row in document.tables[idx].rows:
            for cell in row.cells:
                if cell._tc in seen_tcs:
                    continue
                seen_tcs.add(cell._tc)
                for nested in cell.tables:
                    nested_tables_rows.append(table_to_rows(nested))

    # Baris CP-tree: baris "Capaian Pembelajaran (CP)" punya label vMerge
    # berulang di kolom pertama -- itu bukan kode, cuma label dekoratif, jadi
    # dibuang dulu sebelum diserahkan ke extract_cp_tree (yang mengharapkan
    # sel pertama berisi KODE, bukan label section).
    #
    # PENTING: dulu baris ini difilter SATU-SATU berdasarkan label "Capaian
    # Pembelajaran" di sel pertama. Itu salah kalau tabel CP-tree terpotong
    # jadi 2 tabel Word terpisah di batas halaman (bukan 1 tabel yang sama
    # tapi cuma "kelihatan" menyambung) -- baris lanjutan di tabel kedua
    # (mis. "CPMK3 | subCPMK4: ...") kehilangan label vMerge-nya (sel pertama
    # jadi kosong), sehingga tidak match filter label dan diam-diam KEBUANG
    # (bikin CPMK/Sub-CPMK di tabel lanjutan itu hilang seluruhnya dari hasil
    # ekstraksi). Perbaikannya: ambil SEMUA baris dalam rentang kontinu dari
    # baris "CPL-PRODI yang dibebankan" pertama sampai baris "Korelasi antara
    # CP dan Asesmen" (inklusif), apa pun isi sel pertamanya masing-masing.
    cp_start_idx = None
    cp_end_idx = None
    for i, row in enumerate(combined_rows):
        joined = " ".join(row)
        if cp_start_idx is None and (
            re.match(r"^Capaian\s+Pembelajaran", row[0], re.I)
            or re.search(r"CPL[\s-]?PRODI", joined, re.I)
        ):
            cp_start_idx = i
        if cp_start_idx is not None and re.search(r"Korelasi\s+(?:antara\s+)?CP\s+dan\s+(?:[Aa]sesmen|[Aa]ssessmen|[Aa]ssessment)", joined, re.I):
            cp_end_idx = i
            break
    if cp_start_idx is None:
        cp_rows_raw = []
    else:
        cp_rows_raw = combined_rows[cp_start_idx:(cp_end_idx + 1) if cp_end_idx is not None else len(combined_rows)]

    cp_rows_stripped = []
    for row in cp_rows_raw:
        if len(row) > 1 and re.match(r"^Capaian\s+Pembelajaran", row[0], re.I):
            cp_rows_stripped.append(row[1:])
        else:
            cp_rows_stripped.append(row)

    cp_all_tables = [cp_rows_stripped] + nested_tables_rows
    cpl_list, cpmk_list, subcpmk_list = extract_cp_tree(cp_all_tables)

    # "weekly" dihitung DI SINI (lebih awal dari sebelumnya) karena dipakai
    # juga sebagai fallback Formatif/Sumatif di bawah -- lihat catatan di situ.
    weekly = extract_weekly_plan_docx(combined_rows)

    # PENTING: dipanggil 2x terpisah, BUKAN digabung jadi 1 list
    # (nested_tables_rows + [combined_rows]). Baris teks pemicu "Korelasi
    # antara CP dan Asesmen" cuma ada di combined_rows (baris tabel utama),
    # SEDANGKAN isi rincian Kuis/Tugas/Ujian yg sesungguhnya sering ada di
    # tabel bersarang (nested_tables_rows) yang TIDAK memuat teks pemicu itu
    # sendiri. Kalau nested_tables_rows diproses duluan (urutan lama), mode
    # "in_section" masih False saat baris datanya dibaca -> seluruh isinya
    # kebuang. Nested table di sini sudah pasti scope-nya dalam Korelasi
    # (asalnya dari sel-sel di rentang cp_rows_raw), jadi langsung anggap
    # assume_in_section=True tanpa perlu pemicu teks.
    assessment_rows = {
        **extract_assessment_rows(nested_tables_rows, assume_in_section=True),
        **extract_assessment_rows([combined_rows]),
    }
    for idx, sub in enumerate(subcpmk_list):
        info = assessment_rows.get(sub.get("raw_number", sub["global_number"])) or {}
        has_korelasi_data = bool(
            info.get("formatif") or info.get("kuis") or info.get("tugas")
            or info.get("ujian") or info.get("pjbl") or info.get("presentasi") or info.get("lainnya")
        )

        # Fallback dihitung SELALU (bukan cuma kalau Korelasi table kosong
        # total) -- karena sebagian dokumen punya tabel Korelasi yang HANYA
        # memuat sebagian bucket (mis. Kuis/Tugas/Ujian/PjBL saja), sementara
        # Presentasi (atau bucket lain) cuma disebut di teks bebas "Teknik &
        # Kriteria Penilaian" tabel rencana mingguan. Kalau fallback ini cuma
        # dipanggil saat has_korelasi_data == False (all-or-nothing per
        # Sub-CPMK), bucket yang "ketinggalan" itu akan PERMANEN kosong
        # walau infonya sebenarnya ADA, cuma di tempat lain -- ini akar bug
        # yang dilaporkan: Presentasi tidak pernah terekstraksi walau
        # Kuis/Tugas/Ujian/PjBL dari tabel Korelasi berhasil.
        week_detail = weekly[idx] if idx < len(weekly) else None
        parsed = parse_embedded_assessment((week_detail or {}).get("teknik_kriteria", ""))

        if has_korelasi_data:
            sub["bobot"] = info.get("bobot_total", "")
            sub["formatif_nama"] = info.get("formatif") or parsed["formatif"]
            sub["formatif_bobot"] = info.get("formatif_bobot") or parsed["formatif_bobot"]
            sub["kuis"] = info.get("kuis") or parsed["kuis"]
            sub["tugas"] = info.get("tugas") or parsed["tugas"]
            sub["ujian"] = info.get("ujian") or parsed["ujian"]
            sub["pjbl"] = info.get("pjbl") or parsed["pjbl"]
            sub["presentasi"] = info.get("presentasi") or parsed["presentasi"]
            sub["lainnya"] = info.get("lainnya") or parsed["lainnya"] or []
            sub["bentuk_pembelajaran"] = info.get("bentuk_pembelajaran", "")
            sub["metode_pembelajaran"] = info.get("metode_pembelajaran", "")
        else:
            # Tabel Korelasi sama sekali tidak punya data utk Sub-CPMK ini --
            # rincian Formatif/Sumatif (mis. "Kuis 1 (5%)", "Laporan Singkat 1
            # (10%)") malah ditulis sebagai teks bebas di sel Teknik & Kriteria
            # Penilaian pada tabel rencana mingguan. Sub-CPMK ke-n (urutan
            # dokumen) berpasangan dengan baris mingguan ke-n, sama seperti
            # pemetaan yang dipakai rpsDocxParser.js untuk field lain
            # (indikator, materi, dst).
            if parsed["formatif"] or parsed["formatif_bobot"] or parsed["kuis"] or parsed["tugas"] or parsed["ujian"] or parsed["pjbl"] or parsed["presentasi"] or parsed["lainnya"]:
                sub["formatif_nama"] = parsed["formatif"]
                sub["formatif_bobot"] = parsed["formatif_bobot"]
                sub["kuis"] = parsed["kuis"]
                sub["tugas"] = parsed["tugas"]
                sub["ujian"] = parsed["ujian"]
                sub["pjbl"] = parsed["pjbl"]
                sub["presentasi"] = parsed["presentasi"]
                sub["lainnya"] = parsed["lainnya"]

    # Sama seperti CP-tree di atas: kalau blok naratif (Materi Kajian/Pustaka/
    # Dosen/dst) kepotong jadi tabel Word terpisah di batas halaman, baris
    # lanjutannya (mis. isi "Pendukung:" yang menyambung ke tabel berikutnya)
    # kehilangan label vMerge di sel pertama (jadi kosong) dan diam-diam
    # KEBUANG kalau difilter satu-satu berdasar label. Jadi ambil rentang
    # kontinu dari label naratif PERTAMA yang ketemu sampai baris header
    # rencana mingguan ("Pekan"/"Mg Ke"), apa pun isi sel pertama tiap
    # barisnya -- bukan filter per baris berdasarkan label.
    narrative_start_idx = None
    narrative_end_idx = None
    for i, row in enumerate(combined_rows):
        if narrative_start_idx is None and re.match(
            r"^(Deskripsi\s+Singkat|Materi\s+Kajian|Bahan\s+Kajian|Pustaka|Utama|Pendukung|"
            r"Dosen(?:\s+Pengampu)?|Mata\s*kuliah\s+syarat|Matakuliah\s+syarat)",
            row[0], re.I,
        ):
            narrative_start_idx = i
        if narrative_start_idx is not None and (
            re.match(r"^Pekan\b|^Mg\s*Ke", row[0], re.I) or row[0].strip() == "(1)"
        ):
            narrative_end_idx = i
            break
    if narrative_start_idx is None:
        narrative_rows_raw = []
    else:
        narrative_rows_raw = combined_rows[
            narrative_start_idx:(narrative_end_idx if narrative_end_idx is not None else len(combined_rows))
        ]
    narrative_rows = expand_multiline_cells(narrative_rows_raw)
    text_sections = extract_narrative_sections([narrative_rows])

    full_text = "\n".join(p.text for p in document.paragraphs)

    return {
        "identity": identity,
        "otorisasi": otorisasi,
        "cpl": cpl_list,
        "cpmk": cpmk_list,
        "subcpmk": subcpmk_list,
        "weekly": weekly,
        **text_sections,
        "raw_text": full_text,
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "no_docx_path_given"}))
        sys.exit(1)
    try:
        result = extract(sys.argv[1])
        print(json.dumps(result, ensure_ascii=True))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
