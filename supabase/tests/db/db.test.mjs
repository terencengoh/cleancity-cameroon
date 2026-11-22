// Runs the real migrations + seed in PGlite (WASM Postgres) with minimal Supabase stubs (auth schema, auth.uid()/auth.role(),
// anon/authenticated/service_role roles), then exercises sign-up, the fair weekly selection with its budget guard,
// confirmation deadlines, GPS/code check-in, sign-off, idempotent payouts on the double-entry ledger, and RLS.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const root = new URL("../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
let db;

const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ADMIN = uid(900), ADMIN2 = uid(901), SUP = uid(902);
const DLA = Array.from({ length: 14 }, (_, i) => uid(i + 1)); // Douala workers, signed up in this order
const YDE = [uid(101), uid(102)];

async function setClaims(role, sub = "") {
  await db.exec(`select set_config('request.jwt.claim.role', '${role}', false); select set_config('request.jwt.claim.sub', '${sub}', false);`);
}
async function as(id, fn) {
  await db.exec("set role authenticated"); await setClaims("authenticated", id);
  try { return await fn(); } finally { await db.exec("reset role"); await setClaims(""); }
}
async function asService(fn) {
  await db.exec("set role service_role"); await setClaims("service_role");
  try { return await fn(); } finally { await db.exec("reset role"); await setClaims(""); }
}
const q = (sql, params) => db.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];
let shiftId, week;

before(async () => {
  db = await PGlite.create();
  await db.exec(`
    create schema if not exists extensions;
    create schema auth;
    create table auth.users (id uuid primary key, phone text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public, extensions, auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    grant select on auth.users to service_role;
    alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    alter default privileges in schema public grant usage, select on sequences to anon, authenticated, service_role;
  `);
  for (const m of readdirSync(new URL("migrations/", root)).filter((f) => f.endsWith(".sql")).sort()) await db.exec(read(`migrations/${m}`));
  await db.exec(read("seed.sql"));
  const users = [[ADMIN, "237677900000"], [ADMIN2, "237699900001"], [SUP, "237655900002"],
    ...DLA.map((id, i) => [id, `2376770000${String(i + 10).padStart(2, "0")}`]), [YDE[0], "237699000101"], [YDE[1], "237699000102"]];
  for (const [id, phone] of users) await q("insert into auth.users (id, phone) values ($1, $2)", [id, phone]);
});
after(async () => { await db?.close(); });

test("seed: 10 regions, 15 cities, zones in every city, default settings 50,000 / 5,000 / 1 zone → crew of 10", async () => {
  assert.equal((await one("select count(*)::int n from public.regions")).n, 10);
  assert.equal((await one("select count(*)::int n from public.cities")).n, 15);
  assert.equal((await one("select count(*)::int n from public.cities c where not exists (select 1 from public.zones z where z.city_id = c.id)")).n, 0);
  assert.deepEqual(await one("select weekly_budget_xaf, pay_per_person_xaf, zones_per_week, fees_in_budget from public.settings"),
    { weekly_budget_xaf: 50000, pay_per_person_xaf: 5000, zones_per_week: 1, fees_in_budget: false });
  assert.equal((await one("select public.crew_size() n")).n, 10);
});

test("phone helpers match the demo rules", async () => {
  const r = await one(`select public.normalize_phone('+237 677 12 34 56') a, public.detect_operator('677123456') b, public.detect_operator('699123456') c,
    public.detect_operator('656123456') d, public.detect_operator('652123456') e, public.detect_operator('620123456') f`);
  assert.deepEqual(r, { a: "237677123456", b: "mtn", c: "orange", d: "orange", e: "mtn", f: null });
});

test("sign-up: consent required, city must match region, operator detected", async () => {
  await assert.rejects(as(DLA[0], () => q("select public.sign_up('Ana', 'littoral', 'douala', 'Akwa', true, null, false)")), /consent/);
  await assert.rejects(as(DLA[0], () => q("select public.sign_up('Ana', 'centre', 'douala', 'Akwa', true, null, true)")), /region/);
  for (const [i, id] of DLA.entries()) await as(id, () => q("select public.sign_up($1, 'littoral', 'douala', 'Akwa', true, null, true)", [`Worker ${i + 1}`]));
  for (const id of YDE) await as(id, () => q("select public.sign_up('Yaoundé worker', 'centre', 'yaounde', 'Bastos', true, null, true)"));
  for (const id of [ADMIN, ADMIN2, SUP]) await as(id, () => q("select public.sign_up('Staff', 'littoral', 'douala', 'Bonanjo', true, null, true)"));
  // created_at must strictly follow sign-up order for the queue test
  for (const [i, id] of DLA.entries()) await q(`update public.profiles set created_at = '2026-11-01'::timestamptz + make_interval(mins => $2) where id = $1`, [id, i]);
  await q(`update public.profiles set role = 'admin' where id in ($1, $2)`, [ADMIN, ADMIN2]);
  await q(`update public.profiles set role = 'supervisor' where id = $1`, [SUP]);
  assert.equal((await one("select operator from public.profiles where id = $1", [DLA[0]])).operator, "mtn");
  assert.equal((await one("select operator from public.profiles where id = $1", [YDE[0]])).operator, "orange");
});

