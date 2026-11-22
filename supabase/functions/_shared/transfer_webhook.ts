// Applies a verified provider callback for one of our payouts. Pure logic (store injected) so it is unit-tested.
import type { PaymentProvider, WebhookRequest } from "./payments/types.ts";
import { feeFor, type PayoutStore } from "./transfers.ts";

export interface CallbackStore {
  findByReference(reference: string): Promise<{ id: string; amount_xaf: number; status: string } | null>;
  settle: PayoutStore["settle"];
}

export type CallbackOutcome = { result: "settled"; id: string; status: "paid" | "failed" } | { result: "ignored" | "unknown" | "already_paid" | "amount_mismatch" };

const REF_RE = /^cc-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function processTransferCallback(provider: PaymentProvider, req: WebhookRequest, store: CallbackStore, feePct: number): Promise<CallbackOutcome> {
  const event = await provider.verifyWebhook(req); // throws WebhookVerificationError if not authentic
  if (event.kind !== "transfer" || event.status === "ignored") return { result: "ignored" };
  const ref = event.reference && REF_RE.test(event.reference) ? event.reference : null;
  if (!ref) return { result: "unknown" };
  const row = await store.findByReference(ref);
  if (!row) return { result: "unknown" };
  if (row.status === "paid") return { result: "already_paid" };
  if (event.status === "successful" && event.amountXaf != null && event.amountXaf !== row.amount_xaf) {
    console.error(`payout ${row.id}: amount mismatch ${event.amountXaf} vs ${row.amount_xaf}; leaving it for review`);
    return { result: "amount_mismatch" };
  }
  const status = event.status === "successful" ? "paid" : "failed";
  await store.settle(row.id, status, provider.name, event.providerRef, status === "paid" ? feeFor(row.amount_xaf, feePct) : null,
    status === "failed" ? "provider_reported_failure" : null);
  return { result: "settled", id: row.id, status };
}
