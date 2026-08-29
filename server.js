const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();

app.use(express.json({ limit: '256kb' }));
app.use(
  express.static(
    path.join(__dirname, 'public')
  )
);

const PORT =
  process.env.PORT || 3000;

const SERVER_KEY =
  process.env.MIDTRANS_SERVER_KEY || '';

const CLIENT_KEY =
  process.env.MIDTRANS_CLIENT_KEY || '';

const IS_PROD =
  String(
    process.env.MIDTRANS_IS_PRODUCTION ||
    'false'
  ).toLowerCase() === 'true';

const DRIVE_URL =
  process.env.DRIVE_DOWNLOAD_URL || '';
// fallback lama saja,
// tidak digunakan oleh V15.7

const BASE_URL =
  process.env.BASE_URL ||
  `http://localhost:${PORT}`;

const PRICE = 75000;


// ======================================================
// V15.7 SUPABASE PRIVATE STORAGE
// ======================================================

const SUPABASE_URL =
  String(
    process.env.SUPABASE_URL || ''
  ).replace(/\/$/, '');

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  '';

const SUPABASE_BUCKET =
  process.env.SUPABASE_BUCKET ||
  'eraport-download';

const SUPABASE_FILE =
  process.env.SUPABASE_FILE ||
  'E-Raport MDTU.zip';

const SIGNED_URL_SECONDS =
  Math.max(
    60,
    Number(
      process.env.SIGNED_URL_SECONDS ||
      600
    )
  );


// ======================================================
// DOWNLOAD PROTECTION
// ======================================================

const DOWNLOAD_MAX =
  Math.max(
    1,
    Number(
      process.env.DOWNLOAD_MAX || 3
    )
  );

const DOWNLOAD_TTL_HOURS =
  Math.max(
    1,
    Number(
      process.env.DOWNLOAD_TTL_HOURS ||
      48
    )
  );


// ======================================================
// MIDTRANS URL
// ======================================================

const SNAP_API =
  IS_PROD
    ? 'https://app.midtrans.com/snap/v1/transactions'
    : 'https://app.sandbox.midtrans.com/snap/v1/transactions';

const SNAP_JS =
  IS_PROD
    ? 'https://app.midtrans.com/snap/snap.js'
    : 'https://app.sandbox.midtrans.com/snap/snap.js';

const STATUS_API_BASE =
  IS_PROD
    ? 'https://api.midtrans.com/v2'
    : 'https://api.sandbox.midtrans.com/v2';


// ======================================================
// MIDTRANS STATUS MAPPING
// ======================================================

function mapMidtransStatus(n) {

  const tx =
    String(
      n?.transaction_status || ''
    ).toLowerCase();

  const fraud =
    String(
      n?.fraud_status || ''
    ).toLowerCase();

  if (tx === 'settlement') {
    return 'settlement';
  }

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


// ======================================================
// GET STATUS LANGSUNG KE MIDTRANS
// ======================================================

async function fetchMidtransStatus(
  orderId
) {

  if (!SERVER_KEY) {
    throw new Error(
      'MIDTRANS_SERVER_KEY belum dikonfigurasi.'
    );
  }

  const auth =
    Buffer
      .from(
        SERVER_KEY + ':'
      )
      .toString('base64');

  const r =
    await fetch(
      `${STATUS_API_BASE}/${encodeURIComponent(orderId)}/status`,
      {
        method: 'GET',

        headers: {
          Accept:
            'application/json',

          Authorization:
            'Basic ' + auth
        }
      }
    );

  let d = {};

  try {
    d = await r.json();
  } catch {}

  if (!r.ok) {

    const err =
      new Error(
        d.status_message ||

        (
          Array.isArray(
            d.error_messages
          )
            ? d.error_messages.join(', ')
            : ''
        ) ||

        `HTTP ${r.status}`
      );

    err.httpStatus =
      r.status;

    throw err;
  }

  return d;
}


// ======================================================
// ORDER STORAGE
// ======================================================

const DATA_FILE =
  path.join(
    __dirname,
    'data',
    'orders.json'
  );

function ensureDataFile() {

  fs.mkdirSync(
    path.dirname(DATA_FILE),
    {
      recursive: true
    }
  );

  if (
    !fs.existsSync(DATA_FILE)
  ) {

    fs.writeFileSync(
      DATA_FILE,
      '{}'
    );
  }
}


function readOrders() {

  ensureDataFile();

  try {

    return JSON.parse(
      fs.readFileSync(
        DATA_FILE,
        'utf8'
      ) || '{}'
    );

  } catch {

    return {};
  }
}


function writeOrders(orders) {

  ensureDataFile();

  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(
      orders,
      null,
      2
    )
  );
}


