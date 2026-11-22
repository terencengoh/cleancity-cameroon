import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const L = createRequire(import.meta.url)("../logic.js");
const S = L.DEFAULT_SETTINGS;

const mk = (i, extra = {}) => ({ id: `p${i}`, name: `P${i}`, city_id: "douala", consent: true, saturdays: true,
  created_at: `2026-11-01T00:00:${String(i).padStart(2, "0")}.000Z`, last_served_at: null, ...extra });
const shift = { id: "s1", week: "2026-11-28", zone_id: "dla-akwa", city_id: "douala", starts_at: "2026-11-28T06:00:00.000Z", crew_size: 10 };

test("defaults: 50,000 FCFA weekly budget, 5,000 FCFA pay, 1 zone → crew of 10", () => {
  assert.equal(S.weekly_budget_xaf, 50000);
  assert.equal(S.pay_per_person_xaf, 5000);
  assert.equal(S.zones_per_week, 1);
  assert.equal(L.crewSize(S), 10);
});
test("crew is configurable and never exceeds the budget", () => {
  assert.equal(L.crewSize({ ...S, pay_per_person_xaf: 2500 }), 20);
  assert.equal(L.crewSize({ ...S, zones_per_week: 2 }), 5);
  assert.equal(L.crewSize({ ...S, fees_in_budget: true }), 9); // 5,000 + 75 fee
  assert.equal(L.crewSize({ ...S, weekly_budget_xaf: 4999 }), 0);
});
test("phone normalisation and operator detection", () => {
  assert.equal(L.normalizePhone("+237 677 12 34 56"), "237677123456");
  assert.equal(L.normalizePhone("699123456"), "237699123456");
  assert.equal(L.normalizePhone("12345"), null);
  assert.equal(L.detectOperator("677123456"), "mtn");
  assert.equal(L.detectOperator("652123456"), "mtn");
  assert.equal(L.detectOperator("681123456"), "mtn");
  assert.equal(L.detectOperator("699123456"), "orange");
  assert.equal(L.detectOperator("656123456"), "orange");
  assert.equal(L.detectOperator("620123456"), null);
});
test("queue: first come, recently served go to the back, ineligible excluded", () => {
  const people = [mk(1, { last_served_at: "2026-11-21T10:00:00Z" }), mk(2), mk(3), mk(4, { consent: false }), mk(5, { city_id: "yaounde" }), mk(6, { saturdays: false }), mk(7, { last_served_at: "2026-11-14T10:00:00Z" })];
  assert.deepEqual(L.queueFor(people, "douala").map((p) => p.id), ["p2", "p3", "p7", "p1"]);
  assert.equal(L.queuePosition(people, people[0]), 4);
  assert.equal(L.queuePosition(people, people[3]), null);
});
test("fillShift invites up to the crew size in queue order with a deadline before the shift", () => {
  const people = Array.from({ length: 14 }, (_, i) => mk(i + 1));
  const rows = L.fillShift(shift, people, [], S, "2026-11-22T08:00:00.000Z");
  assert.equal(rows.length, 10);
  assert.deepEqual(rows.map((r) => r.person_id), people.slice(0, 10).map((p) => p.id));
  assert.equal(rows[0].confirm_by, "2026-11-24T08:00:00.000Z"); // 48 h
  assert.match(rows[0].code, /^\d{6}$/);
  // late selection: deadline capped 12 h before start
  const late = L.fillShift(shift, people, [], S, "2026-11-27T08:00:00.000Z");
  assert.equal(late[0].confirm_by, "2026-11-27T18:00:00.000Z");
});
test("declines/expiries are replaced by the next in line and never re-invited to that shift", () => {
  const people = Array.from({ length: 14 }, (_, i) => mk(i + 1));
  const rows = L.fillShift(shift, people, [], S, "2026-11-22T08:00:00.000Z");
  rows[0].status = "declined";
  rows[1].confirm_by = "2026-11-22T09:00:00.000Z";
  assert.deepEqual(L.expireInvites(rows, "2026-11-22T10:00:00.000Z"), [rows[1].id]);
  const more = L.fillShift(shift, people, rows, S, "2026-11-22T10:00:00.000Z");
  assert.deepEqual(more.map((r) => r.person_id), ["p11", "p12"]);
});
test("one shift per person per week", () => {
  const people = Array.from({ length: 12 }, (_, i) => mk(i + 1));
  const first = L.fillShift(shift, people, [], S, "2026-11-22T08:00:00.000Z");
  const other = L.fillShift({ ...shift, id: "s2" }, people, first, S, "2026-11-22T08:00:00.000Z");
  assert.deepEqual(other.map((r) => r.person_id), ["p11", "p12"]);
});
test("budget summary: committed, paid, fees, remaining", () => {
  const as = [
    { status: "confirmed" }, { status: "invited" }, { status: "declined" },
    { status: "signed_off", pay_xaf: 5000, payout_status: "paid" }, { status: "signed_off", pay_xaf: 2500, payout_status: "awaiting" }, { status: "signed_off", pay_xaf: 0, payout_status: "none" },
  ];
  const b = L.budgetSummary(S, as);
  assert.deepEqual(b, { budget: 50000, committed: 17500, paid: 5000, fees: 75, used: 17500, remaining: 32500 });
  assert.equal(L.budgetSummary({ ...S, fees_in_budget: true }, as).remaining, 32425);
  const full = Array.from({ length: 10 }, () => ({ status: "confirmed" }));
  assert.equal(L.budgetSummary(S, full).remaining, 0);
});
test("pay: full, partial rounded down to 500, absent", () => {
  assert.equal(L.payFor("full", 4, S), 5000);
  assert.equal(L.payFor("partial", 2, S), 2500);
  assert.equal(L.payFor("partial", 3.5, S), 4000); // 4375 → 4000
  assert.equal(L.payFor("partial", 9, S), 5000);
  assert.equal(L.payFor("absent", 4, S), 0);
});
test("zone rotation spreads across cities and prefers least recently cleaned", () => {
  const zones = [{ id: "a", city_id: "douala", rotation: 1 }, { id: "b", city_id: "yaounde", rotation: 2 }, { id: "c", city_id: "douala", rotation: 3 }, { id: "d", city_id: "buea", rotation: 4, active: false }];
  assert.deepEqual(L.nextZones(zones, 1, {}).map((z) => z.id), ["a"]);
  assert.deepEqual(L.nextZones(zones, 1, { a: "2026-11-21" }).map((z) => z.id), ["b"]);
  assert.deepEqual(L.nextZones(zones, 2, {}).map((z) => z.id), ["a", "b"]);
  assert.deepEqual(L.nextZones(zones, 1, { a: "2026-11-21", b: "2026-11-28" }).map((z) => z.id), ["c"]);
});
test("dates, codes and distance", () => {
  assert.equal(L.nextSaturday("2026-11-22"), "2026-11-28");
  assert.equal(L.nextSaturday("2026-11-28"), "2026-11-28");
  assert.equal(L.checkinCode("s1", "p1"), L.checkinCode("s1", "p1"));
  assert.notEqual(L.checkinCode("s1", "p1"), L.checkinCode("s1", "p2"));
  const d = L.distanceM({ lat: 4.05, lng: 9.7 }, { lat: 4.0527, lng: 9.7 });
  assert.ok(d > 290 && d < 310, String(d));
});