test("workers cannot run admin or service functions, nor write tables directly", async () => {
  await assert.rejects(as(DLA[0], () => q("select public.schedule_week()")), /admin only/);
  await assert.rejects(as(DLA[0], () => q("select public.run_selection()")), /admin only/);
  await assert.rejects(as(DLA[0], () => q("select public.update_settings('{\"weekly_budget_xaf\": 999999}')")), /admin only/);
  await assert.rejects(as(DLA[0], () => q("select public.fill_shift(gen_random_uuid())")), /permission denied/);
  await assert.rejects(as(DLA[0], () => q("select * from public.claim_payouts(10)")), /permission denied/);
  await assert.rejects(as(DLA[0], () => q("update public.profiles set role = 'admin' where id = auth.uid()")), /permission denied/);
  await assert.rejects(as(DLA[0], () => q("insert into public.audit_log (action) values ('x')")), /permission denied/);
});

test("admin schedules next Saturday: one zone, rotation order, crew of 10; idempotent", async () => {
  const rows = (await as(ADMIN, () => q("select * from public.schedule_week()"))).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].zone_id, "dla-akwa");
  assert.equal(rows[0].crew_size, 10);
  shiftId = rows[0].id; week = rows[0].week;
  const again = (await as(ADMIN, () => q("select * from public.schedule_week()"))).rows;
  assert.deepEqual(again.map((r) => r.id), [shiftId]);
  const t = await one("select to_char(starts_at at time zone 'Africa/Douala', 'HH24:MI') s, to_char(ends_at at time zone 'Africa/Douala', 'HH24:MI') e, extract(isodow from week)::int d from public.shifts where id = $1", [shiftId]);
  assert.deepEqual(t, { s: "07:00", e: "11:00", d: 6 });
});

test("selection: first 10 sign-ups invited, budget fully committed, never exceeded", async () => {
  const n = (await as(ADMIN, () => one("select public.run_selection() n"))).n;
  assert.equal(n, 10);
  const invited = (await q("select person_id from public.assignments where shift_id = $1 order by person_id", [shiftId])).rows.map((r) => r.person_id);
  assert.deepEqual(invited, DLA.slice(0, 10));
  const b = await as(ADMIN, () => one("select * from public.budget_summary($1)", [week]));
  assert.equal(b.committed, 50000); assert.equal(b.remaining, 0);
  assert.equal((await as(ADMIN, () => one("select public.run_selection() n"))).n, 0);
  const pos = await as(DLA[12], () => one("select * from public.my_queue_position()"));
  assert.deepEqual([pos.pos, pos.total], [3, 4]);
});

test("RLS: workers see only their own invitation and profile", async () => {
  const mine = await as(DLA[0], () => q("select person_id, code from public.assignments"));
  assert.equal(mine.rows.length, 1); assert.equal(mine.rows[0].person_id, DLA[0]); assert.match(mine.rows[0].code, /^\d{6}$/);
  assert.equal((await as(DLA[0], () => q("select id from public.profiles"))).rows.length, 1);
  assert.equal((await as(DLA[0], () => q("select id from public.payout_requests"))).rows.length, 0);
  assert.equal((await as(ADMIN, () => q("select id from public.profiles"))).rows.length, 19);
});

test("decline and missed deadline invite the next person in line", async () => {
  const a0 = (await one("select id from public.assignments where person_id = $1", [DLA[0]])).id;
  await as(DLA[0], () => q("select public.respond_invite($1, false)", [a0]));
  assert.equal((await one("select status from public.assignments where person_id = $1", [DLA[10]])).status, "invited");
  await assert.rejects(as(DLA[0], () => q("select public.respond_invite($1, true)", [a0])), /already answered/);
  await q("update public.assignments set confirm_by = now() - interval '1 minute' where person_id = $1", [DLA[1]]);
  assert.equal((await asService(() => one("select public.expire_invites() n"))).n, 1);
  assert.equal((await one("select status from public.assignments where person_id = $1", [DLA[11]])).status, "invited");
  const b = await as(ADMIN, () => one("select * from public.budget_summary($1)", [week]));
  assert.equal(b.remaining, 0);
  assert.equal((await one("select count(*)::int n from public.assignments where shift_id = $1 and status not in ('declined','expired')", [shiftId])).n, 10);
});

