import { useEffect, useState, type ComponentType } from "react";
import type { Session } from "@supabase/supabase-js";
import { isConfigured, supabase } from "./lib/supabase";
import { useQuery } from "./lib/useQuery";
import Weeks from "./pages/Weeks";
import Settings from "./pages/Settings";
import Zones from "./pages/Zones";
import Payouts from "./pages/Payouts";
import People from "./pages/People";
import Ledger from "./pages/Ledger";

const PAGES: { id: string; label: string; Component: ComponentType }[] = [
  { id: "weeks", label: "Weeks & budget", Component: Weeks },
  { id: "payouts", label: "Payouts", Component: Payouts },
  { id: "people", label: "People", Component: People },
  { id: "zones", label: "Zones", Component: Zones },
  { id: "settings", label: "Settings", Component: Settings },
  { id: "ledger", label: "Ledger & audit", Component: Ledger },
];

const currentHash = () => window.location.hash.replace(/^#\/?/, "") || "weeks";

function useHash() {
  const [hash, setHash] = useState(currentHash);
  useEffect(() => {
    const on = () => setHash(currentHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

function useSession() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  return session;
}

function Login() {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const e164 = () => { const d = phone.replace(/\D/g, ""); return `+${d.length === 9 ? `237${d}` : d}`; };
  return (
    <form className="login" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true); setErr(null);
      const { error } = sent
        ? await supabase.auth.verifyOtp({ phone: e164(), token: code.trim(), type: "sms" })
        : await supabase.auth.signInWithOtp({ phone: e164(), options: { shouldCreateUser: false } });
      setBusy(false);
      if (error) setErr(error.message); else if (!sent) setSent(true);
    }}>
      <h1>CleanCity <span style={{ color: "#007a3d" }}>Admin</span></h1>
      {!isConfigured ? <p className="error">Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in admin/.env.local.</p> : null}
      <input type="tel" placeholder="+237 6XX XX XX XX" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required disabled={sent} />
      {sent ? <input inputMode="numeric" placeholder="SMS code" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required /> : null}
      <button className="btn primary" disabled={busy} type="submit">{busy ? "…" : sent ? "Verify" : "Send code"}</button>
      {err ? <p className="error">{err}</p> : null}
      <p className="muted">Admins only. Sign up in the app first, then an existing admin promotes you (see admin/README.md).</p>
    </form>
  );
}

function Shell({ session }: { session: Session }) {
  const hash = useHash();
  const role = useQuery(`role:${session.user.id}`, () =>
    supabase.from("profiles").select("role,suspended").eq("id", session.user.id).maybeSingle());
  if (role.loading) return <p className="muted" style={{ padding: 24 }}>Checking access…</p>;
  const me = role.data as { role: string; suspended: boolean } | null;
  const ok = me?.role === "admin" && !me.suspended;
  if (!ok) {
    return (
      <div className="login">
        <h1>Access denied</h1>
        <p>{session.user.email ?? session.user.phone} is not an admin.</p>
        {role.error ? <p className="error">{role.error}</p> : null}
        <button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    );
  }
  const page = PAGES.find((p) => p.id === hash) ?? PAGES[0];
  return (
    <div className="layout">
      <nav>
        <div className="brand">Clean<span>City</span> admin</div>
        {PAGES.map((p) => <a key={p.id} href={`#/${p.id}`} className={p.id === page.id ? "active" : ""}>{p.label}</a>)}
        <div className="foot">
          <div>{session.user.phone ? `+${session.user.phone}` : session.user.email}</div>
          <button className="btn" style={{ marginTop: 8 }} onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </nav>
      <main>
        <h1>{page.label}</h1>
        <page.Component key={page.id} />
      </main>
    </div>
  );
}

export default function App() {
  const session = useSession();
  if (session === undefined) return null;
  return session ? <Shell session={session} /> : <Login />;
}
