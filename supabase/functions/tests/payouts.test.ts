import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { CamPayProvider } from "../_shared/payments/campay.ts";
import { NotchPayProvider } from "../_shared/payments/notchpay.ts";
import { ProviderError } from "../_shared/payments/types.ts";
import { fakeFetch } from "./helpers.ts";

const REF = "cc-6f1c2a3b-4d5e-4f60-8a71-92b3c4d5e6f7";
const input = { reference: REF, amountXaf: 5000, phone: "237677777777", method: "mtn" as const, name: "Jean Mbarga", description: "Ville Propre / CleanCity - Saturday clean-up" };

Deno.test("campay payout: token, /withdraw/ body, status lookup", async () => {
  const f = fakeFetch([
    [/POST .*\/token\/$/, () => ({ body: { token: "tok", expires_in: 3600 } })],
    [/POST .*\/withdraw\/$/, () => ({ body: { reference: "cp-ref-1", status: "PENDING" } })],
    [/GET .*\/transaction\/cp-ref-1\/$/, () => ({ body: { reference: "cp-ref-1", status: "SUCCESSFUL" } })],
  ]);
  const cp = new CamPayProvider({ baseUrl: "https://demo.campay.net/api", username: "u", password: "p", webhookKey: "k" }, f.fetch);
  const res = await cp.payout(input);
  assertEquals(res.status, "pending");
  assertEquals(res.providerRef, "cp-ref-1");
  const w = f.calls.find((c) => c.url.endsWith("/withdraw/"))!;
  assertEquals(w.headers.get("Authorization"), "Token tok");
  assertEquals(JSON.parse(w.body), { amount: "5000", to: "237677777777", description: "Ville Propre / CleanCity - Saturday clean-up", external_reference: REF });
  const st = await cp.payoutStatus(REF, "cp-ref-1");
  assertEquals(st.status, "successful");
});

Deno.test("campay payout: 4xx is a definitive refusal, 5xx is not", async () => {
  const mk = (status: number) => {
    const f = fakeFetch([
      [/token/, () => ({ body: { token: "tok", expires_in: 3600 } })],
      [/withdraw/, () => ({ status, body: { message: "Insufficient balance" } })],
    ]);
    return new CamPayProvider({ baseUrl: "https://x/api", username: "u", password: "p", webhookKey: "k" }, f.fetch);
  };
  const e1 = await assertRejects(() => mk(400).payout(input), ProviderError);
  assertEquals(e1.definitive, true);
  const e2 = await assertRejects(() => mk(502).payout(input), ProviderError);
  assertEquals(e2.definitive, false);
});

Deno.test("notchpay transfer: X-Grant header, beneficiary, channel; status mapping", async () => {
  const f = fakeFetch([
    [/POST .*\/transfers$/, () => ({ status: 201, body: { transfer: { id: "trf_1", reference: REF, status: "processing" } } })],
    [/GET .*\/transfers\/cc-/, () => ({ body: { transfer: { id: "trf_1", reference: REF, status: "complete" } } })],
  ]);
  const np = new NotchPayProvider({ baseUrl: "https://api.notchpay.co", publicKey: "pk", webhookHashKey: "h", privateKey: "sk" }, f.fetch);
  const res = await np.payout({ ...input, phone: "237699999999", method: "orange" });
  assertEquals(res, { providerRef: "trf_1", status: "pending", raw: { transfer: { id: "trf_1", reference: REF, status: "processing" } } });
  const call = f.calls[0];
  assertEquals(call.headers.get("Authorization"), "pk");
  assertEquals(call.headers.get("X-Grant"), "sk");
  assertEquals(JSON.parse(call.body), {
    amount: 5000, currency: "XAF", beneficiary_data: { name: "Jean Mbarga", phone: "+237699999999" }, channel: "cm.orange",
    description: "Ville Propre / CleanCity - Saturday clean-up", reference: REF,
  });
  assertEquals((await np.payoutStatus(REF, null)).status, "successful");
});

Deno.test("notchpay transfer without private key is refused before any call", async () => {
  const f = fakeFetch([]);
  const np = new NotchPayProvider({ baseUrl: "https://api.notchpay.co", publicKey: "pk", webhookHashKey: "h" }, f.fetch);
  const e = await assertRejects(() => np.payout(input), ProviderError);
  assertEquals(e.definitive, true);
  assertEquals(f.calls.length, 0);
});
