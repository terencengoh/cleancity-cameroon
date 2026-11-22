// Sends approved worker payouts and refreshes their status. State lives in Postgres (payout_requests);
// the SQL function settle_payout owns the ledger postings and is idempotent.
//   approved --claim_payouts--> processing --settle_payout--> paid | failed
// Only a definitive provider refusal (clear 4xx: nothing was sent) marks a payout failed. Anything ambiguous
// (timeout, 5xx) leaves it "processing"; the next run re-reads the status with the same idempotent reference
// instead of sending again, so a worker is never paid twice.
import { type PaymentProvider, ProviderError } from "./payments/types.ts";

export interface PayoutRow {
  id: string;
  reference: string; // "cc-<assignment uuid>", stable across retries
  amount_xaf: number;
  phone: string;
  operator: "mtn" | "orange";
  provider_ref: string | null;
  person_id?: string;
  name?: string;
}

export type SettleStatus = "paid" | "failed" | "processing";

export interface PayoutStore {
  settle(id: string, status: SettleStatus, provider: string, providerRef: string | null, feeXaf: number | null, reason: string | null): Promise<void>;
}

export interface PayoutOutcome {
  id: string;
  status: SettleStatus | "unknown";
  providerRef: string | null;
  reason?: string;
}

const toSettle = (s: "pending" | "successful" | "failed"): SettleStatus => (s === "successful" ? "paid" : s === "failed" ? "failed" : "processing");

/** Fee charged by the provider, if known (CamPay lists 1.5% per withdrawal: https://www.campay.net/fr/). */
export function feeFor(amountXaf: number, pct: number): number {
  return Math.ceil((amountXaf * pct) / 100);
}

export async function sendPayout(row: PayoutRow, provider: PaymentProvider, store: PayoutStore, feePct: number): Promise<PayoutOutcome> {
  try {
    const res = await provider.payout({
      reference: row.reference,
      amountXaf: row.amount_xaf,
      phone: row.phone,
      method: row.operator,
      name: row.name ?? "CleanCity worker",
      description: "Ville Propre / CleanCity - Saturday clean-up",
    });
    const status = toSettle(res.status);
    await store.settle(row.id, status, provider.name, res.providerRef, status === "paid" ? feeFor(row.amount_xaf, feePct) : null, res.failureReason ?? null);
    return { id: row.id, status, providerRef: res.providerRef, reason: res.failureReason };
  } catch (e) {
    if (e instanceof ProviderError && e.definitive) {
      await store.settle(row.id, "failed", provider.name, null, null, e.message.slice(0, 200));
      return { id: row.id, status: "failed", providerRef: null, reason: e.message };
    }
    console.error(`payout ${row.id} outcome unknown`, e instanceof ProviderError ? e.details : e);
    return { id: row.id, status: "unknown", providerRef: null, reason: "provider outcome unknown; will re-check the status" };
  }
}

export async function refreshPayout(row: PayoutRow, provider: PaymentProvider, store: PayoutStore, feePct: number): Promise<PayoutOutcome> {
  try {
    const res = await provider.payoutStatus(row.reference, row.provider_ref);
    const status = toSettle(res.status);
    const ref = res.providerRef ?? row.provider_ref;
    await store.settle(row.id, status, provider.name, ref, status === "paid" ? feeFor(row.amount_xaf, feePct) : null, res.failureReason ?? null);
    return { id: row.id, status, providerRef: ref, reason: res.failureReason };
  } catch (e) {
    console.error(`payout ${row.id} status check failed`, e instanceof ProviderError ? e.details : e);
    return { id: row.id, status: "unknown", providerRef: row.provider_ref, reason: "status check failed" };
  }
}
