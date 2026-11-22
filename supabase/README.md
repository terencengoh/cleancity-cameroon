# Supabase backend

| Path | What |
|---|---|
| `migrations/…01_schema.sql` | Regions, cities, zones, settings (50,000 FCFA/week, 5,000 FCFA/person, 1 zone/week by default), profiles, shifts, assignments, photos, payout requests, double-entry ledger, audit log, push tokens, notifications |
| `migrations/…02_functions.sql` | RPCs: `sign_up`, `my_queue_position`, `schedule_week`, `run_selection` / `fill_shift` (fair queue + **budget guard**), `respond_invite`, `expire_invites`, `check_in` (code/QR + GPS radius), `check_out`, `sign_off`, `add_shift_photo`, `complete_shift`, `update_settings`, `approve_payout` (separation of duties), `record_funding`, `claim_payouts` / `settle_payout` (idempotent), `budget_summary`, `ledger_balances` |
| `migrations/…03_rls.sql` | Row Level Security: no direct writes; workers see their own rows, supervisors their crews, admins everything |
| `migrations/…04_jobs_storage.sql` | pg_cron: weekly selection (Mon 08:00 Douala), deadline expiry + refill (every 15 min), Friday reminders; private `shift-photos` bucket |
| `sql/schedule_http_jobs.sql` | pg_cron + pg_net jobs calling the `notify` and `payouts-process` Edge Functions (run once by hand) |
| `functions/` | Edge Functions (Deno): `payouts-process` (CamPay / Notch Pay transfers), `payouts-webhook`, `notify` (Expo push) |
| `tests/db/` | Migrations + seed + RPC/RLS tests on PGlite (`npm test`) |

## Weekly flow
1. **Monday 08:00:** `weekly_job()` schedules next Saturday (`zones_per_week` zones, least recently cleaned first, spread across cities) and invites `crew_size = floor(budget / zones / pay)` people per zone (10 by default) from each city's fair queue. It never invites more than the remaining weekly budget allows.
2. Invited workers confirm in the app before the deadline (48 h, and at least 12 h before the shift). `expire_invites()` expires missed deadlines and invites the next person in line.
3. **Saturday:** the supervisor runs the safety briefing, then checks each worker in by QR/code with phone GPS within 300 m of the meeting point. At the end they sign each worker off (full / partial pro rata / absent) and upload before/after photos.
4. An admin who did not sign the worker off approves the payout. `payouts-process` sends it with the idempotent reference `cc-<assignment id>`, and `settle_payout` posts it to the ledger exactly once.

## Deploy
```bash
supabase link --project-ref YOUR-REF
supabase db push            # migrations (pg_cron jobs are created if the extension is available)
psql "$DB_URL" -f supabase/seed.sql
supabase functions deploy payouts-process payouts-webhook notify
supabase secrets set --env-file supabase/functions/.env   # real keys live only here
# then run supabase/sql/schedule_http_jobs.sql in the SQL editor
```
Make the first admin: `update public.profiles set role = 'admin' where phone = '2376XXXXXXXX';` in the SQL editor.
