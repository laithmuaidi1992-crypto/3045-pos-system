// ─────────────────────────────────────────────────────────────────────────────
//  bankTerminal.js — Pluggable Bank Terminal Integration Layer
//  3045 Super Market POS · Arab Bank Jordan · WizarPOS Q2
//
//  Architecture:
//    Mode "off"    → no integration; cashier operates terminal independently
//    Mode "manual" → cashier enters bank reference (RRN, Approval) into POS
//    Mode "bridge" → POS calls localhost bridge service which talks to Q2
//
//  All drivers expose the same interface:
//    charge({ amount, currency, ref })  → { ok, rrn, approval, last4, brand, terminalId, raw, error }
//    void({ rrn, originalAmount })       → { ok, error }
//    health()                             → { ok, terminal, error }
// ─────────────────────────────────────────────────────────────────────────────

export const BANK_MODES = Object.freeze({
  OFF: "off",
  MANUAL: "manual",
  BRIDGE: "bridge"
});

export const DEFAULT_BANK_CONFIG = Object.freeze({
  mode: "off",                           // "off" | "manual" | "bridge"
  bridgeUrl: "http://localhost:8765",    // Local bridge service URL
  terminalId: "",                        // WizarPOS Q2 terminal ID (printed on device)
  merchantId: "",                        // Arab Bank merchant ID
  currency: "JOD",                       // Jordanian Dinar
  bridgeTimeoutMs: 90000,                // 90s — typical EMV transaction window
  requireMatch: true,                    // require POS amount === terminal amount on match
  bankName: "Arab Bank"                  // for receipt text
});

// ─── HELPERS ────────────────────────────────────────────────────────────────

function normalizeAmount(amount) {
  // Bank terminals expect amounts in minor units (fils for JOD: 1 JOD = 1000 fils)
  // We accept JOD as a decimal, but the bridge driver converts as needed.
  const n = Number(amount);
  if (!isFinite(n) || n <= 0) throw new Error("Invalid amount: " + amount);
  return Math.round(n * 1000) / 1000; // 3 decimal places (JOD standard)
}

function maskPan(pan) {
  if (!pan) return "";
  const s = String(pan).replace(/\D/g, "");
  if (s.length < 4) return s;
  return "****" + s.slice(-4);
}

// ─── DRIVER: OFF ────────────────────────────────────────────────────────────
// No integration. Returns immediately with empty bank fields. Used when the
// store has not yet enabled any integration (default / fallback state).

const offDriver = {
  name: "off",
  async charge() {
    return { ok: true, rrn: "", approval: "", last4: "", brand: "", terminalId: "", raw: null };
  },
  async void() {
    return { ok: true };
  },
  async health() {
    return { ok: true, terminal: "off-mode" };
  }
};

// ─── DRIVER: MANUAL ─────────────────────────────────────────────────────────
// Cashier processes payment on bank terminal independently, then enters bank
// reference fields into the POS. The POS does not perform any network calls;
// validation happens here (ensure RRN + Approval are present, last4 is 4 digits).

const manualDriver = {
  name: "manual",
  async charge({ rrn, approval, last4, brand, terminalId }) {
    if (!rrn || String(rrn).trim().length < 4) {
      return { ok: false, error: "RRN مطلوب (٤ أرقام على الأقل)" };
    }
    if (!approval || String(approval).trim().length < 4) {
      return { ok: false, error: "رمز الموافقة مطلوب (٤ أرقام على الأقل)" };
    }
    const cleanLast4 = String(last4 || "").replace(/\D/g, "").slice(-4);
    if (cleanLast4 && cleanLast4.length !== 4) {
      return { ok: false, error: "آخر ٤ أرقام من البطاقة يجب أن تكون أربعة أرقام بالضبط" };
    }
    return {
      ok: true,
      rrn: String(rrn).trim(),
      approval: String(approval).trim(),
      last4: cleanLast4,
      brand: (brand || "").trim(),
      terminalId: (terminalId || "").trim(),
      raw: { entered: "manual", at: new Date().toISOString() }
    };
  },
  async void({ rrn }) {
    if (!rrn) return { ok: false, error: "RRN غير موجود" };
    // In manual mode, void must be done physically on the terminal.
    // We just acknowledge and let the cashier handle it.
    return { ok: true, manual: true };
  },
  async health() {
    return { ok: true, terminal: "manual-mode" };
  }
};

