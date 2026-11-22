# CleanCity admin dashboard (Vite + React)

For admins: weekly budget used/remaining, scheduling and selection, supervisors per shift, payout approvals,
funding records, people grouped by region and city, zones and rotation, settings, ledger and audit log.

```bash
cp .env.example .env.local   # public Supabase URL + anon key only
npm install
npm run dev                  # http://localhost:5173
npm run build                # static files in dist/
```

Sign-in uses the admin's phone (SMS OTP). The first admin is promoted once in the Supabase SQL editor:
`update public.profiles set role = 'admin' where phone = '2376XXXXXXXX';`. Later admins and supervisors are set from **People**.
Every write is a database RPC that checks the role. No secrets live in this app.
