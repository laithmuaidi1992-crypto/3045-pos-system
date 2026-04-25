// ─────────────────────────────────────────────────────────────────────────────
//  shiftAccounting.js — Single Source of Truth for Shift Reconciliation
//  3045 Super Market POS
//
//  All shift / reconciliation calculations must come through this module.
//  Two screens consume it: shiftLedger tab and admin → reconcile tab.
//
//  Accounting model:
//    Cash sales by shift   = sum of cash transactions assigned to that shift
//    Refunds by shift      = refunds whose timestamp falls within shift window
//    Cash out by shift     = expenses/purchases tagged with that shift's UNIQUE id
//    Net cash by shift     = cash sales − refunds − cash out
//    Expected total        = Σ (net cash by shift)   ≡   total cash − total refunds − total cash out
//    Difference by shift   = received from cashier − net cash by shift
//    Grand difference      = Σ received − expected total
//
//  Money equation (must always hold):
//    expected_cash = cash_sales − refunds − cash_out
//    grand_diff    = total_received − expected_cash
// ─────────────────────────────────────────────────────────────────────────────

const SHIFT_GAP_MS = 3 * 60 * 60 * 1000; // 3 hours of inactivity = new shift

// Money math safe to 3 decimal places (JOD uses 3 decimals)
const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const sum = (arr, pick) => arr.reduce((s, x) => s + (Number(pick ? pick(x) : x) || 0), 0);

/**
 * Group transactions into shift blocks.
 * A shift starts when a cashier's first txn appears, and ends after a 3-hour
 * gap or when a different cashier takes over. Each block gets a STABLE unique
 * id so cash-out entries can be tied to one specific shift, not to all shifts
 * sharing the same cashier name.
 *
 * @param {Array} txs   Transactions for the day, each with {ts, cashierName, method, tot}
 * @returns {Array}     [{ id, cashier, startTime, endTime, txs:[...] }]
 */
export function buildShiftBlocks(txs) {
  if (!Array.isArray(txs) || txs.length === 0) return [];
  const sorted = [...txs].sort((a, b) => (a.ts || "") > (b.ts || "") ? 1 : -1);
  const blocks = [];

  for (const tx of sorted) {
    const t = new Date(tx.ts).getTime();
    if (!isFinite(t)) continue;
    const last = blocks[blocks.length - 1];
    const sameUser = last && tx.cashierName === last.cashier;
    const gap = last ? (t - last.endTime) : Infinity;

    if (sameUser && gap < SHIFT_GAP_MS) {
      last.endTime = t;
      last.txs.push(tx);
    } else {
      // Stable id: cashier name + start ISO + ordinal in case of duplicates
      const cashier = tx.cashierName || "—";
      const ord = blocks.filter(b => b.cashier === cashier).length;
      blocks.push({
        id: cashier + "::" + new Date(t).toISOString() + "::" + ord,
        cashier,
        startTime: t,
        endTime: t,
        txs: [tx]
      });
    }
  }
  return blocks;
}

/**
 * Compute payment method totals for a list of transactions.
 * Returns plain numbers, not formatted strings.
 */
export function paymentTotals(txs) {
  const out = { cash: 0, card: 0, mobile: 0, ashyai: 0, total: 0, count: 0 };
  if (!Array.isArray(txs)) return out;
  for (const tx of txs) {
    const amt = Number(tx.tot) || 0;
    out.total += amt;
    out.count += 1;
    if (tx.method === "cash") out.cash += amt;
    else if (tx.method === "card") out.card += amt;
    else if (tx.method === "mobile") out.mobile += amt;
    else if (tx.method === "ashyai" || tx.method === "talabat") out.ashyai += amt;
  }
  return {
    cash: r3(out.cash),
    card: r3(out.card),
    mobile: r3(out.mobile),
    ashyai: r3(out.ashyai),
    total: r3(out.total),
    count: out.count
  };
}

/**
 * Distribute refunds onto shifts by the time the refund happened.
 * A refund whose `created_at` falls inside [startTime, endTime] of a shift
 * is charged to that shift. If no shift contains the time (e.g. refund
 * happened during a gap), it goes to the closest preceding shift.
 *
 * @param {Array} shifts  output of buildShiftBlocks
 * @param {Array} refunds [{created_at, total_refund}]
 * @returns {Map<shiftId, number>}  refund amount per shift
 */
