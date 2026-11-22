import { supabase } from "../lib/supabase";
import { fcfa, when } from "../lib/format";
import { useQuery } from "../lib/useQuery";
import { Loading, Section } from "../components/ui";

export default function Ledger() {
  const bal = useQuery("balances", () => supabase.rpc("ledger_balances"));
  const audit = useQuery("audit", () => supabase.from("audit_log").select("*").order("at", { ascending: false }).limit(200));
  const sums = new Map<string, number>();
  for (const r of (bal.data ?? []) as { kind: string; balance_xaf: number }[]) sums.set(r.kind, (sums.get(r.kind) ?? 0) + Number(r.balance_xaf));
  return (
    <>
      <Section title="Ledger balances (double-entry; debits +, credits −)">
        <Loading loading={bal.loading} error={bal.error} />
        <div className="cards">{[...sums.entries()].map(([k, v]) => <div key={k} className="stat"><b>{fcfa(v)}</b>{k.replace(/_/g, " ")}</div>)}</div>
        <p className="muted">merchant balance = money on the payout account · worker payable = signed-off pay not yet sent · wages/fees expense = cost to date.</p>
      </Section>
      <Section title="Audit log">
        <Loading loading={audit.loading} error={audit.error} />
        <table><tbody>{((audit.data ?? []) as { id: number; at: string; action: string; details: unknown }[]).map((a) => (
          <tr key={a.id}><td className="muted">{when(a.at)}</td><td>{a.action}</td><td><code>{JSON.stringify(a.details)}</code></td></tr>
        ))}</tbody></table>
      </Section>
    </>
  );
}