function saveOrder(order) {

  const orders =
    readOrders();

  orders[order.orderId] = {

    ...(
      orders[order.orderId] ||
      {}
    ),

    ...order,

    updatedAt:
      new Date().toISOString()
  };

  writeOrders(orders);
}


function getOrder(orderId) {

  return (
    readOrders()[orderId] ||
    null
  );
}


// ======================================================
// SIMPAN STATUS MIDTRANS
// ======================================================

function persistMidtransStatus(
  orderId,
  d
) {

  const existing =
    getOrder(orderId);

  if (!existing) {
    return null;
  }

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

    rawLastStatus:
      d
  });

  return getOrder(orderId);
}


// ======================================================
// SUPABASE PRIVATE STORAGE
// ======================================================

function assertSupabaseConfig() {

  const missing = [];

  if (!SUPABASE_URL) {
    missing.push(
      'SUPABASE_URL'
    );
  }

  if (
    !SUPABASE_SERVICE_ROLE_KEY
  ) {
    missing.push(
      'SUPABASE_SERVICE_ROLE_KEY'
    );
  }

  if (!SUPABASE_BUCKET) {
    missing.push(
      'SUPABASE_BUCKET'
    );
  }

  if (!SUPABASE_FILE) {
    missing.push(
      'SUPABASE_FILE'
    );
  }

  if (missing.length) {

    throw new Error(
      'Konfigurasi Supabase belum lengkap: ' +
      missing.join(', ')
    );
  }
}


function encodeStoragePath(value) {

  return String(value)
    .split('/')
    .map(
      part =>
        encodeURIComponent(part)
    )
    .join('/');
}


// ======================================================
// CREATE SUPABASE SIGNED URL
// ======================================================

async function createSupabaseSignedDownloadUrl() {

  assertSupabaseConfig();

  const endpoint =
    `${SUPABASE_URL}/storage/v1/object/sign/` +
    `${encodeURIComponent(SUPABASE_BUCKET)}/` +
    `${encodeStoragePath(SUPABASE_FILE)}`;

  const r =
    await fetch(
      endpoint,
      {
        method: 'POST',

        headers: {

          Accept:
            'application/json',

          'Content-Type':
            'application/json',

          apikey:
            SUPABASE_SERVICE_ROLE_KEY,

          Authorization:
            'Bearer ' +
            SUPABASE_SERVICE_ROLE_KEY
        },

        body:
          JSON.stringify({
            expiresIn:
              SIGNED_URL_SECONDS
          })
      }
    );

  let d = {};

  try {
    d = await r.json();
  } catch {}

  if (!r.ok) {

    throw new Error(
      d.message ||
      d.error ||
      d.statusCode ||
      `Supabase HTTP ${r.status}`
    );
  }

  const signedPath =
    d.signedURL ||
    d.signedUrl ||
    d.signed_url;

  if (!signedPath) {

    throw new Error(
      'Supabase tidak mengembalikan signed URL.'
    );
  }

  let url =
    signedPath.startsWith('http')
      ? signedPath
      : new URL(
          signedPath,
          SUPABASE_URL
        ).toString();

  // Paksa file menjadi download
  const sep =
    url.includes('?')
      ? '&'
      : '?';

  url +=
    `${sep}download=` +
    encodeURIComponent(
      SUPABASE_FILE
        .split('/')
        .pop()
    );

  return url;
}


// ======================================================
// TEST KONEKSI SUPABASE
// ======================================================

app.get(
  '/api/storage-health',
  async (req, res) => {

    try {

      const signedUrl =
        await createSupabaseSignedDownloadUrl();

      res.json({

        ok: true,

        provider:
          'supabase',

        bucket:
          SUPABASE_BUCKET,

        file:
          SUPABASE_FILE,

        signedUrlSeconds:
          SIGNED_URL_SECONDS,

        signedUrlCreated:
          Boolean(signedUrl)
      });

    } catch (err) {

      res
        .status(500)
        .json({

          ok: false,

          provider:
            'supabase',

          error:
            err.message
        });
    }
  }
);
// ======================================================
// SECURE DOWNLOAD HELPERS
// ======================================================

