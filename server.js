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
const IS_PROD =
  String(process.env.MIDTRANS_IS_PRODUCTION || 'false').toLowerCase() === 'true';

const DRIVE_URL = process.env.DRIVE_DOWNLOAD_URL || '';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const PRICE = 75000;

// ======================================================
// MIDTRANS URL
// ======================================================

const SNAP_API = IS_PROD
  ? 'https://app.midtrans.com/snap/v1/transactions'
  : 'https://app.sandbox.midtrans.com/snap/v1/transactions';

const SNAP_JS = IS_PROD
  ? 'https://app.midtrans.com/snap/snap.js'
  : 'https://app.sandbox.midtrans.com/snap/snap.js';

const STATUS_API_BASE = IS_PROD
  ? 'https://api.midtrans.com/v2'
  : 'https://api.sandbox.midtrans.com/v2';

// ======================================================
// MIDTRANS STATUS
// ======================================================

function mapMidtransStatus(n) {
  const tx = String(n?.transaction_status || '').toLowerCase();
  const fraud = String(n?.fraud_status || '').toLowerCase();

  if (tx === 'settlement') return 'settlement';

  if (
    tx === 'capture' &&
    (!fraud || fraud === 'accept')
  ) {
    return 'capture';
  }

  if (
    tx === 'capture' &&
    fraud &&
    fraud !== 'accept'
  ) {
    return 'challenge';
  }

  return tx || 'pending';
}

async function fetchMidtransStatus(orderId) {
  if (!SERVER_KEY) {
    throw new Error('MIDTRANS_SERVER_KEY belum dikonfigurasi.');
  }

  const auth = Buffer.from(SERVER_KEY + ':').toString('base64');

  const r = await fetch(
    `${STATUS_API_BASE}/${encodeURIComponent(orderId)}/status`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: 'Basic ' + auth
      }
    }
  );

  let d = {};

  try {
    d = await r.json();
  } catch {}

  if (!r.ok) {
    const err = new Error(
      d.status_message ||
      (Array.isArray(d.error_messages)
        ? d.error_messages.join(', ')
        : '') ||
      `HTTP ${r.status}`
    );

    err.httpStatus = r.status;

    throw err;
  }

  return d;
}

// ======================================================
// ORDER STORAGE
// ======================================================

const DATA_FILE = path.join(__dirname, 'data', 'orders.json');

function ensureDataFile() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, '{}');
  }
}

function readOrders() {
  ensureDataFile();

  try {
    return JSON.parse(
      fs.readFileSync(DATA_FILE, 'utf8') || '{}'
    );
  } catch {
    return {};
  }
}

function writeOrders(orders) {
  ensureDataFile();

  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(orders, null, 2)
  );
}

function saveOrder(order) {
  const orders = readOrders();

  orders[order.orderId] = {
    ...(orders[order.orderId] || {}),
    ...order,
    updatedAt: new Date().toISOString()
  };

  writeOrders(orders);
}

function getOrder(orderId) {
  return readOrders()[orderId] || null;
}

function persistMidtransStatus(orderId, d) {
  const existing = getOrder(orderId);

  if (!existing) return null;

  saveOrder({
    orderId,

    status:
      mapMidtransStatus(d),

    paymentType:
      d.payment_type ||
      existing.paymentType ||
      '',

    transactionId:
      d.transaction_id ||
      existing.transactionId ||
      '',

    settlementTime:
      d.settlement_time ||
      existing.settlementTime ||
      '',

    transactionTime:
      d.transaction_time ||
      existing.transactionTime ||
      '',

    statusMessage:
      d.status_message ||
      existing.statusMessage ||
      '',

    rawLastStatus: d
  });

  return getOrder(orderId);
}

// ======================================================
// CONFIG
// checkout.html membutuhkan snapJsUrl
// ======================================================

app.get('/api/config', (req, res) => {
  res.json({
    clientKey: CLIENT_KEY,
    snapJsUrl: SNAP_JS,
    isProduction: IS_PROD
  });
});

// ======================================================
// CREATE TRANSACTION
// ======================================================

