# E-Raport Digital MDTA/MDTU — V5 Payment Gateway Midtrans

Paket ini mengubah alur penjualan menjadi:

Landing Page → Checkout → Midtrans Snap → QRIS / e-wallet / Virtual Account / metode aktif → Webhook Midtrans → Status dibayar → Akses Google Drive.

## Struktur

- `public/index.html` — landing page
- `public/checkout.html` — checkout pembayaran
- `public/success.html` — status pembayaran + tombol akses setelah paid
- `server.js` — backend Node.js / Express
- `data/orders.json` — penyimpanan order sederhana untuk demo / deployment kecil
- `.env.example` — contoh environment variable
- `package.json`

## 1. Buat akun Midtrans

Gunakan akun Midtrans dan mulai dari **Sandbox**.

Ambil:
- Client Key
- Server Key

JANGAN pernah menaruh Server Key di file HTML.

## 2. Environment Variable

Konfigurasikan pada hosting/server:

MIDTRANS_SERVER_KEY
MIDTRANS_CLIENT_KEY
MIDTRANS_IS_PRODUCTION=false
BASE_URL
DRIVE_DOWNLOAD_URL
PORT

Catatan: paket ini sengaja tidak menyimpan key asli.

## 3. Jalankan lokal

Node.js 18+ diperlukan.

```bash
npm install
npm start
```

Buka:
http://localhost:3000

## 4. Webhook Midtrans

Set Payment Notification URL pada dashboard Midtrans ke:

https://DOMAIN-ANDA/api/midtrans-notification

Gunakan HTTPS pada deployment produksi.

Webhook memverifikasi signature:

SHA512(order_id + status_code + gross_amount + SERVER_KEY)

Order hanya dianggap sukses bila status server sudah `settlement` atau `capture` yang diterima.

## 5. Link Google Drive

Masukkan link aplikasi pada environment variable:

DRIVE_DOWNLOAD_URL

Link ini TIDAK ditanam di HTML publik.
Endpoint akses hanya mengeluarkan link setelah order berstatus paid/settlement/capture dan token akses cocok.

## 6. Sandbox → Production

Sebelum production:
- selesaikan aktivasi akun merchant Midtrans
- aktifkan metode pembayaran yang diperlukan
- ganti Server Key dan Client Key production
- set MIDTRANS_IS_PRODUCTION=true
- pastikan domain menggunakan HTTPS
- konfigurasi Payment Notification URL production
- lakukan transaksi nominal kecil untuk pengujian sebelum iklan dibuka

## 7. Catatan deployment

`data/orders.json` cocok untuk demo / trafik kecil, tetapi untuk produksi sebaiknya diganti database seperti PostgreSQL/MySQL/Supabase.

Untuk platform serverless, filesystem lokal biasanya tidak persisten. Gunakan database eksternal.

## Keamanan

- Server Key hanya di backend/environment variable.
- Webhook memvalidasi signature Midtrans.
- Jangan memberi akses download hanya berdasarkan callback browser.
- Status pembayaran harus berasal dari webhook/server.
- Webhook dibuat idempotent dengan `order_id` sebagai key.
