// POST|GET /functions/v1/payouts-webhook?provider=campay|notchpay
// Provider callbacks for our transfers. The adapter verifies the signature; settle_payout is idempotent,
// so duplicate or replayed callbacks change nothing. Unknown references are acknowledged and ignored.
import { handler, HttpError, json } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase.ts";
import { getProvider, WebhookVerificationError } from "../_shared/payments/index.ts";
import { processTransferCallback } from "../_shared/transfer_webhook.ts";
import { supabasePayoutStore } from "../_shared/payout_store.ts";

Deno.serve(handler(async (req) => {
  const url = new URL(req.url);
  const provider = getProvider(url.searchParams.get("provider") ?? undefined);
  const db = adminClient();
  try {
    const out = await processTransferCallback(provider, { method: req.method, url: req.url, headers: req.headers, rawBody: await req.text() }, {
      async findByReference(reference) {
        const { data } = await db.from("payout_requests").select("id,amount_xaf,status").eq("reference", reference).maybeSingle();
        return data;
      },
      settle: supabasePayoutStore(db).settle,
    }, Number((await db.from("settings").select("payout_fee_pct").single()).data?.payout_fee_pct ?? 0));
    return json(out);
  } catch (e) {
    if (e instanceof WebhookVerificationError) throw new HttpError(401, "invalid signature");
    throw e;
  }
}));