app.post('/api/create-transaction', async (req, res) => {
  try {
    if (!SERVER_KEY || !CLIENT_KEY) {
      return res.status(500).json({
        error:
          'Midtrans key belum dikonfigurasi pada server.'
      });
    }

    const {
      nama,
      wa,
      email,
      madrasah = '',
      catatan = '',
      paymentMode = 'all'
    } = req.body || {};

    if (!nama || !wa || !email) {
      return res.status(400).json({
        error:
          'Nama, WhatsApp, dan email wajib diisi.'
      });
    }

    const orderId =
      `ERAPORT-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

    const accessToken =
      crypto.randomBytes(24).toString('hex');

    const payload = {
      transaction_details: {
        order_id: orderId,
        gross_amount: PRICE
      },

      item_details: [
        {
          id: 'ERAPORT-MDTA-MDTU',
          price: PRICE,
          quantity: 1,
          name: 'E-Raport Digital MDTA/MDTU'
        }
      ],

      customer_details: {
        first_name:
          String(nama).slice(0, 50),

        email:
          String(email).slice(0, 100),

        phone:
          String(wa).slice(0, 30)
      },

      custom_field1:
        String(madrasah).slice(0, 255),

      custom_field2:
        String(catatan).slice(0, 255)
    };

    // ==================================================
    // MODE QRIS / GOPAY
    // ==================================================

    if (
      String(paymentMode).toLowerCase() === 'qris'
    ) {
      payload.enabled_payments = ['gopay'];
    }

    const auth =
      Buffer.from(SERVER_KEY + ':').toString('base64');

    const r =
      await fetch(SNAP_API, {
        method: 'POST',

        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: 'Basic ' + auth
        },

        body:
          JSON.stringify(payload)
      });

    const d =
      await r.json();

    if (!r.ok) {
      console.error(
        'Midtrans create error',
        d
      );

      return res.status(r.status).json({
        error:
          d.error_messages?.join(', ') ||
          d.status_message ||
          'Gagal membuat transaksi Midtrans.'
      });
    }

    saveOrder({
      orderId,
      accessToken,

      status: 'pending',

      nama,
      wa,
      email,
      madrasah,
      catatan,

      grossAmount: PRICE,

      paymentMode:
        String(paymentMode).toLowerCase(),

      snapToken:
        d.token,

      createdAt:
        new Date().toISOString()
    });

    res.json({
      orderId,
      accessToken,
      snapToken: d.token
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error:
        'Terjadi kesalahan server.'
    });
  }
});

// ======================================================
// MIDTRANS WEBHOOK
// ======================================================

app.post(
  '/api/midtrans-notification',
  async (req, res) => {

    try {
      const n =
        req.body || {};

      const {
        order_id,
        status_code,
        gross_amount,
        signature_key
      } = n;

      const expected =
        crypto
          .createHash('sha512')
          .update(
            String(order_id) +
            String(status_code) +
            String(gross_amount) +
            SERVER_KEY
          )
          .digest('hex');

      if (
        !signature_key ||
        signature_key !== expected
      ) {
        return res.status(403).json({
          error:
            'Signature notification tidak valid.'
        });
      }

      const existing =
        getOrder(order_id);

      if (!existing) {
        return res.status(404).json({
          error:
            'Order tidak ditemukan.'
        });
      }

      const status =
        mapMidtransStatus(n);

      saveOrder({
        orderId:
          order_id,

        status,

        paymentType:
          n.payment_type ||
          existing.paymentType ||
          '',

        transactionId:
          n.transaction_id ||
          existing.transactionId ||
          '',

        settlementTime:
          n.settlement_time ||
          existing.settlementTime ||
          '',

        rawLastNotification:
          n
      });

      res.json({
        received: true
      });

    } catch (err) {
      console.error(err);

      res.status(500).json({
        error:
          'Notification handler error.'
      });
    }
  }
);

// ======================================================
// GET ORDER + AUTO SYNC MIDTRANS
// ======================================================

app.get(
  '/api/order/:orderId',
  async (req, res) => {

    const orderId =
      req.params.orderId;

    let o =
      getOrder(orderId);

    if (!o) {
      return res.status(404).json({
        error:
          'Order tidak ditemukan.'
      });
    }

    const terminalStatuses = [
      'settlement',
      'capture',
      'paid',
      'deny',
      'cancel',
      'expire',
      'failure',
      'refund',
      'partial_refund'
    ];

    const currentStatus =
      String(
        o.status || ''
      ).toLowerCase();

    if (
      String(req.query.sync || '1') !== '0' &&
      !terminalStatuses.includes(
        currentStatus
      )
    ) {
      try {
        const d =
          await fetchMidtransStatus(
            orderId
          );

        o =
          persistMidtransStatus(
            orderId,
            d
          ) || o;

      } catch (err) {
        console.warn(
          'Midtrans status sync warning:',
          orderId,
          err.message
        );
      }
    }

    res.json({
      orderId:
        o.orderId,

      status:
        o.status,

      grossAmount:
        o.grossAmount,

      paymentType:
        o.paymentType || '',

      transactionId:
        o.transactionId || '',

      settlementTime:
        o.settlementTime || '',

      transactionTime:
        o.transactionTime || '',

      statusMessage:
        o.statusMessage || '',

      updatedAt:
        o.updatedAt || ''
    });
  }
);

// ======================================================
// MANUAL / FORCE SYNC
// ======================================================

app.post(
  '/api/order/:orderId/sync',
  async (req, res) => {

    const orderId =
      req.params.orderId;

    if (!getOrder(orderId)) {
      return res.status(404).json({
        error:
          'Order tidak ditemukan.'
      });
    }

    try {
      const d =
        await fetchMidtransStatus(
          orderId
        );

      const o =
        persistMidtransStatus(
          orderId,
          d
        );

      res.json({
        orderId:
          o.orderId,

        status:
          o.status,

        grossAmount:
          o.grossAmount,

        paymentType:
          o.paymentType || '',

        transactionId:
          o.transactionId || '',

        settlementTime:
          o.settlementTime || '',

        transactionTime:
          o.transactionTime || '',

        statusMessage:
          o.statusMessage || '',

        updatedAt:
          o.updatedAt || ''
      });

    } catch (err) {
      console.error(
        'Midtrans manual sync error:',
        orderId,
        err.message
      );

      res
        .status(
          err.httpStatus || 502
        )
        .json({
          error:
            'Gagal menyinkronkan status Midtrans.',

          detail:
            err.message
        });
    }
  }
);

// ======================================================
// ACCESS / DOWNLOAD
// Auto sync lagi sebelum memberi akses
// ======================================================

app.get(
  '/api/access/:orderId/:accessToken',
  async (req, res) => {

    let o =
      getOrder(
        req.params.orderId
      );

    if (!o) {
      return res.status(404).json({
        error:
          'Order tidak ditemukan.'
      });
    }

    if (
      req.params.accessToken !==
      o.accessToken
    ) {
      return res.status(403).json({
        error:
          'Token akses tidak valid.'
      });
    }

    if (
      ![
        'settlement',
        'capture',
        'paid'
      ].includes(
        String(
          o.status || ''
        ).toLowerCase()
      )
    ) {
      try {
        const d =
          await fetchMidtransStatus(
            req.params.orderId
          );

        o =
          persistMidtransStatus(
            req.params.orderId,
            d
          ) || o;

      } catch (err) {
        console.warn(
          'Access status sync warning:',
          req.params.orderId,
          err.message
        );
      }
    }

    if (
      ![
        'settlement',
        'capture',
        'paid'
      ].includes(
        String(
          o.status || ''
        ).toLowerCase()
      )
    ) {
      return res.status(402).json({
        error:
          'Pembayaran belum terverifikasi.',

        status:
          o.status || 'pending'
      });
    }

    if (!DRIVE_URL) {
      return res.status(503).json({
        error:
          'Link akses belum dikonfigurasi.'
      });
    }

    res.json({
      url:
        DRIVE_URL,

      status:
        o.status
    });
  }
);

// ======================================================
// START
// ======================================================

app.listen(PORT, () => {
  console.log(
    `E-Raport Payment Gateway berjalan di ${BASE_URL}`
  );

  console.log(
    `Mode Midtrans: ${
      IS_PROD
        ? 'PRODUCTION'
        : 'SANDBOX'
    }`
  );
});
