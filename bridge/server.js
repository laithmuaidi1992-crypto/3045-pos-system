// ─────────────────────────────────────────────────────────────────────────────
//  3045 POS · Bank Terminal Bridge Service
//  Listens on http://localhost:8765 and exposes a JSON HTTP API for the POS.
//  Translates POS requests into terminal-specific protocol (WizarPOS Q2).
//
//  Endpoints:
//    GET  /health           → { ok, terminal, driver, version }
//    POST /charge           → { ok, rrn, approval, pan, brand, terminalId, raw }
//    POST /void             → { ok, error? }
//    POST /test             → simulate a successful charge (for UI testing)
//
//  Run with: node server.js
//  CORS is permissive (localhost only) so the browser can call freely.
// ─────────────────────────────────────────────────────────────────────────────

const http = require("http");
const url = require("url");

const PORT = parseInt(process.env.BRIDGE_PORT || "8765", 10);
const HOST = process.env.BRIDGE_HOST || "127.0.0.1";

const driver = require("./wizarpos-driver");

// ─── HTTP UTILITIES ─────────────────────────────────────────────────────────

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store"
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", c => {
      chunks.push(c);
      total += c.length;
      if (total > 1024 * 64) { // 64KB max
        req.destroy();
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

function logLine(...args) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log("[" + ts + "]", ...args);
}

// ─── ROUTES ─────────────────────────────────────────────────────────────────

async function handleHealth(req, res) {
  try {
    const status = await driver.health();
    sendJson(res, 200, {
      ok: status.ok !== false,
      terminal: status.terminal || "WizarPOS Q2",
      driver: driver.name || "wizarpos",
      version: "1.0.0",
      bridgePort: PORT,
      time: new Date().toISOString(),
      ...status
    });
  } catch (err) {
    sendJson(res, 200, { ok: false, error: err.message });
  }
}

async function handleCharge(req, res) {
  let body;
  try { body = await readBody(req); } catch (e) {
    return sendJson(res, 400, { ok: false, error: e.message });
  }

  const amount = Number(body.amount);
  if (!isFinite(amount) || amount <= 0) {
    return sendJson(res, 400, { ok: false, error: "Invalid amount" });
  }

  logLine("CHARGE →", { amount, currency: body.currency, ref: body.ref });

  try {
    const result = await driver.charge({
      amount,
      currency: body.currency || "JOD",
      ref: body.ref || "",
      terminalId: body.terminalId || "",
      merchantId: body.merchantId || ""
    });
    logLine("CHARGE ←", result.ok ? "✓ APPROVED" : "✗ DECLINED", result.rrn || result.error || "");
    sendJson(res, 200, result);
  } catch (err) {
    logLine("CHARGE ✗ ERROR:", err.message);
    sendJson(res, 500, { ok: false, error: err.message });
  }
}

async function handleVoid(req, res) {
  let body;
  try { body = await readBody(req); } catch (e) {
    return sendJson(res, 400, { ok: false, error: e.message });
  }

  logLine("VOID →", { rrn: body.rrn });

  try {
    const result = await driver.void({ rrn: body.rrn, amount: body.amount });
    logLine("VOID ←", result.ok ? "✓ OK" : "✗ " + (result.error || ""));
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
}

async function handleTest(req, res) {
  // Returns a fake successful response for UI testing without a real terminal
  let body = {};
  try { body = await readBody(req); } catch {}
  const amount = Number(body.amount) || 1;
  const rrn = String(Date.now()).slice(-12);
  const approval = String(Math.floor(100000 + Math.random() * 900000));
  await new Promise(r => setTimeout(r, 1500)); // simulate terminal latency
  sendJson(res, 200, {
    ok: true,
    rrn,
    approval,
    pan: "4*** **** **** 1234",
    last4: "1234",
    brand: "Visa",
    terminalId: process.env.TERMINAL_ID || "TEST-Q2",
    amount,
    raw: { simulated: true, ts: new Date().toISOString() }
  });
}

// ─── SERVER ─────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    return res.end();
  }

  const path = url.parse(req.url).pathname;

  if (req.method === "GET" && path === "/health") return handleHealth(req, res);
  if (req.method === "POST" && path === "/charge") return handleCharge(req, res);
  if (req.method === "POST" && path === "/void") return handleVoid(req, res);
  if (req.method === "POST" && path === "/test") return handleTest(req, res);

  if (req.method === "GET" && path === "/") {
    return sendJson(res, 200, {
      service: "3045 POS Bank Bridge",
      driver: driver.name || "wizarpos",
      endpoints: ["/health", "/charge (POST)", "/void (POST)", "/test (POST)"]
    });
  }

  sendJson(res, 404, { ok: false, error: "Not found" });
});

server.listen(PORT, HOST, () => {
  console.log("─────────────────────────────────────────────────────────────");
  console.log("  3045 POS · Bank Terminal Bridge");
  console.log("  Listening on http://" + HOST + ":" + PORT);
  console.log("  Driver: " + (driver.name || "wizarpos"));
  console.log("  Health: http://" + HOST + ":" + PORT + "/health");
  console.log("─────────────────────────────────────────────────────────────");
});

// Graceful shutdown
["SIGINT", "SIGTERM"].forEach(sig => process.on(sig, () => {
  console.log("\nShutting down bridge service...");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}));
