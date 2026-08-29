# E-Raport Digital MDTA/MDTU — V15 Gabungan

Paket ini sudah menggabungkan:
1. Landing Page V14 terbaru.
2. Checkout pembayaran.
3. Midtrans Snap Payment Gateway V5.
4. Halaman status pembayaran.
5. Akses file setelah pembayaran terverifikasi.
6. Struktur siap diunggah ke GitHub dan dideploy ke hosting Node.js.

## Alur
Landing Page -> Pesan Sekarang -> checkout.html -> Midtrans Snap ->
QRIS / e-wallet / Virtual Account / metode aktif -> webhook ->
success.html -> akses aplikasi.

## Penting tentang GitHub dan Bitly
GitHub dapat dipakai untuk menyimpan source/repository. GitHub Pages saja TIDAK dapat
menjalankan `server.js` Node/Express yang dibutuhkan Midtrans Server Key dan webhook.

Untuk website pembayaran yang berfungsi penuh:
- Upload repository ini ke GitHub.
- Hubungkan repository ke Render/Railway/VPS Node.js.
- Setelah memperoleh URL HTTPS publik, URL tersebut boleh dipendekkan memakai Bitly.

Bitly bukan hosting aplikasi; Bitly hanya membuat short link menuju URL website yang sudah online.

## Environment Variables
Jangan masukkan Server Key ke HTML atau repository publik.

Set di hosting:
- MIDTRANS_SERVER_KEY
- MIDTRANS_CLIENT_KEY
- MIDTRANS_IS_PRODUCTION=false  (ubah true setelah siap production)
- BASE_URL=https://domain-anda
- DRIVE_DOWNLOAD_URL=link-file-aplikasi

## Midtrans Webhook
Payment Notification URL:
https://domain-anda/api/midtrans-notification

## Uji
Mulai dengan Midtrans Sandbox. Setelah transaksi, webhook, status, dan akses file bekerja,
baru pindahkan ke Production.
