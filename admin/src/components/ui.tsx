import { useState, type ReactNode } from "react";

export function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head"><h2>{title}</h2><div className="row">{actions}</div></div>
      {children}
    </section>
  );
}

export function Badge({ value }: { value: string | boolean | null | undefined }) {
  const v = value === true ? "yes" : value === false ? "no" : (value ?? "—");
  return <span className={`badge b-${String(v).replace(/[^a-z_]/gi, "")}`}>{String(v)}</span>;
}

export function Loading({ loading, error, empty }: { loading: boolean; error: string | null; empty?: boolean }) {
  if (loading) return <p className="muted">Loading…</p>;
  if (error) return <p className="error">{error}</p>;
  if (empty) return <p className="muted">Nothing here.</p>;
  return null;
}

/** Button that runs an async action, shows a spinner state and reports errors. */
export function Action({ label, run, kind = "secondary", confirm: confirmText, disabled }: {
  label: string; run: () => Promise<unknown>; kind?: "primary" | "secondary" | "danger"; confirm?: string; disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button className={`btn ${kind}`} disabled={busy || disabled} onClick={async () => {
      if (confirmText && !window.confirm(confirmText)) return;
      setBusy(true);
      try { await run(); } catch (e) { window.alert(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
    }}>{busy ? "…" : label}</button>
  );
}

export function Filter({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">all</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}