function ensureDownloadWindow(order) {

  const now =
    Date.now();

  let expiresAt =
    order.downloadExpiresAt
      ? new Date(
          order.downloadExpiresAt
        ).getTime()
      : 0;

  if (
    !expiresAt ||
    Number.isNaN(expiresAt)
  ) {

    expiresAt =
      now +
      (
        DOWNLOAD_TTL_HOURS *
        60 *
        60 *
        1000
      );
  }

  saveOrder({

    orderId:
      order.orderId,

    downloadMax:
      Number(
        order.downloadMax ||
        DOWNLOAD_MAX
      ),

    downloadCount:
      Number(
        order.downloadCount ||
        0
      ),

    downloadExpiresAt:
      new Date(
        expiresAt
      ).toISOString()
  });

  return getOrder(
    order.orderId
  );
}


function getDownloadState(order) {

  const max =
    Number(
      order.downloadMax ||
      DOWNLOAD_MAX
    );

  const count =
    Number(
      order.downloadCount ||
      0
    );

  const expiresMs =
    order.downloadExpiresAt
      ? new Date(
          order.downloadExpiresAt
        ).getTime()
      : 0;

  return {

    max,

    count,

    remaining:
      Math.max(
        0,
        max - count
      ),

    expiresAt:
      order.downloadExpiresAt ||
      '',

    expired:
      !expiresMs ||
      Date.now() >
      expiresMs,

    exhausted:
      count >= max
  };
}


// ======================================================
// CONFIG API
// checkout.html membutuhkan snapJsUrl
// ======================================================

app.get(
  '/api/config',
  (req, res) => {

    res.json({

      clientKey:
        CLIENT_KEY,

      snapJsUrl:
        SNAP_JS,

      isProduction:
        IS_PROD
    });
  }
);


// ======================================================
// CREATE TRANSACTION
// ======================================================

