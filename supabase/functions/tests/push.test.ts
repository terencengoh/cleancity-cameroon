import { assertEquals } from "jsr:@std/assert@1";
import { dispatchPush, type OutboxItem, type PushStore } from "../_shared/push.ts";
import { fakeFetch } from "./helpers.ts";

function memory(items: OutboxItem[], tokens: { user_id: string; token: string }[]) {
  const marks: Record<string, string[]> = {};
  const deleted: string[] = [];
  const store: PushStore = {
    pending: () => Promise.resolve(items),
    tokens: (ids) => Promise.resolve(tokens.filter((t) => ids.includes(t.user_id))),
    mark: (ids, status) => ((marks[status] = [...(marks[status] ?? []), ...ids]), Promise.resolve()),
    deleteTokens: (t) => (deleted.push(...t), Promise.resolve()),
  };
  return { store, marks, deleted };
}

const n = (id: number, user: string, kind = "paid"): OutboxItem => ({ id: String(id), user_id: user, title: "T", body: "B", data: { url: "/x" }, kind });

Deno.test("expo push: batches, marks sent/failed/no_token, removes DeviceNotRegistered tokens", async () => {
  const { store, marks, deleted } = memory(
    [n(1, "u1", "invited"), n(2, "u2"), n(3, "u3")],
    [{ user_id: "u1", token: "ExponentPushToken[a]" }, { user_id: "u1", token: "ExponentPushToken[dead]" }, { user_id: "u2", token: "ExponentPushToken[b]" }],
  );
  const f = fakeFetch([[/exp\.host/, (c) => {
    const msgs = JSON.parse(c.body) as { to: string }[];
    return {
      body: {
        data: msgs.map((m) =>
          m.to.includes("dead") ? { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } }
          : m.to.includes("[b]") ? { status: "error", message: "rate", details: { error: "MessageRateExceeded" } }
          : { status: "ok", id: "x" }
        ),
      },
    };
  }]]);
  const res = await dispatchPush(store, { fetchFn: f.fetch, accessToken: "expo-token" });
  assertEquals(res, { notifications: 3, sent: 1, failed: 1, noTokens: 1, removedTokens: 1 });
  assertEquals(marks, { no_token: ["3"], sent: ["1"], failed: ["2"] });
  assertEquals(deleted, ["ExponentPushToken[dead]"]);
  assertEquals(f.calls[0].headers.get("Authorization"), "Bearer expo-token");
  const first = JSON.parse(f.calls[0].body)[0];
  assertEquals([first.channelId, first.priority, first.data.kind], ["urgent", "high", "invited"]);
});

Deno.test("expo push: chunks of 100 and HTTP failure marks the chunk failed", async () => {
  const items = Array.from({ length: 150 }, (_, i) => n(i + 1, `u${i}`));
  const tokens = items.map((it) => ({ user_id: it.user_id, token: `ExponentPushToken[${it.id}]` }));
  const { store, marks } = memory(items, tokens);
  let calls = 0;
  const f = fakeFetch([[/exp\.host/, (c) => {
    calls++;
    const msgs = JSON.parse(c.body);
    return calls === 1 ? { body: { data: msgs.map(() => ({ status: "ok" })) } } : { status: 500, body: {} };
  }]]);
  const res = await dispatchPush(store, { fetchFn: f.fetch });
  assertEquals(f.calls.length, 2);
  assertEquals(JSON.parse(f.calls[0].body).length, 100);
  assertEquals([res.sent, res.failed], [100, 50]);
  assertEquals(marks.failed.length, 50);
});

Deno.test("expo push: nothing pending -> no request", async () => {
  const { store } = memory([], []);
  const f = fakeFetch([]);
  assertEquals((await dispatchPush(store, { fetchFn: f.fetch })).notifications, 0);
  assertEquals(f.calls.length, 0);
});
