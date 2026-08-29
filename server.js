// ============================================================
// E-RAPORT DIGITAL MDTA/MDTU
// SERVER V15.5 FINAL
// MIDTRANS AUTO-SYNC STATUS
// ============================================================

const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();

// ============================================================
// ENVIRONMENT
// ============================================================

const PORT = process.env.PORT || 8080;

const SERVER_KEY = process.env.MIDTRANS_SERVER_KEY || "";
const CLIENT_KEY = process.env.MIDTRANS_CLIENT_KEY || "";

const IS_PROD =
  String(process.env.MIDTRANS_IS_PRODUCTION || "false")
    .toLowerCase() === "true";

const BASE_URL =
  process.env.BASE_URL ||
  `http://localhost:${PORT}`;

const DRIVE_DOWNLOAD_URL =
  process.env.DRIVE_DOWNLOAD_URL || "";

// ============================================================
// MIDTRANS URL
// ============================================================

const SNAP_BASE = IS_PROD
  ? "https://app.midtrans.com"
  : "https://app.sandbox.midtrans.com";

const SNAP_API = IS_PROD
  ? "https://app.midtrans.com/snap/v1/transactions"
  : "https://app.sandbox.midtrans.com/snap/v1/transactions";

const SNAP_JS = IS_PROD
  ? "https://app.midtrans.com/snap/snap.js"
  : "https://app.sandbox.midtrans.com/snap/snap.js";

const STATUS_API_BASE = IS_PROD
  ? "https://api.midtrans.com/v2"
  : "https://api.sandbox.midtrans.com/v2";

// ============================================================
// MIDDLEWARE
// ============================================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Folder public
app.use(express.static(path.join(__dirname, "public")));

// ============================================================
// DATA ORDER
// ============================================================

const dataDir = path.join(__dirname, "data");
const ordersFile = path.join(dataDir, "orders.json");

function ensureDataFile() {
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    if (!fs.existsSync(ordersFile)) {
      fs.writeFileSync(
        ordersFile,
        JSON.stringify({}, null, 2),
        "utf8"
      );
    }
  } catch (err) {
    console.error("Gagal menyiapkan orders.json:", err.message);
  }
}

ensureDataFile();

// ============================================================
// READ ORDERS
// ============================================================

function readOrders() {
  try {
    ensureDataFile();

    const raw = fs.readFileSync(ordersFile, "utf8");

    if (!raw.trim()) return {};

    return JSON.parse(raw);
  } catch (err) {
    console.error("Gagal membaca orders:", err.message);
    return {};
  }
}

// ============================================================
// WRITE ORDERS
// ============================================================

function writeOrders(data) {
  try {
    ensureDataFile();

    fs.writeFileSync(
      ordersFile,
      JSON.stringify(data, null, 2),
      "utf8"
    );

    return true;
  } catch (err) {
    console.error("Gagal menyimpan orders:", err.message);
    return false;
  }
}

// ============================================================
// GET ORDER
// ============================================================

function getOrder(orderId) {
  const orders = readOrders();

  return orders[orderId] || null;
}

// ============================================================
// SAVE ORDER
// ============================================================

function saveOrder(data) {
  const orders = readOrders();

  const old = orders[data.orderId] || {};

  orders[data.orderId] = {
    ...old,
    ...data,

    createdAt:
      old.createdAt ||
      data.createdAt ||
      new Date().toISOString(),

    updatedAt: new Date().toISOString()
  };

  writeOrders(orders);

  return orders[data.orderId];
}

// ============================================================
// GENERATE ORDER ID
// ============================================================

function createOrderId() {
  return (
    "ERAPORT-" +
    Date.now() +
    "-" +
    Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase()
  );
}

// ============================================================
// ACCESS TOKEN
// ============================================================

function createAccessToken() {
  return (
    Date.now().toString(36) +
    Math.random()
      .toString(36)
      .substring(2) +
    Math.random()
      .toString(36)
      .substring(2)
  );
}

// ============================================================
// NORMALISASI STATUS MIDTRANS
// ============================================================

function mapMidtransStatus(data) {
  const tx = String(
    data?.transaction_status || ""
  ).toLowerCase();

  const fraud = String(
    data?.fraud_status || ""
  ).toLowerCase();

  if (tx === "settlement") {
    return "settlement";
  }

  if (
    tx === "capture" &&
    (!fraud || fraud === "accept")
  ) {
    return "capture";
  }

  if (
    tx === "capture" &&
    fraud &&
    fraud !== "accept"
  ) {
    return "challenge";
  }

  return tx || "pending";
}

// ============================================================
// CEK STATUS LANGSUNG KE MIDTRANS
// ============================================================

async function fetchMidtransStatus(orderId) {
  if (!SERVER_KEY) {
    throw new Error(
      "MIDTRANS_SERVER_KEY belum tersedia."
    );
  }

  const auth = Buffer
    .from(SERVER_KEY + ":")
    .toString("base64");

  const url =
    `${STATUS_API_BASE}/${encodeURIComponent(orderId)}/status`;

  const response = await fetch(url, {
    method: "GET",

    headers: {
      Accept: "application/json",

      Authorization:
        "Basic " + auth
    }
  });

  let data = {};

  try {
    data = await response.json();
  } catch (_) {}

  if (!response.ok) {
    const message =
      data.status_message ||
      (Array.isArray(data.error_messages)
        ? data.error_messages.join(", ")
        : "") ||
      `HTTP ${response.status}`;

    const err = new Error(message);

    err.httpStatus = response.status;

    throw err;
  }

  return data;
}

