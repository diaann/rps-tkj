# Fitur Ubah Role User oleh Admin

Fitur ini memungkinkan admin untuk mengubah role user antara `dosen` dan `admin` melalui halaman panel admin (`/admin`).

## Perubahan Kode

1. Route baru ditambahkan di `src/routes/index.js`:
	- `POST /admin/role/:id` untuk mengubah role user.
	- Validasi hanya mengizinkan role: `admin`, `dosen`.
	- Mencegah admin terakhir diturunkan menjadi non-admin.
	- Melindungi email `admin@example.com` agar tidak bisa diturunkan (dapat disesuaikan).
	- Jika admin mengubah rolenya sendiri, session diperbarui.

2. Tampilan `views/admin.ejs` diperbarui:
	- Kolom Role kini berisi dropdown `<select>` otomatis submit saat diubah.
	- Dropdown dinonaktifkan untuk `admin@example.com` (super admin contoh).

## Alur Penggunaan

1. Admin login.
2. Buka halaman `/admin`.
3. Pada tabel user, ubah pilihan role di dropdown.
4. Halaman akan refresh dan perubahan tersimpan.

## Validasi & Keamanan

- Hanya session dengan `role === 'admin'` yang dapat mengakses route.
- Role yang diperbolehkan terbatas pada daftar `['admin', 'dosen']`.
- Tidak bisa menurunkan admin terakhir agar sistem tetap memiliki minimal satu admin.
- Dapat menambahkan daftar admin yang dilindungi di variabel `protectedAdmins`.

## Penyesuaian Lanjutan (Opsional)

- Menambah role baru: Tambahkan ke array `allowedRoles` dan ke `<select>` di EJS.
- Logging perubahan role: Tambahkan append log ke file ketika role berubah.
- Konfirmasi sebelum mengubah: Ganti `onchange="this.form.submit()"` dengan tombol Submit manual.

---
Terakhir diperbarui: 2025-10-01