// ─── DRIVER: BRIDGE ─────────────────────────────────────────────────────────
// POS calls a small Node.js service running on the same machine (localhost).
// The bridge service in turn talks to WizarPOS Q2 over TCP/Bluetooth/USB
// using bank-supplied protocol details. This driver is protocol-agnostic at
// the POS side — it only speaks JSON HTTP to the bridge.

function makeBridgeDriver(config) {
  const baseUrl = (config.bridgeUrl || "http://localhost:8765").replace(/\/$/, "");
  const timeout = Math.max(15000, Math.min(180000, config.bridgeTimeoutMs || 90000));

  async function postJson(path, body, customTimeout) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), customTimeout || timeout);
    try {
      const res = await fetch(baseUrl + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
        signal: controller.signal
      });
      const text = await res.text();
      let data;
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
      if (!res.ok) {
        return { ok: false, error: data.error || ("HTTP " + res.status), raw: data, status: res.status };
      }
      return { ok: true, ...data };
    } catch (err) {
      if (err.name === "AbortError") {
        return { ok: false, error: "انتهت مهلة الجهاز — لم يستجب خلال " + Math.round(timeout / 1000) + " ثانية", aborted: true };
      }
      return { ok: false, error: "خطأ اتصال بالجسر: " + (err.message || err), networkError: true };
    }
  }

  async function getJson(path) {
    try {
      const res = await fetch(baseUrl + path, { method: "GET" });
      const data = await res.json().catch(() => ({}));
      return res.ok ? { ok: true, ...data } : { ok: false, error: data.error || "HTTP " + res.status };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  }

  return {
    name: "bridge",
    async charge({ amount, currency, ref }) {
      const amt = normalizeAmount(amount);
      const result = await postJson("/charge", {
        amount: amt,
        currency: currency || config.currency || "JOD",
        ref: ref || "",
        terminalId: config.terminalId || "",
        merchantId: config.merchantId || ""
      });
      if (!result.ok) return result;
      // Validate bridge response
      if (!result.rrn && !result.approval) {
        return { ok: false, error: "استجابة غير صالحة من الجسر — مفقود RRN/Approval", raw: result };
      }
      return {
        ok: true,
        rrn: result.rrn || "",
        approval: result.approval || "",
        last4: maskPan(result.pan || result.last4 || "").replace(/\*/g, ""),
        brand: result.brand || result.cardScheme || "",
        terminalId: result.terminalId || config.terminalId || "",
        raw: result
      };
    },
    async void({ rrn, originalAmount }) {
      return await postJson("/void", { rrn, amount: originalAmount });
    },
    async health() {
      return await getJson("/health");
    }
  };
}

// ─── FACTORY ────────────────────────────────────────────────────────────────

export function getBankDriver(config) {
  const cfg = { ...DEFAULT_BANK_CONFIG, ...(config || {}) };
  switch (cfg.mode) {
    case BANK_MODES.MANUAL: return manualDriver;
    case BANK_MODES.BRIDGE: return makeBridgeDriver(cfg);
    case BANK_MODES.OFF:
    default: return offDriver;
  }
}

// Convenience: charge with current config
export async function bankCharge(config, args) {
  return getBankDriver(config).charge(args);
}

// Convenience: health check
export async function bankHealth(config) {
  return getBankDriver(config).health();
}

// ─── UI HELPERS ─────────────────────────────────────────────────────────────

export function bankStatusLabel(status, lang) {
  const ar = lang === "ar";
  switch (status) {
    case "idle":     return ar ? "جاهز" : "Ready";
    case "sending":  return ar ? "إرسال إلى الجهاز..." : "Sending to terminal...";
    case "awaiting": return ar ? "بانتظار البطاقة..." : "Awaiting card...";
    case "success":  return ar ? "تمت الموافقة ✓" : "Approved ✓";
    case "error":    return ar ? "فشلت العملية ✗" : "Declined ✗";
    case "voided":   return ar ? "تم الإلغاء" : "Voided";
    default:         return status;
  }
}

export function summarizeBankFields(fields, lang) {
  if (!fields || (!fields.rrn && !fields.approval)) return "";
  const ar = lang === "ar";
  const parts = [];
  if (fields.rrn) parts.push((ar ? "مرجع: " : "RRN: ") + fields.rrn);
  if (fields.approval) parts.push((ar ? "موافقة: " : "Auth: ") + fields.approval);
  if (fields.last4) parts.push("****" + fields.last4);
  if (fields.brand) parts.push(fields.brand);
  return parts.join(" · ");
}