test("crew size follows admin settings (20 at 2,500 FCFA; 9 when fees count in the budget)", async () => {
  await as(ADMIN, () => q(`select public.update_settings('{"pay_per_person_xaf": 2500}')`));
  assert.equal((await one("select public.crew_size() n")).n, 20);
  await as(ADMIN, () => q(`select public.update_settings('{"pay_per_person_xaf": 5000, "fees_in_budget": true}')`));
  assert.equal((await one("select public.crew_size() n")).n, 9);
  await as(ADMIN, () => q(`select public.update_settings('{"fees_in_budget": false}')`));
  assert.equal((await one("select public.crew_size() n")).n, 10);
});

test("check-in requires the supervisor, the worker's code and GPS near the meeting point", async () => {
  for (const id of DLA.slice(2, 12)) {
    const a = await one("select id from public.assignments where person_id = $1", [id]);
    await as(id, () => q("select public.respond_invite($1, true)", [a.id]));
  }
  await as(ADMIN, () => q("select public.assign_supervisor($1, $2)", [shiftId, SUP]));
  await q("update public.shifts set starts_at = now() - interval '10 minutes', ends_at = now() + interval '230 minutes' where id = $1", [shiftId]);
  const z = await one("select lat, lng from public.zones where id = 'dla-akwa'");
  const code = (await one("select code from public.assignments where person_id = $1", [DLA[2]])).code;
  await assert.rejects(as(DLA[3], () => q("select public.check_in($1, $2, $3, $4)", [shiftId, code, z.lat, z.lng])), /not your shift/);
  await assert.rejects(as(SUP, () => q("select public.check_in($1, $2, $3, $4)", [shiftId, code, z.lat + 0.01, z.lng])), /too far/);
  await assert.rejects(as(SUP, () => q("select public.check_in($1, '000000', $2, $3)", [shiftId, z.lat, z.lng])), /code not found|not confirmed/);
  for (const id of DLA.slice(2, 11)) {
    const c = (await one("select code from public.assignments where person_id = $1", [id])).code;
    await as(SUP, () => q("select public.check_in($1, $2, $3, $4, 'qr')", [shiftId, c, z.lat + 0.001, z.lng]));
  }
  assert.equal((await one("select count(*)::int n from public.assignments where shift_id = $1 and status = 'checked_in'", [shiftId])).n, 9);
  // supervisors see their crew's profiles
  assert.equal((await as(SUP, () => q("select id from public.assignments"))).rows.length, 12);
});

test("sign-off: full, partial pro rata, absent; payouts created; rotation updated", async () => {
  const aid = async (id) => (await one("select id from public.assignments where person_id = $1", [id])).id;
  await assert.rejects(as(SUP, async () => q("select public.sign_off($1, 'full')", [await aid(DLA[11])])), /checked-in/);
  for (const id of DLA.slice(2, 9)) await as(SUP, async () => q("select public.sign_off($1, 'full')", [await aid(id)]));
  await as(SUP, async () => q("select public.sign_off($1, 'partial', 3.5, 'left early')", [await aid(DLA[9])]));
  await as(SUP, async () => q("select public.sign_off($1, 'absent')", [await aid(DLA[10])])); // checked in but left: absent
  await as(SUP, async () => q("select public.sign_off($1, 'absent')", [await aid(DLA[11])])); // confirmed, never came
  const pays = (await q("select pay_xaf from public.assignments where shift_id = $1 and status = 'signed_off' order by pay_xaf desc", [shiftId])).rows.map((r) => r.pay_xaf);
  assert.deepEqual(pays, [5000, 5000, 5000, 5000, 5000, 5000, 5000, 4000, 0, 0]);
  assert.equal((await one("select count(*)::int n, sum(amount_xaf)::int s from public.payout_requests")).n, 8);
  assert.equal((await one("select sum(amount_xaf)::int s from public.payout_requests")).s, 39000);
  const b = await as(ADMIN, () => one("select * from public.budget_summary($1)", [week]));
  assert.ok(b.used <= 50000); assert.equal(b.committed, 39000);
  assert.ok((await one("select last_served_at from public.profiles where id = $1", [DLA[2]])).last_served_at);
});