export function distributeRefunds(shifts, refunds) {
  const map = new Map();
  shifts.forEach(s => map.set(s.id, 0));
  if (!Array.isArray(refunds) || refunds.length === 0) return map;

  // Sort shifts by start time so "preceding" lookup is correct
  const sortedShifts = [...shifts].sort((a, b) => a.startTime - b.startTime);

  for (const r of refunds) {
    const t = new Date(r.created_at).getTime();
    if (!isFinite(t)) continue;
    const amt = Number(r.total_refund) || 0;
    if (amt === 0) continue;

    // 1) try to find a shift whose window contains t
    let target = sortedShifts.find(s => t >= s.startTime && t <= s.endTime);

    // 2) otherwise: closest preceding shift, or first shift if none precedes
    if (!target) {
      const preceding = sortedShifts.filter(s => s.endTime < t);
      target = preceding.length ? preceding[preceding.length - 1] : sortedShifts[0];
    }

    if (target) map.set(target.id, (map.get(target.id) || 0) + amt);
  }

  // Round all values
  for (const [k, v] of map.entries()) map.set(k, r3(v));
  return map;
}

/**
 * Sum cash-out entries per shift. Each entry must reference the shift via
 * its unique `shift_id` field. Legacy entries with only an `employee` name
 * fall back to matching by cashier when there's exactly one shift for that
 * cashier (otherwise they remain unallocated and surface as "unassigned").
 *
 * @param {Array} shifts        output of buildShiftBlocks
 * @param {Array} cashOutItems  [{ shift_id?, employee?, amount }]
 * @returns {{ byShift: Map<shiftId, number>, unassigned: number }}
 */
export function distributeCashOut(shifts, cashOutItems) {
  const byShift = new Map();
  shifts.forEach(s => byShift.set(s.id, 0));
  let unassigned = 0;
  if (!Array.isArray(cashOutItems) || cashOutItems.length === 0) {
    return { byShift, unassigned: 0 };
  }

  // Index shifts by id for O(1) lookup
  const byId = new Map(shifts.map(s => [s.id, s]));
  // Index by cashier for legacy fallback
  const byCashier = new Map();
  shifts.forEach(s => {
    const arr = byCashier.get(s.cashier) || [];
    arr.push(s);
    byCashier.set(s.cashier, arr);
  });

  for (const item of cashOutItems) {
    const amt = Number(item.amount) || 0;
    if (amt === 0) continue;

    // 1) Preferred: explicit shift_id
    if (item.shift_id && byId.has(item.shift_id)) {
      byShift.set(item.shift_id, byShift.get(item.shift_id) + amt);
      continue;
    }

    // 2) Legacy fallback: employee name + only one shift for that name
    if (item.employee) {
      const cashierName = String(item.employee).split(" — ")[0].trim();
      const matching = byCashier.get(cashierName);
      if (matching && matching.length === 1) {
        byShift.set(matching[0].id, byShift.get(matching[0].id) + amt);
        continue;
      }
      // If multiple shifts share the cashier name, we cannot disambiguate
      // safely. Leaving these as "unassigned" surfaces the problem in the UI
      // rather than silently double-charging shifts.
    }

    unassigned += amt;
  }

  for (const [k, v] of byShift.entries()) byShift.set(k, r3(v));
  return { byShift, unassigned: r3(unassigned) };
}

/**
 * Build the full shift ledger for a given day.
 * THIS IS THE ENTRY POINT both screens should call.
 *
 * Inputs:
 *   txs           — non-voided transactions of the day
 *   refunds       — sales returns of the day
 *   cashOutItems  — items in reconData.invoices (with optional shift_id)
 *   receivedMap   — { [shift_id]: numericReceivedAmount }
 *
 * Returns a fully-resolved ledger:
 *   {
 *     shifts: [...]       — per-shift fully computed rows
 *     totals: {...}       — day-level rollup that must equal Σ shifts
 *     unassignedCashOut   — cash-out without a shift target (warning)
 *   }
 *
 * Invariants enforced:
 *   row.netCash = row.cash − row.refund − row.cashOut
 *   row.diff    = row.received − row.netCash
 *   totals.netCash    = Σ row.netCash + (− unassignedCashOut)   [if you want unassigned to reduce expected]
 *   totals.totalDiff  = totals.totalReceived − totals.netCash
 */
