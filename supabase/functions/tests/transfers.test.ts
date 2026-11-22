import { assertEquals } from "jsr:@std/assert@1";
import { signHs256Jwt, hmacSha256Hex } from "../_shared/crypto.ts";
import { CamPayProvider } from "../_shared/payments/campay.ts";
import { NotchPayProvider } from "../_shared/payments/notchpay.ts";
import { feeFor, type PayoutRow, type PayoutStore, refreshPayout, sendPayout, type SettleStatus } from "../_shared/transfers.ts";
import { processTransferCallback } from "../_shared/transfer_webhook.ts";
import { fakeFetch } from "./helpers.ts";

const ID = "11111111-2222-4333-8444-555555555555";
const REF = "cc-6f1c2a3b-4d5e-4f60-8a71-92b3c4d5e6f7";
const row: PayoutRow = { id: ID, reference: REF, amount_xaf: 5000, phone: "237677777777", operator: "mtn", provider_ref: null, name: "Awa N." };

function memory() {
  const settled: { id: string; status: SettleStatus; ref: string | null; fee: number | null; reason: string | null }[] = [];
  const store: PayoutStore = { settle: (id, status, _p, ref, fee, reason) => (settled.push({ id, status, ref, fee, reason }), Promise.resolve()) };
  return { store, settled };
}
const campay = (routes: Parameters<typeof fakeFetch>[0]) =>
  new CamPayProvider({ baseUrl: "https://demo.campay.net/api", username: "u", password: "p", webhookKey: "whk" }, fakeFetch([
    [/token/, () => ({ body: { token: "tok", expires_in: 3600 } })], ...routes]).fetch);

Deno.test("fee: 1.5% of 5,000 FCFA is 75 FCFA", () => {
  assertEquals(feeFor(5000, 1.5), 75);
  assertEquals(feeFor(2500, 1.5), 38);
  assertEquals(feeFor(5000, 0), 0);
});

Deno.test("sendPayout: pending at provider stays processing with the provider ref", async () => {
  const { store, settled } = memory();
  const out = await sendPayout(row, campay([[/withdraw/, () => ({ body: { reference: "cp-1", status: "PENDING" } })]]), store, 1.5);
  assertEquals(out.status, "processing");
  assertEquals(settled, [{ id: ID, status: "processing", ref: "cp-1", fee: null, reason: null }]);
});

Deno.test("sendPayout: definitive 4xx refusal marks failed; 5xx/timeout leaves it untouched (no double payment)", async () => {
  const a = memory();
  const out = await sendPayout(row, campay([[/withdraw/, () => ({ status: 400, body: { message: "Insufficient balance" } })]]), a.store, 1.5);
  assertEquals(out.status, "failed");
  assertEquals(a.settled[0].status, "failed");
  const b = memory();
  const out2 = await sendPayout(row, campay([[/withdraw/, () => ({ status: 502, body: {} })]]), b.store, 1.5);
  assertEquals(out2.status, "unknown");
  assertEquals(b.settled.length, 0);
});

Deno.test("refreshPayout: successful status settles paid with the fee", async () => {
  const { store, settled } = memory();
  const out = await refreshPayout({ ...row, provider_ref: "cp-1" }, campay([[/transaction\/cp-1/, () => ({ body: { reference: "cp-1", status: "SUCCESSFUL" } })]]), store, 1.5);
  assertEquals(out.status, "paid");
  assertEquals(settled, [{ id: ID, status: "paid", ref: "cp-1", fee: 75, reason: null }]);
});

Deno.test("callback: CamPay signed withdrawal callback settles our cc- payout; unknown and mismatched amounts are not paid", async () => {
  const cp = new CamPayProvider({ baseUrl: "https://demo.campay.net/api", username: "u", password: "p", webhookKey: "whk" });
  const req = async (params: Record<string, string>) => {
    const qs = new URLSearchParams({ ...params, signature: await signHs256Jwt({ iat: Math.floor(Date.now() / 1000) }, "whk") });
    return { method: "GET", url: `https://x/payouts-webhook?provider=campay&${qs}`, headers: new Headers(), rawBody: "" };
  };
  const rows = new Map([[REF, { id: ID, amount_xaf: 5000, status: "processing" }]]);
  const { store, settled } = memory();
  const cb = { findByReference: (r: string) => Promise.resolve(rows.get(r) ?? null), settle: store.settle };
  const ok = await processTransferCallback(cp, await req({ status: "SUCCESSFUL", reference: "cp-9", amount: "5000", external_reference: REF }), cb, 1.5);
  assertEquals(ok, { result: "settled", id: ID, status: "paid" });
  assertEquals(settled[0], { id: ID, status: "paid", ref: "cp-9", fee: 75, reason: null });
  const other = await processTransferCallback(cp, await req({ status: "SUCCESSFUL", reference: "cp-x", amount: "5000", external_reference: "cc-00000000-0000-4000-8000-000000000000" }), cb, 1.5);
  assertEquals(other.result, "unknown");
  const bad = await processTransferCallback(cp, await req({ status: "SUCCESSFUL", reference: "cp-9", amount: "50000", external_reference: REF }), cb, 1.5);
  assertEquals(bad.result, "amount_mismatch");
  assertEquals(settled.length, 1);
});

Deno.test("callback: Notch Pay transfer.failed with a valid signature marks failed; tampered body rejected", async () => {
  const np = new NotchPayProvider({ baseUrl: "https://api.notchpay.co", publicKey: "pk", webhookHashKey: "hk" });
  const raw = JSON.stringify({ id: "evt_7", type: "transfer.failed", data: { reference: REF, id: "trf_7", amount: 5000 } });
  const sig = await hmacSha256Hex("hk", raw);
  const { store, settled } = memory();
  const cb = { findByReference: () => Promise.resolve({ id: ID, amount_xaf: 5000, status: "processing" }), settle: store.settle };
  const out = await processTransferCallback(np, { method: "POST", url: "https://x", headers: new Headers({ "x-notch-signature": sig }), rawBody: raw }, cb, 1.5);
  assertEquals(out, { result: "settled", id: ID, status: "failed" });
  assertEquals(settled[0].reason, "provider_reported_failure");
  let rejected = false;
  try {
    await processTransferCallback(np, { method: "POST", url: "https://x", headers: new Headers({ "x-notch-signature": sig }), rawBody: raw.replace("5000", "500") }, cb, 1.5);
  } catch { rejected = true; }
  assertEquals(rejected, true);
});