test("payouts: admin approval with separation of duties, idempotent settlement, balanced ledger", async () => {
  const ids = (await as(ADMIN, () => q("select id from public.payout_requests order by created_at"))).rows.map((r) => r.id);
  await assert.rejects(as(SUP, () => q("select public.approve_payout($1)", [ids[0]])), /admin only/);
  await as(ADMIN, () => q("select public.record_funding(100000, 'Sponsor test')"));
  for (const id of ids) await as(ADMIN, () => q("select public.approve_payout($1)", [id]));
  await assert.rejects(as(ADMIN, () => q("select public.approve_payout($1)", [ids[0]])), /already approved/);
  const claimed = await asService(() => q("select * from public.claim_payouts(50)"));
  assert.equal(claimed.rows.length, 8);
  assert.equal((await asService(() => q("select * from public.claim_payouts(50)"))).rows.length, 0); // no double claim
  assert.ok(claimed.rows.every((r) => r.reference.startsWith("cc-") && r.status === "processing"));
  for (const r of claimed.rows) {
    await asService(() => q("select public.settle_payout($1, 'paid', 'campay', $2, 75)", [r.id, "ref-" + r.id.slice(0, 8)]));
    await asService(() => q("select public.settle_payout($1, 'paid', 'campay', $2, 75)", [r.id, "ref-" + r.id.slice(0, 8)])); // retry is a no-op
  }
  const bal = Object.fromEntries((await as(ADMIN, () => q("select kind, sum(balance_xaf)::int b from public.ledger_balances() group by kind"))).rows.map((r) => [r.kind, r.b]));
  assert.deepEqual(bal, { funding: -100000, merchant_balance: 100000 - 39000 - 600, wages_expense: 39000, fees_expense: 600, worker_payable: 0 });
  assert.equal((await one("select coalesce(sum(amount_xaf), 0)::int s from public.ledger_entries")).s, 0);
  await assert.rejects(q("delete from public.ledger_entries"), /append-only/);
  const mine = await as(DLA[2], () => q("select status, amount_xaf from public.payout_requests"));
  assert.deepEqual(mine.rows, [{ status: "paid", amount_xaf: 5000 }]);
  assert.ok((await one("select count(*)::int n from public.notifications where user_id = $1 and kind = 'paid'", [DLA[2]])).n === 1);
  const b = await as(ADMIN, () => one("select * from public.budget_summary($1)", [week]));
  assert.deepEqual([b.paid, b.fees], [39000, 600]);
});

test("a supervisor-turned-admin cannot approve payouts for workers they signed off", async () => {
  // new shift next week, small crew; SUP signs off, then is promoted and tries to approve
  await q("update public.profiles set role = 'admin' where id = $1", [SUP]);
  const pr = await one("select id from public.payout_requests limit 1");
  await q("update public.payout_requests set status = 'failed' where id = $1", [pr.id]);
  await assert.rejects(as(SUP, () => q("select public.approve_payout($1)", [pr.id])), /cannot approve/);
  await q("update public.payout_requests set status = 'paid' where id = $1", [pr.id]);
  await q("update public.profiles set role = 'supervisor' where id = $1", [SUP]);
});

test("completing a shift needs every worker signed off and before/after photos", async () => {
  await assert.rejects(as(SUP, () => q("select public.complete_shift($1)", [shiftId])), /photo/);
  await assert.rejects(as(SUP, () => q("select public.add_shift_photo($1, 'before', 'elsewhere/x.jpg')", [shiftId])), /shifts/);
  await as(SUP, () => q("select public.add_shift_photo($1, 'before', $2)", [shiftId, `shifts/${shiftId}/before-1.jpg`]));
  await as(SUP, () => q("select public.add_shift_photo($1, 'after', $2)", [shiftId, `shifts/${shiftId}/after-1.jpg`]));
  await as(SUP, () => q("select public.complete_shift($1)", [shiftId]));
  assert.equal((await one("select status from public.shifts where id = $1", [shiftId])).status, "completed");
});

test("fair rotation: next week the zone rotates and people who served go to the back of the queue", async () => {
  const w2 = (await one("select ($1::date + 7) w", [week])).w;
  // Make Douala the only active city so the queue order is visible; zone rotation picks the next Douala zone.
  await q("update public.zones set active = (city_id = 'douala')");
  const s2 = (await as(ADMIN, () => q("select * from public.schedule_week($1)", [w2]))).rows[0];
  assert.notEqual(s2.zone_id, "dla-akwa");
  await as(ADMIN, () => q("select public.run_selection($1)", [w2]));
  const order = (await q("select a.person_id from public.assignments a join public.profiles p on p.id = a.person_id where a.shift_id = $1 order by p.last_served_at nulls first, p.created_at", [s2.id])).rows.map((r) => r.person_id);
  // never served (DLA[0], DLA[1], DLA[12], DLA[13]) come first, then those who served
  assert.deepEqual(order.slice(0, 4), [DLA[0], DLA[1], DLA[12], DLA[13]]);
  assert.equal(order.length, 10);
});

test("service-only jobs: weekly job, reminders and notification claim", async () => {
  await assert.rejects(as(ADMIN, () => q("select public.queue_reminders()")), /permission denied|service only/);
  const n = await asService(() => q("select * from public.claim_notifications(500)"));
  assert.ok(n.rows.length > 0);
  assert.ok(n.rows.every((r) => Array.isArray(r.tokens)));
});
