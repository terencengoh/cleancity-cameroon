// CleanCity Cameroon — pure business rules shared by the demo UI and its Node tests.
// (The production rules live in Postgres, supabase/migrations; tests keep both in agreement.)
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CCLogic = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DEFAULT_SETTINGS = {
    weekly_budget_xaf: 50000, // Total paid to workers per week (all zones together)
    pay_per_person_xaf: 5000, // For a full 4-hour shift
    zones_per_week: 1, // Zones cleaned each Saturday, rotating across cities/zones
    shift_start: "07:00",
    shift_hours: 4,
    confirm_hours: 48, // Time a selected person has to confirm
    checkin_radius_m: 300, // GPS check-in must be within this distance of the meeting point
    payout_fee_pct: 1.5, // Provider withdrawal fee (CamPay lists 1.5%), shown separately
    fees_in_budget: false, // If true, crew size is reduced so pay + fees fit in the budget
    partial_round_xaf: 500, // Partial shifts are paid pro rata, rounded down to this step
  };

  // ---------- phone ----------
  /** Normalises a Cameroon mobile number to 2376XXXXXXXX, or returns null. */
  function normalizePhone(input) {
    let d = String(input || "").replace(/[^\d+]/g, "");
    if (d.startsWith("+")) d = d.slice(1);
    if (d.startsWith("00")) d = d.slice(2);
    if (d.length === 9) d = "237" + d;
    return /^2376\d{8}$/.test(d) ? d : null;
  }
  /** MTN or Orange from the number prefix (ART numbering plan), else null. */
  function detectOperator(phone) {
    const n = normalizePhone(phone);
    if (!n) return null;
    const p2 = Number(n.slice(3, 5));
    const p3 = Number(n.slice(3, 6));
    if (p2 === 67 || (p3 >= 650 && p3 <= 654) || (p3 >= 680 && p3 <= 689)) return "mtn";
    if (p2 === 69 || (p3 >= 655 && p3 <= 659)) return "orange";
    return null;
  }

  // ---------- budget ----------
  function feeFor(amount, s) { return Math.ceil((amount * (s.payout_fee_pct || 0)) / 100); }
  /** People per zone this week, never exceeding the weekly budget. */
  function crewSize(settings) {
    const s = { ...DEFAULT_SETTINGS, ...settings };
    const zones = Math.max(1, Math.floor(s.zones_per_week));
    const unit = s.pay_per_person_xaf + (s.fees_in_budget ? feeFor(s.pay_per_person_xaf, s) : 0);
    if (unit <= 0) return 0;
    return Math.max(0, Math.floor(s.weekly_budget_xaf / zones / unit));
  }
  /** Budget picture for one week given its assignments. */
  function budgetSummary(settings, assignments) {
    const s = { ...DEFAULT_SETTINGS, ...settings };
    let committed = 0, paid = 0, fees = 0;
    for (const a of assignments) {
      if (a.status === "invited" || a.status === "confirmed" || a.status === "checked_in") committed += s.pay_per_person_xaf;
      if (a.status === "signed_off") {
        committed += a.pay_xaf || 0;
        if (a.payout_status === "paid") { paid += a.pay_xaf || 0; fees += feeFor(a.pay_xaf || 0, s); }
      }
    }
    const used = committed + (s.fees_in_budget ? fees : 0);
    return { budget: s.weekly_budget_xaf, committed, paid, fees, used, remaining: s.weekly_budget_xaf - used };
  }

  // ---------- fair queue ----------
  /**
   * Fair first-come queue for a city. Eligible: consented, available on Saturdays, active, same city.
   * Order: people who never served, by sign-up time; then people who served, least recently served first
   * (serving — or a no-show — sends you to the back). Ties by sign-up time.
   */
  function queueFor(people, cityId, opts = {}) {
    const exclude = opts.exclude || new Set();
    return people
      .filter((p) => p.city_id === cityId && p.consent && p.saturdays && !p.suspended && !exclude.has(p.id))
      .sort((a, b) => {
        const la = a.last_served_at || "", lb = b.last_served_at || "";
        if (!la !== !lb) return la ? 1 : -1; // never served first
        if (la !== lb) return la < lb ? -1 : 1;
        return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
      });
  }
  /** 1-based queue position of a person in their city, or null. */
  function queuePosition(people, person, exclude) {
    const q = queueFor(people, person.city_id, { exclude });
    const i = q.findIndex((p) => p.id === person.id);
    return i < 0 ? null : i + 1;
  }

  /**
   * Fills a shift up to its crew size from the queue. Returns new assignment rows.
   * `taken` = ids already assigned anywhere this week (one shift per person per week).
   * `declined` = ids who declined/expired for this shift (not re-invited for it).
   */
  function fillShift(shift, people, existing, settings, nowIso) {
    const s = { ...DEFAULT_SETTINGS, ...settings };
    const active = existing.filter((a) => a.shift_id === shift.id && ["invited", "confirmed", "checked_in", "signed_off"].includes(a.status));
    const need = Math.max(0, (shift.crew_size ?? crewSize(s)) - active.length);
    if (!need) return [];
    const taken = new Set(existing.filter((a) => a.week === shift.week && a.status !== "declined" && a.status !== "expired").map((a) => a.person_id));
    for (const a of existing) if (a.shift_id === shift.id) taken.add(a.person_id);
    const deadline = new Date(Math.min(Date.parse(nowIso) + s.confirm_hours * 3600e3, Date.parse(shift.starts_at) - 12 * 3600e3));
    return queueFor(people, shift.city_id, { exclude: taken }).slice(0, need).map((p) => ({
      id: `as-${shift.id}-${p.id}`,
      shift_id: shift.id, week: shift.week, person_id: p.id, status: "invited",
      invited_at: nowIso, confirm_by: (deadline > new Date(nowIso) ? deadline : new Date(Date.parse(nowIso) + 3600e3)).toISOString(),
      code: checkinCode(shift.id, p.id),
    }));
  }

  /** Marks invitations past their deadline as expired. Returns ids expired. */
  function expireInvites(assignments, nowIso) {
    const out = [];
    for (const a of assignments) if (a.status === "invited" && a.confirm_by < nowIso) { a.status = "expired"; out.push(a.id); }
    return out;
  }

  // ---------- rotation ----------
  /** Next zones to clean: least recently scheduled first (never-scheduled first), round-robin across cities. */
  function nextZones(zones, n, lastScheduled) {
    const active = zones.filter((z) => z.active !== false);
    const sorted = [...active].sort((a, b) => {
      const la = lastScheduled[a.id] || "", lb = lastScheduled[b.id] || "";
      if (la !== lb) return la < lb ? -1 : 1;
      return (a.rotation ?? 0) - (b.rotation ?? 0) || (a.id < b.id ? -1 : 1);
    });
    const picked = [], cities = new Set();
    for (const z of sorted) { if (picked.length >= n) break; if (!cities.has(z.city_id)) { picked.push(z); cities.add(z.city_id); } }
    for (const z of sorted) { if (picked.length >= n) break; if (!picked.includes(z)) picked.push(z); }
    return picked;
  }
  /** ISO date (YYYY-MM-DD) of the next Saturday on or after `from` (local time). */
  function nextSaturday(from) {
    const m = typeof from === "string" && /^(\d{4})-(\d{2})-(\d{2})$/.exec(from);
    const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(from);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  // ---------- attendance + pay ----------
  function checkinCode(shiftId, personId) {
    let h = 2166136261;
    for (const c of `${shiftId}:${personId}`) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    return String((h >>> 0) % 1000000).padStart(6, "0");
  }
  function distanceM(a, b) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  /** Pay for a sign-off: full = pay, partial = pro rata hours (rounded down), absent = 0. */
  function payFor(outcome, hours, settings) {
    const s = { ...DEFAULT_SETTINGS, ...settings };
    if (outcome === "full") return s.pay_per_person_xaf;
    if (outcome === "partial") {
      const h = Math.max(0, Math.min(s.shift_hours, Number(hours) || 0));
      const step = s.partial_round_xaf || 1;
      return Math.floor((s.pay_per_person_xaf * h) / s.shift_hours / step) * step;
    }
    return 0;
  }

  return { DEFAULT_SETTINGS, normalizePhone, detectOperator, feeFor, crewSize, budgetSummary, queueFor, queuePosition, fillShift, expireInvites, nextZones, nextSaturday, checkinCode, distanceM, payFor };
});
