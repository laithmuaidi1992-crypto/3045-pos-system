// ─────────────────────────────────────────────────────────────────────────────
//  WizarPOS Q2 Driver · Arab Bank Jordan
//
//  This driver translates POS HTTP requests into the protocol used by your
//  WizarPOS Q2 terminal. The Q2 supports several integration modes; the
//  correct one depends on what Arab Bank / their acquirer has flashed onto
//  your specific device.
//
//  COMMON Q2 INTEGRATION MODES (from most → least common in Jordan):
//
//  1) TCP socket on terminal's WiFi IP (port typically 8888 / 1234 / 6000)
//     - Q2 runs an "ECR Listener" service
//     - Bridge opens socket, sends framed message, reads response
//     - Format: usually JSON-line, ISO8583-lite, or Verifone-style XML
//     - Pros: fastest, most stable, no cables
//     - Cons: requires fixed/reserved IP for terminal
//
//  2) Bluetooth SPP (Serial Port Profile)
//     - Q2 paired to cashier PC over BT, exposed as virtual COM port
//     - Bridge writes/reads via serialport package
//
//  3) USB-Serial (CDC-ACM)
//     - Q2 plugged via USB, mounts as /dev/ttyACM* (Linux) or COM* (Windows)
//
//  4) WizarCloud Push API
//     - POS calls bank's cloud, cloud pushes to terminal via FCM
//     - Requires merchant API key from bank
//
//  5) QR-Push (intent broadcast)
//     - POS displays QR with amount; cashier scans on Q2 with "Pay" app
//     - No automated reconciliation; less robust
//
//  WHAT YOU NEED FROM ARAB BANK / THE ACQUIRER:
//    • Confirmation: which mode is enabled on YOUR Q2?
//    • If TCP:    terminal IP + port + message protocol document
//    • If BT/USB: device pairing instructions + protocol document
//    • If Cloud:  API endpoint, merchant ID, API key
//    • Test merchant credentials (so you can integrate without burning real fees)
//
//  Email/call to Arab Bank Merchant Services (الخدمات التجارية):
//    • +962 6 5600900 (Jordan call center)
//    • merchant.support@arabbank.com.jo
//    Ask for: "ECR Integration documentation for WizarPOS Q2 — JSON-over-TCP
//             or POSLink protocol — and a test terminal profile."
// ─────────────────────────────────────────────────────────────────────────────

const TERMINAL_IP = process.env.TERMINAL_IP || "192.168.1.100";
const TERMINAL_PORT = parseInt(process.env.TERMINAL_PORT || "8888", 10);
const TIMEOUT_MS = parseInt(process.env.TERMINAL_TIMEOUT || "90000", 10);
const SIMULATE = String(process.env.SIMULATE || "true").toLowerCase() === "true";

// ─── SIMULATED MODE ─────────────────────────────────────────────────────────
// Until you receive the protocol document from Arab Bank, the driver runs in
// simulation mode: it returns plausible fake responses so you can build & test
// the POS UI end-to-end. Set SIMULATE=false in your environment once the real
// protocol implementation is in place below.

async function simulatedCharge({ amount, currency, ref }) {
  await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));
  // 5% simulated decline rate so you can test error UI
  if (Math.random() < 0.05) {
    return { ok: false, error: "DECLINED — Insufficient funds (simulated)", code: "51" };
  }
  return {
    ok: true,
    rrn: String(Date.now()).slice(-12),
    approval: String(Math.floor(100000 + Math.random() * 900000)),
    pan: "4*** **** **** " + String(Math.floor(1000 + Math.random() * 9000)),
    last4: String(Math.floor(1000 + Math.random() * 9000)),
    brand: ["Visa", "MasterCard", "JoMoPay"][Math.floor(Math.random() * 3)],
    terminalId: process.env.TERMINAL_ID || "Q2-SIM-001",
    amount,
    currency,
    raw: { simulated: true, ref, ts: new Date().toISOString() }
  };
}

// ─── REAL TCP DRIVER (TEMPLATE) ─────────────────────────────────────────────
// Once Arab Bank gives you the protocol spec, fill in the framing & message
// fields below. The shape shown matches the most common JSON-line ECR pattern
// used on WizarPOS Q2 deployments in MEA region. Adjust per the actual spec.