export function computeShiftLedger({ txs, refunds, cashOutItems, receivedMap }) {
  const shifts = buildShiftBlocks(txs || []);
  const refundByShift = distributeRefunds(shifts, refunds || []);
  const { byShift: cashOutByShift, unassigned: unassignedCashOut } = distributeCashOut(shifts, cashOutItems || []);

  const rows = shifts.map(s => {
    const pay = paymentTotals(s.txs);
    const refund = r3(refundByShift.get(s.id) || 0);
    const cashOut = r3(cashOutByShift.get(s.id) || 0);
    const netCash = r3(pay.cash - refund - cashOut);
    const received = r3(Number((receivedMap || {})[s.id]) || 0);
    const diff = r3(received - netCash);
    return {
      id: s.id,
      cashier: s.cashier,
      startTime: s.startTime,
      endTime: s.endTime,
      count: pay.count,
      cash: pay.cash,
      card: pay.card,
      mobile: pay.mobile,
      ashyai: pay.ashyai,
      grossTotal: pay.total,                 // sum of all payment methods
      refund,
      cashOut,
      netCash,                                // what the cashier should hand over
      received,
      diff,
      txs: s.txs
    };
  });

  // Day-level rollups — derived from shifts so they ALWAYS reconcile with rows
  const totalCash    = r3(sum(rows, r => r.cash));
  const totalCard    = r3(sum(rows, r => r.card));
  const totalMobile  = r3(sum(rows, r => r.mobile));
  const totalAshyai  = r3(sum(rows, r => r.ashyai));
  const totalGross   = r3(sum(rows, r => r.grossTotal));
  const totalRefund  = r3(sum(rows, r => r.refund));
  const totalCashOut = r3(sum(rows, r => r.cashOut) + unassignedCashOut);
  const totalNetCash = r3(sum(rows, r => r.netCash) - unassignedCashOut); // unassigned reduces expected
  const totalReceived= r3(sum(rows, r => r.received));
  const totalDiff    = r3(totalReceived - totalNetCash);

  return {
    shifts: rows,
    totals: {
      count:        sum(rows, r => r.count),
      cash:         totalCash,
      card:         totalCard,
      mobile:       totalMobile,
      ashyai:       totalAshyai,
      grossTotal:   totalGross,
      refund:       totalRefund,
      cashOut:      totalCashOut,
      netCash:      totalNetCash,    // = expected_cash for the day
      received:     totalReceived,
      diff:         totalDiff
    },
    unassignedCashOut
  };
}

/**
 * Convenience: tells the UI whether the day is fully reconciled.
 *   "balanced" — every shift has received entered AND grand diff is zero
 *   "unbalanced" — received entered everywhere but diff != 0
 *   "incomplete" — at least one shift has no received amount yet
 */
export function reconciliationStatus(ledger) {
  const { shifts, totals } = ledger;
  if (shifts.length === 0) return "empty";
  // A shift is considered "complete" if either:
  //   - cashier entered a received amount, OR
  //   - the shift's netCash is zero/negative (nothing to hand over)
  const allComplete = shifts.every(s => s.received > 0 || s.netCash <= 0.01);
  if (!allComplete) return "incomplete";
  return Math.abs(totals.diff) < 0.01 ? "balanced" : "unbalanced";
}

/**
 * Build a shift label like "Ahmed Alwaneh — وردية أولى" for use in dropdowns
 * and cash-out attribution. Returns just the cashier name when the cashier
 * has only a single shift on that day.
 */
export function shiftLabel(shifts, shiftId, lang = "ar") {
  const target = shifts.find(s => s.id === shiftId);
  if (!target) return "";
  const sameCashier = shifts.filter(s => s.cashier === target.cashier);
  if (sameCashier.length === 1) return target.cashier;
  const ar = ["وردية أولى", "وردية ثانية", "وردية ثالثة", "وردية رابعة", "وردية خامسة"];
  const en = ["1st Shift", "2nd Shift", "3rd Shift", "4th Shift", "5th Shift"];
  // Sort by start time and find this shift's position among same-cashier shifts
  const sorted = sameCashier.sort((a, b) => a.startTime - b.startTime);
  const idx = sorted.findIndex(s => s.id === shiftId);
  const labels = lang === "ar" ? ar : en;
  return target.cashier + " — " + (labels[idx] || ((idx + 1) + (lang === "ar" ? " وردية" : " Shift")));
}
