import { useState } from "react";
import { supabase } from "../lib/supabase";
import { fcfa, when } from "../lib/format";
import { must } from "../lib/must";
import { useQuery } from "../lib/useQuery";
import { Action, Loading, Section } from "../components/ui";
import { crewSize, type Settings as S } from "../lib/types";

const FIELDS: [keyof S, string, number][] = [
  ["weekly_budget_xaf", "Weekly budget (FCFA)", 500], ["pay_per_person_xaf", "Pay per person, full shift (FCFA)", 500],
  ["zones_per_week", "Zones per Saturday", 1], ["shift_hours", "Shift length (h)", 0.5], ["confirm_hours", "Hours to confirm", 1],
  ["checkin_radius_m", "Check-in GPS radius (m)", 50], ["payout_fee_pct", "Payout fee (%)", 0.1], ["partial_round_xaf", "Partial pay rounding (FCFA)", 100],
];

function Form({ s, onSaved }: { s: S; onSaved: () => void }) {
  const [v, setV] = useState<S>(s);
  const crew = crewSize(v);
  const zones = Math.max(1, v.zones_per_week);
  return (
    <>
      <div className="grid2">
        {FIELDS.map(([k, label, step]) => (
          <label key={k}>{label}<input type="number" step={step} min={0} value={String(v[k])} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} /></label>
        ))}
        <label>Shift start<input type="time" value={v.shift_start.slice(0, 5)} onChange={(e) => setV({ ...v, shift_start: e.target.value })} /></label>
        <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={v.fees_in_budget} onChange={(e) => setV({ ...v, fees_in_budget: e.target.checked })} /> Count payout fees in the budget
        </label>
      </div>
      <p className="note"><b>Crew per zone = {crew} people</b> · {crew * zones} × {fcfa(v.pay_per_person_xaf)} = {fcfa(crew * zones * v.pay_per_person_xaf)} per Saturday
        {" "}· fees ≈ {fcfa(crew * zones * Math.ceil((v.pay_per_person_xaf * v.payout_fee_pct) / 100))}</p>
      <Action label="Save settings" kind="primary" run={async () => {
        const { updated_at: _u, ...rest } = v; void _u;
        await must(supabase.rpc("update_settings", { p: rest })); onSaved();
      }} />
      <p className="muted">Last changed {when(s.updated_at)}. New crew sizes apply to Saturdays scheduled after the change.</p>
    </>
  );
}

export default function Settings() {
  const q = useQuery("settings", () => supabase.from("settings").select("*").single());
  const s = q.data as S | null;
  return (
    <Section title="Budget and shift settings">
      <Loading loading={q.loading} error={q.error} />
      {s ? <Form key={s.updated_at} s={s} onSaved={q.reload} /> : null}
    </Section>
  );
}