async function tcpCharge({ amount, currency, ref, terminalId, merchantId }) {
  const net = require("net");
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let buffer = "";
    let resolved = false;

    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      try { socket.destroy(); } catch {}
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ ok: false, error: "Terminal timeout (no response in " + (TIMEOUT_MS/1000) + "s)" });
    }, TIMEOUT_MS);

    socket.setEncoding("utf8");

    socket.on("connect", () => {
      // ⚠️ REPLACE THIS MESSAGE FORMAT WITH YOUR BANK'S SPEC ⚠️
      const request = JSON.stringify({
        command: "SALE",
        amount: Math.round(amount * 1000), // fils
        currency: currency || "JOD",
        ecrRef: ref || "",
        terminalId: terminalId || process.env.TERMINAL_ID || "",
        merchantId: merchantId || process.env.MERCHANT_ID || ""
      }) + "\n"; // line-delimited
      socket.write(request);
    });

    socket.on("data", (chunk) => {
      buffer += chunk;
      // Most Q2 ECR protocols are line-delimited (\n or ETX/0x03)
      const newlineIdx = buffer.indexOf("\n");
      if (newlineIdx >= 0) {
        const line = buffer.slice(0, newlineIdx);
        clearTimeout(timer);
        try {
          const resp = JSON.parse(line);
          // ⚠️ MAP THE BANK'S RESPONSE FIELD NAMES HERE ⚠️
          // Common alternatives: rrn/RRN/retrievalRef, approvalCode/authCode/auth,
          // pan/maskedPan/cardNumber, brand/cardScheme/cardType
          if (resp.responseCode === "00" || resp.success === true || resp.approved === true) {
            finish({
              ok: true,
              rrn: resp.rrn || resp.retrievalRef || resp.RRN || "",
              approval: resp.approvalCode || resp.authCode || resp.auth || "",
              pan: resp.maskedPan || resp.pan || resp.cardNumber || "",
              last4: (resp.maskedPan || resp.pan || "").replace(/\D/g, "").slice(-4),
              brand: resp.cardScheme || resp.brand || resp.cardType || "",
              terminalId: resp.terminalId || terminalId,
              amount,
              currency,
              raw: resp
            });
          } else {
            finish({
              ok: false,
              error: resp.responseMessage || resp.error || "Declined (code " + (resp.responseCode || "??") + ")",
              code: resp.responseCode,
              raw: resp
            });
          }
        } catch (parseErr) {
          finish({ ok: false, error: "Invalid response from terminal: " + parseErr.message, raw: line });
        }
      }
    });

    socket.on("error", (err) => {
      clearTimeout(timer);
      finish({ ok: false, error: "Cannot reach terminal at " + TERMINAL_IP + ":" + TERMINAL_PORT + " — " + err.message });
    });

    socket.on("close", () => {
      if (!resolved) {
        clearTimeout(timer);
        finish({ ok: false, error: "Terminal closed connection without response" });
      }
    });

    socket.connect(TERMINAL_PORT, TERMINAL_IP);
  });
}

async function tcpVoid({ rrn, amount }) {
  const net = require("net");
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const finish = (r) => { try { socket.destroy(); } catch {} resolve(r); };
    const timer = setTimeout(() => finish({ ok: false, error: "Void timeout" }), TIMEOUT_MS);
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      const req = JSON.stringify({ command: "VOID", rrn, amount: Math.round((amount || 0) * 1000) }) + "\n";
      socket.write(req);
    });
    let buf = "";
    socket.on("data", chunk => {
      buf += chunk;
      if (buf.indexOf("\n") >= 0) {
        clearTimeout(timer);
        try {
          const r = JSON.parse(buf.split("\n")[0]);
          finish({ ok: r.responseCode === "00" || r.success === true, raw: r, error: r.responseMessage });
        } catch (e) { finish({ ok: false, error: "Invalid void response" }); }
      }
    });
    socket.on("error", err => { clearTimeout(timer); finish({ ok: false, error: err.message }); });
    socket.connect(TERMINAL_PORT, TERMINAL_IP);
  });
}

async function tcpHealth() {
  const net = require("net");
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timer = setTimeout(() => {
      try { socket.destroy(); } catch {}
      resolve({ ok: false, error: "Terminal unreachable", terminal: TERMINAL_IP + ":" + TERMINAL_PORT });
    }, 3000);
    socket.on("connect", () => {
      clearTimeout(timer);
      try { socket.destroy(); } catch {}
      resolve({ ok: true, terminal: "WizarPOS Q2 @ " + TERMINAL_IP + ":" + TERMINAL_PORT });
    });
    socket.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message, terminal: TERMINAL_IP + ":" + TERMINAL_PORT });
    });
    socket.connect(TERMINAL_PORT, TERMINAL_IP);
  });
}

// ─── EXPORTS ────────────────────────────────────────────────────────────────

module.exports = {
  name: SIMULATE ? "wizarpos-q2-simulated" : "wizarpos-q2-tcp",
  async charge(args) {
    if (SIMULATE) return simulatedCharge(args);
    return tcpCharge(args);
  },
  async void(args) {
    if (SIMULATE) return { ok: true, simulated: true };
    return tcpVoid(args);
  },
  async health() {
    if (SIMULATE) {
      return { ok: true, terminal: "WizarPOS Q2 (SIMULATED)", note: "Set SIMULATE=false once real protocol is in place" };
    }
    return tcpHealth();
  }
};
