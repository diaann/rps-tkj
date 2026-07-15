# Ekstraksi RPS dari Word (.docx) -- python-docx

Upload RPS membaca file **Word (.docx)** yang di-upload dosen dan mengekstrak
strukturnya (Identitas MK, Otorisasi, CPL, CPMK, Sub-CPMK, Korelasi Asesmen,
Deskripsi Singkat, Materi Kajian, Pustaka, Dosen Pengampu) menjadi data RPS
yang sama persis strukturnya dengan input manual lewat form.

Kenapa dibaca dari .docx dan bukan format lain: struktur tabel di file .docx
eksplisit di datanya sendiri (baris & sel yang jelas), tidak perlu ditebak
dari posisi garis/koordinat teks. Halaman sampul (cover), kalau ada, otomatis
TIDAK ikut terekstrak/tersimpan -- skrip ini hanya membaca ISI TABEL (bukan
paragraf bebas), dan tabel identitas RPS dicari lewat tanda tangan headernya
sendiri ("MATA KULIAH (MK)" + "KODE" + "SEMESTER"), bukan asal tabel/halaman
pertama.

## Arsitektur

- `src/utils/rps_common.py` -- util & logika ekstraksi yang dipakai oleh
  `docx_extractor.py`: deteksi kode CPL/CPMK/Sub-CPMK, klasifikasi kolom
  Sumatif (Kuis/Tugas/Ujian/PjBL/Lainnya), dan pembacaan blok naratif
  (Deskripsi Singkat, Materi Kajian, Pustaka, Dosen Pengampu, Mata Kuliah
  Syarat). Dipisah dari `docx_extractor.py` supaya logika generik ini rapi
  terpisah dari kode baca tabel docx-nya sendiri.
- `src/utils/docx_extractor.py` -- mesin ekstraksi Word (python-docx). Output
  JSON-nya dikonsumsi oleh `src/utils/rpsDocxParser.js` (`parseRpsDocxBuffer`)
  lewat `child_process.spawnSync`, lalu dirakit jadi `rpsData` yang formatnya
  sama seperti input manual -- tidak ada perbedaan di routes/views setelahnya.

## Yang perlu di-install di server

Python 3 sudah harus ada di server (biasanya sudah terpasang di Linux/macOS).

```bash
pip install -r requirements.txt
```

Kalau `python3` di server dipanggil dengan nama lain (mis. hanya `python`),
set environment variable `PYTHON_BIN` sebelum menjalankan server:

```bash
PYTHON_BIN=python npm start
```

## Pola yang sudah ditangani

Diuji terhadap puluhan file .docx RPS nyata -- beberapa pola yang ditemukan
& sudah ditangani:
- Kode CPMK berformat desimal (mis. "CPMK06.1", bukan cuma "CPMK1").
- Kode "CPMK" dan nomornya terpisah baris/token akibat cara Word membungkus
  teks di sel sempit.
- Variasi penulisan seperti "CPMK - 1" (pakai spasi-strip) dan "Sub CPMK 1:
  deskripsi" (deskripsi menyatu langsung, bukan sel terpisah).
- Satu sel berisi beberapa entri CPMK/Sub-CPMK sekaligus (dipisah baris
  paragraf dalam 1 sel yang sama).
- Kode & deskripsi di sel-sel terpisah, kode yang kepotong jadi 2 baris
  akibat lebar kolom sempit, dan label "Sub-CPMK 3" tanpa garis-strip/titik-
  dua.

## Batasan yang masih ada

- Beberapa file punya tabel rencana mingguan yang formatnya sedikit beda
  (header tidak persis "Pekan" + "Indikator") sehingga rencana mingguan bisa
  kosong untuk sebagian file -- field terkait akan ditandai di
  `extraction_notes` (dikembalikan bersama hasil ekstraksi) untuk dicek
  manual lewat Edit RPS.
- Kalau field Nama MK / Semester kosong hasil ekstraksi, itu paling sering
  karena memang kosong juga di file sumbernya, bukan bug pembacaan.
- Tahun Akademik memang tidak pernah tercantum eksplisit di dokumen RPS
  manapun yang diuji -- selalu ditandai di `extraction_notes` supaya user
  tahu perlu mengisi manual, bukan diam-diam ditebak.
- Tabel rencana mingguan mengasumsikan kolom baku sesuai template Dikti.
  Template yang menggabungkan kolom (mis. Luring+Daring jadi 1 kolom "Bentuk
  dan Metode Pembelajaran") bisa membuat pemetaan kolom kurang presisi.

Kalau ke depannya ketemu pola baru yang belum tertangani, cara paling efektif
memperbaikinya: tambahkan pola pengenalan di fungsi terkait di
`docx_extractor.py`, sambil menguji langsung terhadap contoh file tersebut --
bukan menulis ulang dari nol.
