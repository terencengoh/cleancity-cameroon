import { useState } from "react";
import { supabase } from "../lib/supabase";
import { osm } from "../lib/format";
import { must } from "../lib/must";
import { useQuery } from "../lib/useQuery";
import { Action, Loading, Section } from "../components/ui";
import type { Zone } from "../lib/types";

export default function Zones() {
  const q = useQuery("zones", () => supabase.from("zones").select("*").order("rotation"));
  const cities = useQuery("cities", () => supabase.from("cities").select("id,name").order("name"));
  const [f, setF] = useState({ city: "douala", name: "", meet: "", lat: "", lng: "" });
  const rows = (q.data ?? []) as Zone[];
  const save = (z: Zone, patch: Partial<Zone>) => {
    const n = { ...z, ...patch };
    return must(supabase.rpc("upsert_zone", { p_id: n.id, p_city: n.city_id, p_name: n.name, p_meet: n.meet, p_lat: n.lat, p_lng: n.lng, p_rotation: n.rotation, p_active: n.active, p_quarters: n.quarters })).then(q.reload);
  };
  return (
    <>
      <Section title="Zones (rotation order)">
        <Loading loading={q.loading} error={q.error} />
        <table>
          <thead><tr><th>Order</th><th>Zone</th><th>City</th><th>Meeting point</th><th>Last cleaned</th><th>Active</th></tr></thead>
          <tbody>{rows.map((z) => (
            <tr key={z.id}>
              <td><input className="small" type="number" defaultValue={z.rotation} onBlur={(e) => Number(e.target.value) !== z.rotation && save(z, { rotation: Number(e.target.value) })} /></td>
              <td>{z.name}<br /><span className="muted">{z.quarters.join(", ")}</span></td><td>{z.city_id}</td>
              <td>{z.meet} · <a href={osm(z.lat, z.lng)} target="_blank" rel="noreferrer">map</a></td>
              <td>{z.last_scheduled ?? "never"}</td>
              <td><input type="checkbox" checked={z.active} onChange={(e) => save(z, { active: e.target.checked })} /></td>
            </tr>
          ))}</tbody>
        </table>
        <p className="muted">Each week the least recently cleaned active zones are picked, spread across different cities.</p>
      </Section>
      <Section title="Add a zone">
        <div className="grid2">
          <label>City<select value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })}>
            {((cities.data ?? []) as { id: string; name: string }[]).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label>Meeting point<input value={f.meet} onChange={(e) => setF({ ...f, meet: e.target.value })} /></label>
          <label>Latitude<input value={f.lat} inputMode="decimal" onChange={(e) => setF({ ...f, lat: e.target.value })} /></label>
          <label>Longitude<input value={f.lng} inputMode="decimal" onChange={(e) => setF({ ...f, lng: e.target.value })} /></label>
          <Action label="Add zone" kind="primary" disabled={!f.name || !f.meet || !f.lat || !f.lng} run={async () => {
            await must(supabase.rpc("upsert_zone", { p_id: null, p_city: f.city, p_name: f.name, p_meet: f.meet, p_lat: Number(f.lat), p_lng: Number(f.lng), p_rotation: rows.length + 1, p_active: true, p_quarters: [] }));
            setF({ ...f, name: "", meet: "", lat: "", lng: "" }); q.reload();
          }} />
        </div>
      </Section>
    </>
  );
}