app.post(
  '/api/create-transaction',
  async (req, res) => {

    try {

      if (
        !SERVER_KEY ||
        !CLIENT_KEY
      ) {

        return res
          .status(500)
          .json({

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


      if (
        !nama ||
        !wa ||
        !email
      ) {

        return res
          .status(400)
          .json({

            error:
              'Nama, WhatsApp, dan email wajib diisi.'
          });
      }


      const orderId =

        `ERAPORT-${Date.now()}-` +

        crypto
          .randomBytes(3)
          .toString('hex');


      const accessToken =

        crypto
          .randomBytes(24)
          .toString('hex');


      const payload = {

        transaction_details: {

          order_id:
            orderId,

          gross_amount:
            PRICE
        },

        item_details: [
          {

            id:
              'ERAPORT-MDTA-MDTU',

            price:
              PRICE,

            quantity:
              1,

            name:
              'E-Raport Digital MDTA/MDTU'
          }
        ],

        customer_details: {

          first_name:
            String(nama)
              .slice(0, 50),

          email:
            String(email)
              .slice(0, 100),

          phone:
            String(wa)
              .slice(0, 30)
        },

        custom_field1:
          String(madrasah)
            .slice(0, 255),

        custom_field2:
          String(catatan)
            .slice(0, 255)
      };


      // ==================================================
      // MODE QRIS / GOPAY
      // ==================================================

      if (
        String(
          paymentMode
        ).toLowerCase()
        === 'qris'
      ) {

        payload.enabled_payments =
          ['gopay'];
      }


      const auth =

        Buffer
          .from(
            SERVER_KEY + ':'
          )
          .toString('base64');


      const r =

        await fetch(
          SNAP_API,
          {

            method:
              'POST',

            headers: {

              Accept:
                'application/json',

              'Content-Type':
                'application/json',

              Authorization:
                'Basic ' + auth
            },

            body:
              JSON.stringify(
                payload
              )
          }
        );


      const d =
        await r.json();


      if (!r.ok) {

        console.error(
          'Midtrans create error',
          d
        );

        return res
          .status(
            r.status
          )
          .json({

            error:
              d.error_messages
                ?.join(', ') ||

              d.status_message ||

              'Gagal membuat transaksi Midtrans.'
          });
      }


      saveOrder({

        orderId,

        accessToken,

        status:
          'pending',

        nama,

        wa,

        email,

        madrasah,

        catatan,

        grossAmount:
          PRICE,

        paymentMode:
          String(
            paymentMode
          ).toLowerCase(),

        snapToken:
          d.token,

        createdAt:
          new Date()
            .toISOString()
      });


      res.json({

        orderId,

        accessToken,

        snapToken:
          d.token
      });

    } catch (err) {

      console.error(
        err
      );

      res
        .status(500)
        .json({

          error:
            'Terjadi kesalahan server.'
        });
    }
  }
);


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
          .createHash(
            'sha512'
          )
          .update(

            String(
              order_id
            ) +

            String(
              status_code
            ) +

            String(
              gross_amount
            ) +

            SERVER_KEY
          )
          .digest(
            'hex'
          );


      if (
        !signature_key ||
        signature_key !==
        expected
      ) {

        return res
          .status(403)
          .json({

            error:
              'Signature notification tidak valid.'
          });
      }


      const existing =
        getOrder(
          order_id
        );


      if (!existing) {

        return res
          .status(404)
          .json({

            error:
              'Order tidak ditemukan.'
          });
      }


      const status =
        mapMidtransStatus(
          n
        );


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

        received:
          true
      });

    } catch (err) {

      console.error(
        err
      );

      res
        .status(500)
        .json({

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
      getOrder(
        orderId
      );


    if (!o) {

      return res
        .status(404)
        .json({

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

      String(
        req.query.sync ||
        '1'
      ) !== '0'

      &&

      !terminalStatuses
        .includes(
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
          )

          || o;

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
        o.paymentType ||
        '',

      transactionId:
        o.transactionId ||
        '',

      settlementTime:
        o.settlementTime ||
        '',

      transactionTime:
        o.transactionTime ||
        '',

      statusMessage:
        o.statusMessage ||
        '',

      updatedAt:
        o.updatedAt ||
        ''
    });
  }
);


// ======================================================
// FORCE SYNC STATUS
// ======================================================

app.post(
  '/api/order/:orderId/sync',
  async (req, res) => {

    const orderId =
      req.params.orderId;


    if (
      !getOrder(
        orderId
      )
    ) {

      return res
        .status(404)
        .json({

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
          o.paymentType ||
          '',

        transactionId:
          o.transactionId ||
          '',

        settlementTime:
          o.settlementTime ||
          '',

        transactionTime:
          o.transactionTime ||
          '',

        statusMessage:
          o.statusMessage ||
          '',

        updatedAt:
          o.updatedAt ||
          ''
      });

    } catch (err) {

      console.error(

        'Midtrans manual sync error:',

        orderId,

        err.message
      );


      res
        .status(
          err.httpStatus ||
          502
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
// SECURE ACCESS CHECK
// ======================================================

app.get(
  '/api/access/:orderId/:accessToken',
  async (req, res) => {

    let o =
      getOrder(
        req.params.orderId
      );


    if (!o) {

      return res
        .status(404)
        .json({

          error:
            'Order tidak ditemukan.'
        });
    }


    if (
      req.params.accessToken !==
      o.accessToken
    ) {

      return res
        .status(403)
        .json({

          error:
            'Token akses tidak valid.'
        });
    }


    // ==================================================
    // AUTO SYNC STATUS KE MIDTRANS
    // ==================================================

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
          )

          || o;

      } catch (err) {

        console.warn(

          'Access status sync warning:',

          req.params.orderId,

          err.message
        );
      }
    }


    // ==================================================
    // HARUS SUDAH DIBAYAR
    // ==================================================

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

      return res
        .status(402)
        .json({

          error:
            'Pembayaran belum terverifikasi.',

          status:
            o.status ||
            'pending'
        });
    }


    // ==================================================
    // VALIDASI SUPABASE CONFIG
    // ==================================================

    try {

      assertSupabaseConfig();

    } catch (err) {

      return res
        .status(503)
        .json({

          error:
            err.message
        });
    }


    // ==================================================
    // SIAPKAN BATAS DOWNLOAD
    // ==================================================

    o =
      ensureDownloadWindow(
        o
      );


    const state =
      getDownloadState(
        o
      );


    // ==================================================
    // CEK MASA BERLAKU
    // ==================================================

    if (
      state.expired
    ) {

      return res
        .status(410)
        .json({

          error:
            'Masa akses download telah berakhir.',

          ...state
        });
    }


    // ==================================================
    // CEK BATAS DOWNLOAD
    // ==================================================

    if (
      state.exhausted
    ) {

      return res
        .status(429)
        .json({

          error:
            'Batas download telah tercapai.',

          ...state
        });
    }


    // ==================================================
    // KIRIM ENDPOINT DOWNLOAD AMAN
    // BUKAN LINK SUPABASE ASLI
    // ==================================================

    res.json({

      status:
        o.status,

      downloadUrl:

        `/api/download/${encodeURIComponent(o.orderId)}/${encodeURIComponent(o.accessToken)}`,

      ...state
    });
  }
);


// ======================================================
// SECURE DOWNLOAD VIA SUPABASE SIGNED URL
// ======================================================

app.get(
  '/api/download/:orderId/:accessToken',
  async (req, res) => {

    let o =
      getOrder(
        req.params.orderId
      );


    // ==================================================
    // ORDER HARUS ADA
    // ==================================================

    if (!o) {

      return res
        .status(404)
        .send(
          'Order tidak ditemukan.'
        );
    }


    // ==================================================
    // TOKEN HARUS VALID
    // ==================================================

    if (
      req.params.accessToken !==
      o.accessToken
    ) {

      return res
        .status(403)
        .send(
          'Token akses tidak valid.'
        );
    }


    // ==================================================
    // AUTO SYNC STATUS MIDTRANS
    // ==================================================

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
          )

          || o;

      } catch (err) {

        console.warn(

          'Download status sync warning:',

          req.params.orderId,

          err.message
        );
      }
    }


    // ==================================================
    // HARUS SETTLEMENT / CAPTURE
    // ==================================================

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

      return res
        .status(402)
        .send(
          'Pembayaran belum terverifikasi.'
        );
    }


    // ==================================================
    // VALIDASI SUPABASE
    // ==================================================

    try {

      assertSupabaseConfig();

    } catch (err) {

      return res
        .status(503)
        .send(
          err.message
        );
    }


    // ==================================================
    // DOWNLOAD WINDOW
    // ==================================================

    o =
      ensureDownloadWindow(
        o
      );


    const state =
      getDownloadState(
        o
      );


    // ==================================================
    // EXPIRED
    // ==================================================

    if (
      state.expired
    ) {

      return res
        .status(410)
        .send(
          'Masa akses download telah berakhir.'
        );
    }


    // ==================================================
    // LIMIT DOWNLOAD
    // ==================================================

    if (
      state.exhausted
    ) {

      return res
        .status(429)
        .send(
          'Batas download telah tercapai.'
        );
    }


    // ==================================================
    // BUAT SIGNED URL SUPABASE
    // ==================================================

    try {

      const signedUrl =

        await createSupabaseSignedDownloadUrl();


      // ==================================================
      // CATAT DOWNLOAD
      // ==================================================

      saveOrder({

        orderId:
          o.orderId,

        downloadCount:
          state.count + 1,

        lastDownloadAt:
          new Date()
            .toISOString(),

        lastStorageProvider:
          'supabase'
      });


      // ==================================================
      // REDIRECT KE SIGNED URL
      // LINK HANYA AKTIF SEMENTARA
      // ==================================================

      return res.redirect(
        302,
        signedUrl
      );


    } catch (err) {

      console.error(

        'Supabase signed URL error:',

        err.message
      );


      return res
        .status(502)
        .send(

          'Gagal menyiapkan link download sementara. ' +

          err.message
        );
    }
  }
);


