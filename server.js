const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const SERVER_KEY = process.env.MIDTRANS_SERVER_KEY || '';
const CLIENT_KEY = process.env.MIDTRANS_CLIENT_KEY || '';
const IS_PROD = String(process.env.MIDTRANS_IS_PRODUCTION || 'false').toLowerCase() === 'true';
const DRIVE_URL = process.env.DRIVE_DOWNLOAD_URL || '';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const PRICE = 75000;

const SNAP_API = IS_PROD
  ? 'https://app.midtrans.com/snap/v1/transactions'
  : 'https://app.sandbox.midtrans.com/snap/v1/transactions';
const SNAP_JS = IS_PROD
  ? 'https://app.midtrans.com/snap/snap.js'
  : 'https://app.sandbox.midtrans.com/snap/snap.js';

const DATA_FILE = path.join(__dirname, 'data', 'orders.json');

function ensureDataFile(){
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  if(!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '{}');
}
function readOrders(){
  ensureDataFile();
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8') || '{}'); }
  catch { return {}; }
}
function writeOrders(orders){
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(orders, null, 2));
}
function saveOrder(order){
  const orders = readOrders();
  orders[order.orderId] = { ...(orders[order.orderId] || {}), ...order, updatedAt: new Date().toISOString() };
  writeOrders(orders);
}
function getOrder(orderId){ return readOrders()[orderId] || null; }

app.get('/api/config', (req,res)=>{
  res.json({ clientKey: CLIENT_KEY, snapJsUrl: SNAP_JS, isProduction: IS_PROD });
});

app.post('/api/create-transaction', async (req,res)=>{
  try{
    if(!SERVER_KEY || !CLIENT_KEY) return res.status(500).json({ error:'Midtrans key belum dikonfigurasi pada server.' });

    const { nama, wa, email, madrasah='', catatan='' } = req.body || {};
    if(!nama || !wa || !email) return res.status(400).json({ error:'Nama, WhatsApp, dan email wajib diisi.' });

    const orderId = `ERAPORT-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const accessToken = crypto.randomBytes(24).toString('hex');

    const payload = {
      transaction_details: { order_id: orderId, gross_amount: PRICE },
      item_details: [{
        id:'ERAPORT-MDTA-MDTU',
        price:PRICE,
        quantity:1,
        name:'E-Raport Digital MDTA/MDTU'
      }],
      customer_details: {
        first_name: String(nama).slice(0,50),
        email: String(email).slice(0,100),
        phone: String(wa).slice(0,30)
      },
      custom_field1: String(madrasah).slice(0,255),
      custom_field2: String(catatan).slice(0,255)
    };

    const auth = Buffer.from(SERVER_KEY + ':').toString('base64');
    const r = await fetch(SNAP_API, {
      method:'POST',
      headers:{
        'Accept':'application/json',
        'Content-Type':'application/json',
        'Authorization':'Basic ' + auth
      },
      body:JSON.stringify(payload)
    });

    const d = await r.json();
    if(!r.ok) {
      console.error('Midtrans create error', d);
      return res.status(r.status).json({ error:d.error_messages?.join(', ') || d.status_message || 'Gagal membuat transaksi Midtrans.' });
    }

    saveOrder({
      orderId, accessToken, status:'pending',
      nama, wa, email, madrasah, catatan,
      grossAmount: PRICE,
      snapToken:d.token,
      createdAt:new Date().toISOString()
    });

    res.json({ orderId, accessToken, snapToken:d.token });
  }catch(err){
    console.error(err);
    res.status(500).json({ error:'Terjadi kesalahan server.' });
  }
});

app.post('/api/midtrans-notification', async (req,res)=>{
  try{
    const n = req.body || {};
    const { order_id, status_code, gross_amount, signature_key } = n;
    const expected = crypto.createHash('sha512')
      .update(String(order_id)+String(status_code)+String(gross_amount)+SERVER_KEY)
      .digest('hex');

    if(!signature_key || signature_key !== expected){
      return res.status(403).json({ error:'Signature notification tidak valid.' });
    }

    const existing = getOrder(order_id);
    if(!existing) return res.status(404).json({ error:'Order tidak ditemukan.' });

    const tx = String(n.transaction_status || '').toLowerCase();
    const fraud = String(n.fraud_status || '').toLowerCase();
    let status = tx;

    if(tx === 'capture' && fraud && fraud !== 'accept') status = 'challenge';
    if(tx === 'settlement') status = 'settlement';
    if(tx === 'capture' && (!fraud || fraud === 'accept')) status = 'capture';

    saveOrder({
      orderId:order_id,
      status,
      paymentType:n.payment_type || existing.paymentType || '',
      transactionId:n.transaction_id || existing.transactionId || '',
      settlementTime:n.settlement_time || existing.settlementTime || '',
      rawLastNotification:n
    });

    res.json({ received:true });
  }catch(err){
    console.error(err);
    res.status(500).json({ error:'Notification handler error.' });
  }
});

app.get('/api/order/:orderId', (req,res)=>{
  const o = getOrder(req.params.orderId);
  if(!o) return res.status(404).json({ error:'Order tidak ditemukan.' });
  res.json({
    orderId:o.orderId,
    status:o.status,
    grossAmount:o.grossAmount,
    paymentType:o.paymentType || '',
    updatedAt:o.updatedAt || ''
  });
});

app.get('/api/access/:orderId/:accessToken', (req,res)=>{
  const o = getOrder(req.params.orderId);
  if(!o) return res.status(404).json({ error:'Order tidak ditemukan.' });
  if(req.params.accessToken !== o.accessToken) return res.status(403).json({ error:'Token akses tidak valid.' });
  if(!['settlement','capture','paid'].includes(String(o.status).toLowerCase())){
    return res.status(402).json({ error:'Pembayaran belum terverifikasi.' });
  }
  if(!DRIVE_URL) return res.status(503).json({ error:'Link akses belum dikonfigurasi.' });
  res.json({ url: DRIVE_URL });
});

app.listen(PORT, ()=>{
  console.log(`E-Raport Payment Gateway berjalan di ${BASE_URL}`);
  console.log(`Mode Midtrans: ${IS_PROD ? 'PRODUCTION' : 'SANDBOX'}`);
});
