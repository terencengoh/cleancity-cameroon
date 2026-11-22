// Supabase implementation of PayoutStore (service-role client; settle_payout enforces the state machine and ledger).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { PayoutStore } from "./transfers.ts";

export function supabasePayoutStore(db: SupabaseClient): PayoutStore {
  return {
    async settle(id, status, provider, providerRef, feeXaf, reason) {
      const { error } = await db.rpc("settle_payout", {
        p_id: id, p_status: status, p_provider: provider, p_provider_ref: providerRef, p_fee: feeXaf, p_reason: reason,
      });
      if (error) throw new Error(error.message);
    },
  };
}
