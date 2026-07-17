# Fitur Riwayat (Revision History) RPS

Setiap dokumen RPS punya riwayat versi otomatis: tiap kali dibuat, diedit,
di-upload, diduplikasi, atau dipulihkan ke versi lama, sistem menyimpan
snapshot lengkap datanya sebagai satu "revisi" baru. Tidak ada revisi yang
pernah ditimpa atau dihapus otomatis -- riwayat terus bertambah.

## Di mana kodenya

- **Data**: `src/database/rps_history.json` -- array revisi, tiap revisi
  berisi salinan penuh data RPS pada saat itu (field `data`).
- **Logika**: `src/routes/index.js` -- fungsi `createRpsRevision()`,
  `getRpsRevisions()`, `getChangedFieldKeys()`/`getChangedFieldNames()`,
  `getChangeStats()`, `ensureInitialRevision()`, `getPreviousRevisionData()`.
- **Tampilan**: `src/views/rps-history.ejs` (daftar revisi satu dokumen),
  `src/views/view-rps.ejs` (isi RPS pada satu versi tertentu).

## Kapan revisi baru dibuat

| Aksi pengguna | Route | `action` yang tersimpan |
|---|---|---|
| Buat RPS baru lewat form | `POST /save-rps` | `create` |
| Upload file Word (.docx) | `POST /upload-rps` | `upload_docx` |
| Edit RPS | `POST /edit-rps/:id` | `edit` |
| Duplikat RPS | `POST /duplicate-rps/:id` | `duplicate` |
| Pulihkan ke versi lama | `POST /history/rps/:id/revision/:revisionId/revert` | `revert` |
| Dokumen lama yang belum punya riwayat sama sekali dan baru pertama kali dibuka riwayatnya | otomatis, `ensureInitialRevision()` | `initial` |
| Dosen ajukan validasi ke kaprodi | `POST /submit-rps/:id` | `submit_validasi` |
| Kaprodi setujui (ACC) | `POST /admin/rps/approve/:id` | `acc_kaprodi` |
| Kaprodi tolak (dgn catatan) | `POST /admin/rps/reject/:id` | `tolak_kaprodi` |

## Alur validasi RPS (dosen ajukan -> kaprodi ACC/tolak)

Selain riwayat edit di atas, tiap RPS juga punya status alur validasi: `draft` ->
`diajukan` (menunggu ACC, RPS terkunci dari editan) -> `disetujui` (final, terkunci
permanen) atau `ditolak` (kembali ke dosen dgn catatan alasan, bisa direvisi &
diajukan ulang). Field-field ini (`status`, `submitted_*`, `decided_*`,
`rejection_note`) disimpan langsung di `rps.json` (lihat `RPS_STATUS`,
`getRpsStatus()`, `isRpsLocked()` di `src/routes/index.js`) dan sengaja
dikecualikan dari perbandingan `getChangedFieldKeys()` supaya perubahan status
tidak dianggap "perubahan konten".

**Khusus saat ACC**: karena RPS yang disetujui sudah final & tidak akan direvisi
lagi, riwayat revisi lama untuk RPS tsb dipangkas -- hanya snapshot revisi ACC
yang terakhir yang disimpan di `rps_history.json` (bukan seluruh riwayat `v1..vN`
sebelumnya). Ini untuk menghemat storage, karena tiap entri riwayat menyimpan
snapshot penuh isi RPS. Pemangkasan ini **tidak** terjadi saat ditolak -- riwayat
penuh tetap dipertahankan selama RPS masih berpotensi direvisi.

Tiap revisi tersimpan dengan struktur:

```jsonc
{
  "id": 12,
  "rps_id": 35,
  "revision_number": 4,
  "revision_name": "v4",
  "action": "edit",
  "message": "RPS diperbarui",
  "edited_at": "2026-07-08T09:03:51.022Z",
  "edited_by": 1,
  "edited_by_username": "admin",
  "edited_by_role": "admin",
  "changed_fields": ["Kode MK"],
  "change_stats": { "added": 0, "removed": 0, "modified": 1 },
  "source_revision_id": null,
  "source_revision_name": null,
  "data": { /* snapshot penuh RPS pada versi ini */ }
}
```

Penamaan versi (`revision_name`) pakai format `v1`, `v2`, `v3`, dst,
berurutan per dokumen (`revision_number`).

## Mendeteksi "apa yang berubah"

Ini bagian paling rumit dari fitur ini. Saat ada `edit` atau `revert`,
sistem membandingkan data SEBELUM vs SESUDAH per field mentah (mis.
`kode_mk`, `sub_cpmk[CPMK01][1][durasi]`), lalu:

1. **Menormalkan nilai sebelum dibandingkan** (`normalizeValueForCompare`) --
   array di-trim & di-sort dulu, nilai kosong/undefined/null disamakan --
   supaya field yang cuma beda urutan checkbox atau spasi TIDAK dianggap
   berubah (bug lama: edit 1 field bisa ke-flag puluhan field lain berubah).
2. **Mengklasifikasi tiap field yang benar-benar beda** (`classifyFieldChange`)
   jadi salah satu dari 3 kategori:
   - **added** -- sebelumnya kosong, sekarang ada isi (atau jumlah item
     bertambah untuk field berbentuk daftar seperti Pustaka/Dosen Pengampu).
   - **removed** -- sebelumnya ada isi, sekarang kosong (atau jumlah item
     berkurang).
   - **modified** -- sama-sama ada isi tapi nilainya beda.
3. Hasilnya disimpan sebagai `change_stats: {added, removed, modified}` dan
   ditampilkan di halaman Riwayat sebagai badge `+N` (hijau), `-N` (merah),
   `~N` (abu-abu) -- bisa muncul sekaligus kalau campuran.
4. Nama field mentah diterjemahkan ke label manusiawi (`humanizeFieldName`,
   mis. `sub_cpmk[CPMK01][1][durasi]` -> "Sub-CPMK CPMK01.1 - Durasi") untuk
   ditampilkan di bagian "Lihat bagian yang berubah".

Field turunan yang dihitung ulang otomatis tiap simpan (`cpl_descriptions`)
dan field housekeeping (`updated_at`, `updated_by`, dst) sengaja dikecualikan
dari perbandingan supaya tidak jadi noise.

## Menandai field yang berubah langsung di dalam dokumen

Selain daftar ringkas di halaman Riwayat, saat membuka **detail suatu
revisi** (`/history/rps/:id/revision/:revisionId`) atau **versi saat ini**
(`/history/view/:id`), field yang nilainya beda dari revisi sebelumnya
langsung ditandai **bold + highlight kuning** di tempat aslinya di dalam
dokumen (identitas, otorisasi, CPL, tabel CPMK, tabel Sub-CPMK per sel) --
bukan cuma daftar terpisah. Ini dihitung oleh `getChangedFieldKeys()` yang
sama, dikirim ke `view-rps.ejs` lewat variabel `changedFieldKeys`.

## Alur halaman

1. `/history` -- daftar semua dokumen RPS milik user (atau semua dokumen
   untuk admin), tiap kartu ada tombol "History".
2. `/history/rps/:id` -- daftar revisi untuk satu dokumen: total revisi,
   versi terbaru, siapa yang terakhir mengubah, dan tiap baris revisi
   (waktu, nama versi, badge +/-/~, badge jenis aksi, siapa yang
   mengedit, tombol "Lihat" & "Pulihkan versi ini").
3. `/history/rps/:id/revision/:revisionId` -- detail isi RPS pada versi
   tsb, dengan field yang berubah di-highlight, dan tombol "Pulihkan versi
   ini" kalau bukan versi terbaru.
4. `/history/view/:id` -- detail versi SAAT INI (live data di `rps.json`),
   dengan perubahan dari versi sebelumnya tetap di-highlight juga.

## Memulihkan versi lama (revert)

Klik "Pulihkan versi ini" -> `POST /history/rps/:id/revision/:revisionId/revert`.
Ini **tidak menghapus riwayat** -- datanya di-copy dari revisi lama lalu
disimpan sebagai **revisi baru** (action `revert`, `message: "Dikembalikan
ke vX"`), supaya riwayat tetap linear dan bisa dipulihkan lagi kalau perlu.
ID dokumen dan kepemilikan (`userId`) tetap ikut dokumen yang aktif, bukan
ikut data lama yang dipulihkan.

## Keterbatasan yang perlu diketahui

- Data riwayat yang dibuat **sebelum** perbaikan penamaan versi masih pakai
  label lama `r1`/`r2`/`r3` (bukan `v1`/`v2`/`v3`) -- ini murni tampilan,
  tidak memengaruhi data, dan revisi baru ke depannya otomatis pakai `v`.
- Revisi lama (dibuat sebelum fitur `change_stats` ada) tidak punya
  breakdown +/-/~ -- di halaman Riwayat, revisi seperti ini otomatis jatuh
  ke tampilan lama (badge tunggal berdasarkan jumlah field yang berubah).
- Riwayat tersimpan sebagai satu file JSON tunggal (`rps_history.json`)
  yang terus bertambah -- untuk penggunaan jangka panjang dengan banyak RPS
  & banyak revisi, pertimbangkan migrasi ke database sungguhan kalau
  performanya mulai terasa lambat.
