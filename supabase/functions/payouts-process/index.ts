// POST /functions/v1/payouts-process   (service role: pg_cron every 5 minutes; see supabase/sql/schedule_http_jobs.sql)
// 1. Claims payouts an admin approved (approved -> processing) and sends them with the payout provider.
// 2. Re-checks payouts left "processing" (pending at the provider, or an ambiguous error) and settles them.
// Payout approval itself happens in the database (approve_payout RPC, admin only, separation of duties).
import { handler, HttpError, json } from "../_shared/http.ts";
import { adminClient, isServiceRequest } from "../_shared/supabase.ts";
import { getProvider } from "../_shared/payments/index.ts";
import { type PayoutRow, refreshPayout, sendPayout } from "../_shared/transfers.ts";
import { supabasePayoutStore } from "../_shared/payout_store.ts";

Deno.serve(handler(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "POST only");
  if (!isServiceRequest(req)) throw new HttpError(403, "service role only");
  const db = adminClient();
  const provider = getProvider();
  const store = supabasePayoutStore(db);
  const { data: settings } = await db.from("settings").select("payout_fee_pct").single();
  const feePct = Number(settings?.payout_fee_pct ?? 0);

  const withNames = async (rows: PayoutRow[]): Promise<PayoutRow[]> => {
    const ids = [...new Set(rows.map((r) => r.person_id).filter((x): x is string => !!x))];
    const { data } = ids.length ? await db.from("profiles").select("id,full_name").in("id", ids) : { data: [] };
    const names = new Map<string, string>((data ?? []).map((p: { id: string; full_name: string }) => [p.id, p.full_name]));
    return rows.map((r) => ({ ...r, name: r.person_id ? names.get(r.person_id) : undefined }));
  };

  const { data: stale, error: sErr } = await db.rpc("stale_processing_payouts", { p_older_than: "2 minutes", p_limit: 50 });
  if (sErr) throw new Error(sErr.message);
  const refreshed = [];
  for (const row of await withNames((stale ?? []) as PayoutRow[])) refreshed.push(await refreshPayout(row, provider, store, feePct));

  const { data: claimed, error: cErr } = await db.rpc("claim_payouts", { p_limit: 20 });
  if (cErr) throw new Error(cErr.message);
  const sent = [];
  for (const row of await withNames((claimed ?? []) as PayoutRow[])) sent.push(await sendPayout(row, provider, store, feePct));

  return json({ provider: provider.name, sent, refreshed });
}));
