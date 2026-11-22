import { useState } from "react";
import { supabase } from "../lib/supabase";
import { fcfa, when } from "../lib/format";
import { must } from "../lib/must";
import { useQuery } from "../lib/useQuery";
import { Action, Badge, Filter, Loading, Section } from "../components/ui";
import type { Payout } from "../lib/types";

export default function Payouts() {
  const [status, setStatus] = useState("awaiting_approval");
  const q = useQuery(`payouts:${status}`, () => {
    let r = supabase.from("payout_requests").select("*, profiles(full_name)").order("created_at", { ascending: false }).limit(300);
    if (status) r = r.eq("status", status);
    return r;
  });
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const rows = (q.data ?? []) as Payout[];
  const approvable = rows.filter((p) => p.status === "awaiting_approval" || p.status === "failed");
  return (
    <>
      <Section title="Worker payouts" actions={<>
        <Filter value={status} options={["awaiting_approval", "approved", "processing", "paid", "failed"]} onChange={setStatus} />
        {approvable.length ? <Action label={`Approve all shown (${approvable.length})`} kind="primary" confirm="Approve these payouts? They will be sent automatically."
          run={async () => { for (const p of approvable) await must(supabase.rpc("approve_payout", { p_id: p.id })); q.reload(); }} /> : null}
      </>}>
        <Loading loading={q.loading} error={q.error} empty={!rows.length} />
        <table>
          <thead><tr><th>Worker</th><th>Week</th><th className="num">Amount</th><th>Wallet</th><th>Status</th><th>Reference</th><th></th></tr></thead>
          <tbody>{rows.map((p) => (
            <tr key={p.id}>
              <td>{p.profiles?.full_name}</td><td>{p.week}</td><td className="num">{fcfa(p.amount_xaf)}</td>
              <td>+{p.phone} ({p.operator === "mtn" ? "MTN MoMo" : "Orange Money"})</td>
              <td><Badge value={p.status} />{p.failure_reason ? <div className="error">{p.failure_reason}</div> : null}{p.paid_at ? <div className="muted">{when(p.paid_at)} · fee {fcfa(p.fee_xaf)}</div> : null}</td>
              <td><code>{p.reference.slice(0, 15)}…</code></td>
              <td>{p.status === "awaiting_approval" || p.status === "failed"
                ? <Action label={p.status === "failed" ? "Retry" : "Approve"} kind="primary" run={async () => { await must(supabase.rpc("approve_payout", { p_id: p.id })); q.reload(); }} /> : null}</td>
            </tr>
          ))}</tbody>
        </table>
        <p className="muted">Approved payouts are sent by the payouts-process job (every 5 minutes) with an idempotent reference. Whoever signed a worker off cannot approve that payout.</p>
      </Section>
      <Section title="Record funding received">
        <div className="row">
          <input type="number" placeholder="Amount (FCFA)" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <input placeholder="Source (council, sponsor, diaspora…)" value={memo} onChange={(e) => setMemo(e.target.value)} style={{ minWidth: 280 }} />
          <Action label="Record" disabled={!(Number(amount) > 0) || !memo} run={async () => { await must(supabase.rpc("record_funding", { p_amount: Number(amount), p_memo: memo })); setAmount(""); setMemo(""); }} />
        </div>
      </Section>
    </>
  );
}