// ============================================================
// SIMPAN STATUS MIDTRANS KE orders.json
// ============================================================

function persistMidtransStatus(orderId, data) {
  const existing = getOrder(orderId);

  if (!existing) {
    return null;
  }

  const status =
    mapMidtransStatus(data);

  saveOrder({
    orderId,

    status,

    paymentType:
      data.payment_type ||
      existing.paymentType ||
      "",

    transactionId:
      data.transaction_id ||
      existing.transactionId ||
      "",

    settlementTime:
      data.settlement_time ||
      existing.settlementTime ||
      "",

    transactionTime:
      data.transaction_time ||
      existing.transactionTime ||
      "",

    statusMessage:
      data.status_message ||
      existing.statusMessage ||
      "",

    rawLastStatus: data
  });

  return getOrder(orderId);
}

// ============================================================
// CONFIG API
// ============================================================

app.get("/api/config", (req, res) => {
  res.json({
    clientKey: CLIENT_KEY,

    isProduction: IS_PROD,

    snapJs: SNAP_JS,

    baseUrl: BASE_URL,

    product: {
      name: "E-Raport Digital MDTA/MDTU",

      price: 75000
    }
  });
});

// ============================================================
// CREATE SNAP TRANSACTION
// ============================================================

app.post("/api/create-transaction", async (req, res) => {
  try {
    if (!SERVER_KEY) {
      return res.status(500).json({
        error:
          "MIDTRANS_SERVER_KEY belum diatur."
      });
    }

    const {
      name,
      email,
      phone,
      institution,
      notes
    } = req.body || {};

    if (!name || !email || !phone) {
      return res.status(400).json({
        error:
          "Nama, email dan WhatsApp wajib diisi."
      });
    }

    const orderId =
      createOrderId();

    const accessToken =
      createAccessToken();

    const grossAmount = 75000;

    const payload = {
      transaction_details: {
        order_id: orderId,

        gross_amount: grossAmount
      },

      item_details: [
        {
          id: "ERAPORT-MDTA-MDTU",

          price: grossAmount,

          quantity: 1,

          name:
            "E-Raport Digital MDTA/MDTU"
        }
      ],

      customer_details: {
        first_name: name,

        email,

        phone
      },

      callbacks: {
        finish:
          `${BASE_URL}/success.html?order_id=${encodeURIComponent(orderId)}&access=${encodeURIComponent(accessToken)}`
      }
    };

    const auth = Buffer
      .from(SERVER_KEY + ":")
      .toString("base64");

    const response =
      await fetch(SNAP_API, {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          Accept:
            "application/json",

          Authorization:
            "Basic " + auth
        },

        body:
          JSON.stringify(payload)
      });

    const result =
      await response.json();

    if (!response.ok) {
      console.error(
        "MIDTRANS CREATE ERROR:",
        result
      );

      return res
        .status(response.status)
        .json({
          error:
            result.error_messages ||
            result.status_message ||
            "Gagal membuat transaksi Midtrans."
        });
    }

    saveOrder({
      orderId,

      accessToken,

      status: "pending",

      grossAmount,

      name,

      email,

      phone,

      institution:
        institution || "",

      notes:
        notes || "",

      snapToken:
        result.token || "",

      redirectUrl:
        result.redirect_url || ""
    });

    res.json({
      token:
        result.token,

      redirect_url:
        result.redirect_url,

      order_id:
        orderId,

      access:
        accessToken
    });

  } catch (err) {
    console.error(
      "CREATE TRANSACTION ERROR:",
      err
    );

    res.status(500).json({
      error:
        "Terjadi kesalahan pada server.",

      detail:
        err.message
    });
  }
});

// ============================================================
// WEBHOOK MIDTRANS
// ============================================================

app.post(
  "/api/midtrans-notification",
  async (req, res) => {

    try {
      const notification =
        req.body || {};

      const orderId =
        notification.order_id;

      if (!orderId) {
        return res.status(400).json({
          error:
            "order_id tidak ditemukan."
        });
      }

      console.log(
        "MIDTRANS NOTIFICATION:",
        orderId,
        notification.transaction_status
      );

      // Jangan hanya percaya data browser.
      // Sinkronkan kembali langsung ke Midtrans.

      let data =
        notification;

      try {
        data =
          await fetchMidtransStatus(
            orderId
          );
      } catch (syncErr) {
        console.warn(
          "Webhook status sync gagal:",
          syncErr.message
        );
      }

      const existing =
        getOrder(orderId);

      if (existing) {
        persistMidtransStatus(
          orderId,
          data
        );
      }

      return res.status(200).json({
        received: true
      });

    } catch (err) {
      console.error(
        "WEBHOOK ERROR:",
        err
      );

      return res.status(500).json({
        error:
          err.message
      });
    }
  }
);

