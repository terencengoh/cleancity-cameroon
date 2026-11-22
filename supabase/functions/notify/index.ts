// POST /functions/v1/notify   (service role only; pg_cron + pg_net every minute, see supabase/sql/schedule_http_jobs.sql)
// Sends pending rows of public.notifications (invitations, reminders, payment receipts) through the Expo Push API.
import { handler, HttpError, json } from "../_shared/http.ts";
import { adminClient, isServiceRequest } from "../_shared/supabase.ts";
import { dispatchPush, type OutboxItem, type PushStore } from "../_shared/push.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

function store(db: SupabaseClient): PushStore {
  let tokens: { user_id: string; token: string }[] = [];
  return {
    async pending(limit) {
      // claim_notifications claims the batch atomically (FOR UPDATE SKIP LOCKED) and returns each user's tokens.
      const { data, error } = await db.rpc("claim_notifications", { p_limit: limit });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as (OutboxItem & { tokens: string[] })[];
      tokens = rows.flatMap((r) => r.tokens.map((token) => ({ user_id: r.user_id, token })));
      return rows.map((r) => ({ id: r.id, user_id: r.user_id, title: r.title, body: r.body, data: r.data, kind: r.kind }));
    },
    tokens: (userIds) => Promise.resolve([...new Map(tokens.filter((t) => userIds.includes(t.user_id)).map((t) => [t.token, t])).values()]),
    async mark(ids, status, err) {
      for (const id of ids) {
        const { error } = await db.rpc("mark_notification", { p_id: id, p_status: status, p_error: err ?? null });
        if (error) throw new Error(error.message);
      }
    },
    async deleteTokens(list) {
      for (const t of list) await db.rpc("drop_push_token", { p_token: t });
    },
  };
}

Deno.serve(handler(async (req) => {
  if (!isServiceRequest(req)) throw new HttpError(403, "service role only");
  return json(await dispatchPush(store(adminClient()), { accessToken: Deno.env.get("EXPO_ACCESS_TOKEN") ?? undefined, limit: 300 }));
}));
