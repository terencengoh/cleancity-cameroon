import { useState } from "react";
import { supabase } from "../lib/supabase";
import { when } from "../lib/format";
import { must } from "../lib/must";
import { useQuery } from "../lib/useQuery";
import { Badge, Filter, Loading, Section } from "../components/ui";
import type { Profile } from "../lib/types";

export default function People() {
  const [city, setCity] = useState("");
  const q = useQuery("people", () => supabase.from("profiles").select("*").order("created_at").limit(5000));
  const regions = useQuery("regions", () => supabase.from("regions").select("id,name_en,name_fr").order("name_en"));
  const cities = useQuery("cities-all", () => supabase.from("cities").select("id,name,region_id").order("name"));
  const all = (q.data ?? []) as Profile[];
  const rows = city ? all.filter((p) => p.city_id === city) : all;
  const cs = (cities.data ?? []) as { id: string; name: string; region_id: string }[];
  return (
    <>
      <Section title="Sign-ups by region and city">
        <div className="cards">{((regions.data ?? []) as { id: string; name_en: string; name_fr: string }[]).map((r) => (
          <div key={r.id} className="stat"><b>{all.filter((p) => p.region_id === r.id).length}</b>{r.name_en} / {r.name_fr}
            {cs.filter((c) => c.region_id === r.id).map((c) => <div key={c.id} className="muted">{c.name}: {all.filter((p) => p.city_id === c.id).length}</div>)}</div>
        ))}</div>
      </Section>
      <Section title={`People (${rows.length})`} actions={<Filter value={city} options={cs.map((c) => c.id)} onChange={setCity} />}>
        <Loading loading={q.loading} error={q.error} empty={!rows.length} />
        <table>
          <thead><tr><th>Name</th><th>Phone</th><th>City / quarter</th><th>Role</th><th>Served</th><th>Signed up</th><th></th></tr></thead>
          <tbody>{rows.map((p) => (
            <tr key={p.id}>
              <td>{p.full_name}{p.suspended ? <> <Badge value="suspended" /></> : null}</td><td>+{p.phone} <span className="muted">{p.operator}</span></td>
              <td>{p.city_id} · {p.quarter}</td>
              <td><select value={p.role} onChange={async (e) => { try { await must(supabase.rpc("set_role", { p_user: p.id, p_role: e.target.value })); q.reload(); } catch (err) { alert((err as Error).message); } }}>
                <option value="worker">worker</option><option value="supervisor">supervisor</option><option value="admin">admin</option></select></td>
              <td>{p.served_count} {p.last_served_at ? <span className="muted">· last {when(p.last_served_at)}</span> : null}</td>
              <td>{when(p.created_at)}</td>
              <td><button className="btn" onClick={async () => {
                const reason = window.prompt(p.suspended ? "Reason for reinstating" : "Reason for suspending (e.g. proven fraud)");
                if (!reason) return;
                try { await must(supabase.rpc("set_suspended", { p_user: p.id, p_suspended: !p.suspended, p_reason: reason })); q.reload(); } catch (err) { alert((err as Error).message); }
              }}>{p.suspended ? "Reinstate" : "Suspend"}</button></td>
            </tr>
          ))}</tbody>
        </table>
      </Section>
    </>
  );
}