// ============================================================
// GET ORDER
// AUTO SYNC DENGAN MIDTRANS
// ============================================================

app.get(
  "/api/order/:orderId",
  async (req, res) => {

    const orderId =
      req.params.orderId;

    let order =
      getOrder(orderId);

    if (!order) {
      return res
        .status(404)
        .json({
          error:
            "Order tidak ditemukan."
        });
    }

    const terminalStatuses = [
      "settlement",
      "capture",
      "paid",
      "deny",
      "cancel",
      "expire",
      "failure",
      "refund",
      "partial_refund"
    ];

    const currentStatus =
      String(
        order.status || ""
      ).toLowerCase();

    // Jika status lokal belum final,
    // cek langsung ke Midtrans.

    if (
      String(req.query.sync || "1") !== "0" &&
      !terminalStatuses.includes(
        currentStatus
      )
    ) {
      try {
        const midtrans =
          await fetchMidtransStatus(
            orderId
          );

        order =
          persistMidtransStatus(
            orderId,
            midtrans
          ) || order;

      } catch (err) {
        console.warn(
          "Midtrans status sync warning:",
          orderId,
          err.message
        );
      }
    }

    res.json({
      orderId:
        order.orderId,

      status:
        order.status,

      grossAmount:
        order.grossAmount,

      paymentType:
        order.paymentType || "",

      transactionId:
        order.transactionId || "",

      settlementTime:
        order.settlementTime || "",

      transactionTime:
        order.transactionTime || "",

      statusMessage:
        order.statusMessage || "",

      updatedAt:
        order.updatedAt || ""
    });
  }
);

// ============================================================
// FORCE SYNC STATUS
// ============================================================

app.post(
  "/api/order/:orderId/sync",
  async (req, res) => {

    const orderId =
      req.params.orderId;

    const existing =
      getOrder(orderId);

    if (!existing) {
      return res
        .status(404)
        .json({
          error:
            "Order tidak ditemukan."
        });
    }

    try {
      const midtrans =
        await fetchMidtransStatus(
          orderId
        );

      const order =
        persistMidtransStatus(
          orderId,
          midtrans
        );

      res.json({
        orderId:
          order.orderId,

        status:
          order.status,

        grossAmount:
          order.grossAmount,

        paymentType:
          order.paymentType || "",

        transactionId:
          order.transactionId || "",

        settlementTime:
          order.settlementTime || "",

        statusMessage:
          order.statusMessage || "",

        updatedAt:
          order.updatedAt || ""
      });

    } catch (err) {
      console.error(
        "FORCE SYNC ERROR:",
        err.message
      );

      res
        .status(
          err.httpStatus || 502
        )
        .json({
          error:
            "Gagal menyinkronkan status Midtrans.",

          detail:
            err.message
        });
    }
  }
);

// ============================================================
// DOWNLOAD / ACCESS
// ============================================================

app.get(
  "/api/access/:orderId/:accessToken",
  async (req, res) => {

    const {
      orderId,
      accessToken
    } = req.params;

    let order =
      getOrder(orderId);

    if (!order) {
      return res
        .status(404)
        .json({
          error:
            "Order tidak ditemukan."
        });
    }

    if (
      order.accessToken !==
      accessToken
    ) {
      return res
        .status(403)
        .json({
          error:
            "Token akses tidak valid."
        });
    }

    // Sinkronisasi sekali lagi
    // sebelum memberikan download.

    try {
      const midtrans =
        await fetchMidtransStatus(
          orderId
        );

      order =
        persistMidtransStatus(
          orderId,
          midtrans
        ) || order;

    } catch (err) {
      console.warn(
        "Access status sync warning:",
        err.message
      );
    }

    const status =
      String(
        order.status || ""
      ).toLowerCase();

    const paid =
      status === "settlement" ||
      status === "capture" ||
      status === "paid";

    if (!paid) {
      return res
        .status(403)
        .json({
          error:
            "Pembayaran belum berhasil.",

          status
        });
    }

    if (!DRIVE_DOWNLOAD_URL) {
      return res
        .status(500)
        .json({
          error:
            "DRIVE_DOWNLOAD_URL belum diatur."
        });
    }

    res.json({
      success: true,

      orderId,

      status,

      url:
        DRIVE_DOWNLOAD_URL
    });
  }
);

// ============================================================
// ROOT
// ============================================================

app.get("/", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

// ============================================================
// HEALTH CHECK
// ============================================================

app.get(
  "/api/health",
  (req, res) => {

    res.json({
      status: "ok",

      service:
        "E-Raport Payment Gateway",

      midtrans:
        IS_PROD
          ? "PRODUCTION"
          : "SANDBOX",

      time:
        new Date().toISOString()
    });
  }
);

// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, () => {

  console.log(
    `E-Raport Payment Gateway berjalan di ${BASE_URL}`
  );

  console.log(
    `Mode Midtrans: ${
      IS_PROD
        ? "PRODUCTION"
        : "SANDBOX"
    }`
  );

  console.log(
    `Port: ${PORT}`
  );
});