// ======================================================
// HEALTH CHECK
// ======================================================

app.get(
  '/api/health',
  (req, res) => {

    res.json({

      status:
        'ok',

      service:
        'E-Raport Payment Gateway',

      version:
        'V15.7',

      storage:
        'supabase',

      midtrans:
        IS_PROD
          ? 'PRODUCTION'
          : 'SANDBOX',

      signedUrlSeconds:
        SIGNED_URL_SECONDS,

      downloadMax:
        DOWNLOAD_MAX,

      downloadTtlHours:
        DOWNLOAD_TTL_HOURS,

      time:
        new Date()
          .toISOString()
    });
  }
);


// ======================================================
// ROOT
// ======================================================

app.get(
  '/',
  (req, res) => {

    res.sendFile(

      path.join(
        __dirname,
        'public',
        'index.html'
      )
    );
  }
);


// ======================================================
// START SERVER
// ======================================================

app.listen(
  PORT,
  () => {

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


    console.log(

      `Storage: SUPABASE PRIVATE`
    );


    console.log(

      `Bucket: ${SUPABASE_BUCKET}`
    );


    console.log(

      `File: ${SUPABASE_FILE}`
    );


    console.log(

      `Signed URL: ${SIGNED_URL_SECONDS} detik`
    );


    console.log(

      `Download maksimal: ${DOWNLOAD_MAX}`
    );


    console.log(

      `Masa akses: ${DOWNLOAD_TTL_HOURS} jam`
    );
  }
);
