# Fitur Penilaian

Halaman untuk dosen/admin memasukkan nilai mahasiswa per Sub-CPMK, dengan
komponen nilai (Formatif, Kuis, Tugas, Ujian, PjBL, Lainnya) beserta
**bobot masing-masing yang otomatis diambil dari data RPS**.

**Status saat ini: fitur ini murni input & penyimpanan nilai mentah per
komponen. Belum ada perhitungan otomatis** (mis. nilai akhir per Sub-CPMK
atau nilai akhir mata kuliah dari akumulasi bobot x nilai). Yang sudah
benar dan bisa diandalkan adalah **pengambilan bobot dari RPS** -- setiap
komponen penilaian yang tampil di tabel mengikuti persis bobot (%) yang
sudah diisi dosen saat menyusun/upload RPS-nya.

## Di mana kodenya

- **Route**: `src/routes/penilaian.js`
- **Views**: `src/views/penilaian-semester.ejs` (halaman pilih Semester ->
  Mata Kuliah -> Kelas), `src/views/penilaian-tabel.ejs` (tabel input nilai)
- **Data**: `src/database/kelas.json` (daftar kelas per tingkat),
  `src/database/mahasiswa.json` (daftar mahasiswa per kelas),
  `src/database/penilaian.json` (nilai yang sudah disimpan)

## Alur pengguna

1. **`GET /penilaian`** -- satu halaman dengan 3 dropdown berantai (semua
   berjalan di client-side lewat JavaScript, tanpa reload halaman):
   - **Semester** (1-8, hardcode di view).
   - **Mata Kuliah** -- difilter dari RPS milik user (admin: semua RPS)
     yang `semester`-nya cocok dengan pilihan di atas.
   - **Kelas** -- difilter dari `kelas.json` berdasarkan **tingkat**, hasil
     konversi dari semester (`tingkatFromSemester`: semester 1-2 -> tingkat
     1, 3-4 -> tingkat 2, 5-6 -> tingkat 3, 7-8 -> tingkat 4).
   - Tombol "Lihat Tabel Penilaian" aktif kalau ketiganya sudah dipilih,
     lalu langsung navigasi ke `/penilaian/mk/:rpsId/kelas/:kelasId`.
2. **`GET /penilaian/mk/:rpsId/kelas/:kelasId`** -- halaman tabel nilai:
   - Tab per Sub-CPMK (label "Sub-CPMK 1", "Sub-CPMK 2", dst -- nomornya
     dihitung ULANG dari 0 berurutan berdasar CPMK lalu Sub-CPMK di
     dalamnya, BUKAN dari field `global_number` di RPS yang tidak selalu
     terisi benar).
   - Tiap tab menampilkan ringkasan pekan, deskripsi Sub-CPMK, dan
     badge bobot tiap komponen (Formatif/Kuis/Tugas/Ujian/PjBL/Lainnya)
     persis seperti yang tersimpan di RPS-nya.
   - Tabel mahasiswa (dari `mahasiswa.json`, difilter `kelasId`) dengan
     kolom input angka (0-100) per komponen nilai yang PUNYA bobot > 0 di
     Sub-CPMK tsb.
   - Nilai yang sudah pernah disimpan otomatis terisi kembali (`savedValues`,
     dibaca dari `penilaian.json`).
3. **`POST /penilaian/mk/:rpsId/kelas/:kelasId/save`** -- simpan semua nilai
   sekaligus (satu submit untuk semua tab & semua mahasiswa). Field nilai
   pakai notasi `nilai[<nomorSubCpmk>][<idMahasiswa>][formatif|kuis|tugas|
   ujian|pjbl]` atau `nilai[...][...][lainnya][<index>]` untuk komponen
   "Lainnya" yang jumlahnya dinamis. Hanya key berformat ini yang disimpan
   (field lain diabaikan sebagai jaga-jaga). Satu dokumen `penilaian.json`
   per kombinasi `rpsId` + `kelasId` (bukan per mahasiswa), isinya map
   `values` datar seperti di atas.

## Bagaimana bobot diambil dari RPS

Fungsi `buildSubCpmkListForPenilaian(rpsItem)` di `routes/penilaian.js`
membaca ulang field mentah RPS (`sub_cpmk[CPMKxx][n][formatif_bobot]`,
`sub_cpmk[CPMKxx][n][sumatif_kuis_bobot]`, dst -- field yang SAMA yang
diisi dosen lewat form Edit RPS atau hasil ekstraksi upload Word) dan
menyusunnya jadi daftar Sub-CPMK berurutan lengkap dengan nama & bobot tiap
komponen. Karena diambil langsung dari sumber yang sama (bukan disalin
manual), **bobot yang tampil di tabel Penilaian selalu sinkron** dengan RPS
-- kalau dosen mengubah bobot di RPS (lewat Edit RPS), halaman Penilaian
otomatis ikut berubah tanpa perlu setting ulang.

Komponen "Lainnya" (`sub_cpmk[...][sumatif_lainnya]`, disimpan sebagai JSON
string berisi array `{nama, bobot}`) juga ikut terbaca dinamis -- kalau
dosen menambah 2 item "Lainnya" di RPS, tabel Penilaian otomatis
menampilkan 2 kolom nilai tambahan sesuai nama & bobot masing-masing.

## Yang BELUM ada (di luar cakupan saat ini)

- **Perhitungan nilai akhir** -- tidak ada rumus `nilai x bobot` yang
  dijumlahkan otomatis, baik di level Sub-CPMK maupun di level mata kuliah.
  Yang tersimpan murni nilai mentah per komponen per mahasiswa.
- **Rekap/laporan nilai** -- belum ada halaman ringkasan lintas Sub-CPMK
  atau lintas mahasiswa (mis. rata-rata kelas, distribusi nilai).
- **Validasi total bobot 100%** -- tidak ada pengecekan bahwa bobot semua
  komponen di satu Sub-CPMK menjumlah 100%; itu tanggung jawab dosen saat
  mengisi RPS.
- Route `GET /penilaian/semester/:semester` dan `GET /penilaian/mk/:rpsId`
  (langkah pilih mata kuliah & pilih kelas sebagai halaman terpisah) ada di
  kode tapi **tidak dipakai** oleh alur UI saat ini -- halaman
  `penilaian-semester.ejs` langsung loncat ke tabel penilaian via
  JavaScript begitu ketiga dropdown terisi, tidak lewat route-route ini.
