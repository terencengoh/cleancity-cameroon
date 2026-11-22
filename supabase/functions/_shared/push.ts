// Delivers the notifications outbox through the Expo Push API.
//   POST https://exp.host/--/api/v2/push/send  (array of up to 100 messages)
//   message: { to: "ExponentPushToken[...]", title, body, data, sound, channelId, priority }
//   -> { data: [ { status: "ok", id } | { status: "error", message, details: { error: "DeviceNotRegistered" | ... } } ] }
// Tickets with DeviceNotRegistered mean the token is dead and is deleted. Optional EXPO_ACCESS_TOKEN
// (Expo "enhanced push security") is sent as a Bearer token. Docs: https://docs.expo.dev/push-notifications/sending-notifications/
export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export interface OutboxItem {
  id: string;
  user_id: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  kind: string;
}

export interface PushStore {
  pending(limit: number): Promise<OutboxItem[]>;
  tokens(userIds: string[]): Promise<{ user_id: string; token: string }[]>;
  mark(ids: string[], status: "sent" | "failed" | "no_token", error?: string): Promise<void>;
  deleteTokens(tokens: string[]): Promise<void>;
}

export interface DispatchResult {
  notifications: number;
  sent: number;
  failed: number;
  noTokens: number;
  removedTokens: number;
}

// Time-sensitive: an invitation has a confirmation deadline; the reminder is for the next morning.
const URGENT = new Set(["invited", "reminder"]);

export async function dispatchPush(store: PushStore, opts: { fetchFn?: typeof fetch; accessToken?: string; limit?: number } = {}): Promise<DispatchResult> {
  const items = await store.pending(opts.limit ?? 500);
  const result: DispatchResult = { notifications: items.length, sent: 0, failed: 0, noTokens: 0, removedTokens: 0 };
  if (!items.length) return result;
  const tokenRows = await store.tokens([...new Set(items.map((i) => i.user_id))]);
  const byUser = new Map<string, string[]>();
  for (const t of tokenRows) byUser.set(t.user_id, [...(byUser.get(t.user_id) ?? []), t.token]);

  const messages: { notificationId: string; msg: Record<string, unknown> }[] = [];
  const noTokens: string[] = [];
  for (const n of items) {
    const tokens = byUser.get(n.user_id) ?? [];
    if (!tokens.length) noTokens.push(n.id);
    for (const to of tokens) {
      messages.push({
        notificationId: n.id,
        msg: {
          to, title: n.title, body: n.body, data: { ...n.data, kind: n.kind, notification_id: n.id }, sound: "default",
          channelId: URGENT.has(n.kind) ? "urgent" : "default", priority: URGENT.has(n.kind) ? "high" : "default",
        },
      });
    }
  }
  if (noTokens.length) {
    await store.mark(noTokens, "no_token");
    result.noTokens = noTokens.length;
  }

  const okIds = new Set<string>();
  const errIds = new Map<string, string>();
  const dead: string[] = [];
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      const res = await (opts.fetchFn ?? fetch)(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json", Accept: "application/json", "Accept-Encoding": "gzip, deflate",
          ...(opts.accessToken ? { Authorization: `Bearer ${opts.accessToken}` } : {}),
        },
        body: JSON.stringify(chunk.map((c) => c.msg)),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(body?.data)) throw new Error(`Expo push HTTP ${res.status}`);
      body.data.forEach((ticket: { status: string; message?: string; details?: { error?: string } }, j: number) => {
        const c = chunk[j];
        if (!c) return;
        if (ticket.status === "ok") okIds.add(c.notificationId);
        else {
          errIds.set(c.notificationId, ticket.details?.error ?? ticket.message ?? "error");
          if (ticket.details?.error === "DeviceNotRegistered") dead.push(String(c.msg.to));
        }
      });
    } catch (e) {
      for (const c of chunk) errIds.set(c.notificationId, (e as Error).message);
    }
  }
  // A notification counts as sent if at least one of the user's devices accepted it.
  const sent = [...okIds];
  const failed = [...errIds.keys()].filter((id) => !okIds.has(id));
  if (sent.length) await store.mark(sent, "sent");
  if (failed.length) await store.mark(failed, "failed", errIds.get(failed[0]));
  if (dead.length) await store.deleteTokens(dead);
  result.sent = sent.length;
  result.failed = failed.length;
  result.removedTokens = dead.length;
  return result;
}
