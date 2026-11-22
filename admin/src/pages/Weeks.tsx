import { useState } from "react";
import { supabase } from "../lib/supabase";
import { fcfa, when } from "../lib/format";
import { must } from "../lib/must";
import { useQuery } from "../lib/useQuery";
import { Action, Badge, Loading, Section } from "../components/ui";
import { nextSaturday, type Assignment, type Budget, type Profile, type Shift } from "../lib/types";

function BudgetBar({ week }: { week: string }) {
  const q = useQuery(`budget:${week}`, () => supabase.rpc("budget_summary", { p_week: week }).single());
  const b = q.data as Budget | null;
  if (!b) return <Loading loading={q.loading} error={q.error} />;
  const pct = Math.min(100, Math.round((b.used / Math.max(1, b.budget)) * 100));
  return (
    <div>
      <div className="bar"><span style={{ width: `${pct}%` }} /></div>
      <div className="row">
        <span>Budget <b>{fcfa(b.budget)}</b></span><span>Committed <b>{fcfa(b.committed)}</b></span><span>Paid <b>{fcfa(b.paid)}</b></span>
        <span>Fees {fcfa(b.fees)}</span><span>Remaining <b>{fcfa(b.remaining)}</b></span><span className="muted">crew/zone {b.crew_size}</span>
      </div>
    </div>
  );
}

export default function Weeks() {
  const [week, setWeek] = useState(nextSaturday());
  const shifts = useQuery(`shifts:${week}`, () => supabase.from("shifts").select("*, zones(name)").eq("week", week).order("created_at"));
  const asg = useQuery(`asg:${week}`, () => supabase.from("assignments").select("id,shift_id,person_id,status,outcome,pay_xaf").eq("week", week));
  const sups = useQuery("supervisors", () => supabase.from("profiles").select("id,full_name,phone,role").eq("role", "supervisor").order("full_name"));
  const reload = () => { shifts.reload(); asg.reload(); };
  const rows = (shifts.data ?? []) as Shift[];
  const all = (asg.data ?? []) as Assignment[];
  return (
    <>
      <Section title={`Week of Saturday ${week}`} actions={<>
        <input type="date" value={week} onChange={(e) => setWeek(e.target.value)} />
        <Action label="Schedule this Saturday" kind="primary" run={async () => { await must(supabase.rpc("schedule_week", { p_week: week })); reload(); }} />
        <Action label="Run selection / refill" run={async () => { await must(supabase.rpc("run_selection", { p_week: week })); reload(); }} />
        <Action label="Expire missed deadlines" run={async () => { await must(supabase.rpc("expire_invites")); reload(); }} />
      </>}>
        <BudgetBar key={`${week}-${all.length}-${all.filter((a) => a.status === "signed_off").length}`} week={week} />
        <p className="muted">Selection never invites more people than the remaining budget allows. The weekly job does this automatically every Monday at 08:00 (Douala).</p>
      </Section>
      <Section title="Shifts">
        <Loading loading={shifts.loading} error={shifts.error} empty={!rows.length} />
        <table>
          <thead><tr><th>Zone</th><th>Time</th><th>Status</th><th>Crew</th><th>Supervisor</th></tr></thead>
          <tbody>{rows.map((s) => {
            const mine = all.filter((a) => a.shift_id === s.id);
            const c = (st: string) => mine.filter((a) => a.status === st).length;
            return (
              <tr key={s.id}>
                <td>{s.zones?.name ?? s.zone_id}</td><td>{when(s.starts_at)} → {when(s.ends_at)}</td><td><Badge value={s.status} /></td>
                <td>invited {c("invited")} · confirmed {c("confirmed")} · checked in {c("checked_in")} · signed off {c("signed_off")} · declined/expired {c("declined") + c("expired")} / {s.crew_size}</td>
                <td>
                  <select value={s.supervisor_id ?? ""} onChange={async (e) => {
                    try { await must(supabase.rpc("assign_supervisor", { p_shift: s.id, p_supervisor: e.target.value })); reload(); } catch (err) { alert((err as Error).message); }
                  }}>
                    <option value="">—</option>
                    {((sups.data ?? []) as Profile[]).map((p) => <option key={p.id} value={p.id}>{p.full_name} (+{p.phone})</option>)}
                  </select>
                </td>
              </tr>
            );
          })}</tbody>
        </table>
      </Section>
    </>
  );
}
