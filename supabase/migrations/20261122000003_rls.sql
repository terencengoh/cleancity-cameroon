-- Row Level Security: apps read through these policies; all writes go through the RPCs in migration 2.

alter table public.regions enable row level security;
alter table public.cities enable row level security;
alter table public.zones enable row level security;
alter table public.settings enable row level security;
alter table public.profiles enable row level security;
alter table public.shifts enable row level security;
alter table public.assignments enable row level security;
alter table public.shift_photos enable row level security;
alter table public.payout_requests enable row level security;
alter table public.ledger_accounts enable row level security;
alter table public.ledger_transactions enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.audit_log enable row level security;
alter table public.push_tokens enable row level security;
alter table public.notifications enable row level security;

-- No direct writes from the apps.
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
revoke all on all tables in schema public from anon;
grant select on public.regions, public.cities to anon;

-- Reference data
create policy regions_read on public.regions for select using (true);
create policy cities_read on public.cities for select using (true);
create policy zones_read on public.zones for select to authenticated using (true);
create policy settings_read on public.settings for select to authenticated using (true);

-- Profiles: yourself; supervisors see their crews; admins see everyone.
create policy profiles_self on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_supervisor on public.profiles for select to authenticated using (
  exists (select 1 from public.assignments a join public.shifts s on s.id = a.shift_id
          where a.person_id = profiles.id and s.supervisor_id = auth.uid()));
create policy profiles_admin on public.profiles for select to authenticated using (public.is_admin());

-- Shifts: everyone signed in (zones and dates are public information); crews are protected below.
create policy shifts_read on public.shifts for select to authenticated using (true);

-- Assignments: your own; the shift's supervisor; admins.
create policy assignments_self on public.assignments for select to authenticated using (person_id = auth.uid());
create policy assignments_supervisor on public.assignments for select to authenticated using (
  exists (select 1 from public.shifts s where s.id = assignments.shift_id and s.supervisor_id = auth.uid()));
create policy assignments_admin on public.assignments for select to authenticated using (public.is_admin());

create policy photos_read on public.shift_photos for select to authenticated using (public.can_supervise(shift_id));

create policy payouts_self on public.payout_requests for select to authenticated using (person_id = auth.uid());
create policy payouts_admin on public.payout_requests for select to authenticated using (public.is_admin());

create policy ledger_accounts_admin on public.ledger_accounts for select to authenticated using (public.is_admin());
create policy ledger_tx_admin on public.ledger_transactions for select to authenticated using (public.is_admin());
create policy ledger_entries_admin on public.ledger_entries for select to authenticated using (public.is_admin());
create policy audit_admin on public.audit_log for select to authenticated using (public.is_admin());

create policy push_tokens_self on public.push_tokens for select to authenticated using (user_id = auth.uid());
create policy notifications_self on public.notifications for select to authenticated using (user_id = auth.uid());

-- ---------- function privileges ----------
-- Internal helpers and service-only functions are not callable from the apps.
revoke execute on all functions in schema public from public, anon;
grant execute on function public.normalize_phone(text), public.detect_operator(text), public.next_saturday(date) to anon;

revoke execute on function
  public.audit(text, jsonb), public.notify_user(uuid, text, text, text, jsonb), public.week_budget(date), public.queue_for(text, date),
  public.fill_shift(uuid), public.ledger_account(text, uuid), public.ledger_post(text, jsonb, uuid, text), public.random_code(),
  public.queue_reminders(), public.claim_payouts(int), public.stale_processing_payouts(interval, int),
  public.settle_payout(uuid, text, text, text, int, text), public.claim_notifications(int), public.mark_notification(uuid, text, text),
  public.drop_push_token(text), public.weekly_job(), public.expire_invites(), public.ledger_check_balanced(), public.ledger_immutable()
from authenticated;

grant execute on function
  public.queue_reminders(), public.claim_payouts(int), public.stale_processing_payouts(interval, int),
  public.settle_payout(uuid, text, text, text, int, text), public.claim_notifications(int), public.mark_notification(uuid, text, text),
  public.drop_push_token(text), public.weekly_job(), public.expire_invites(), public.budget_summary(date), public.ledger_balances(),
  public.run_selection(date), public.schedule_week(date)
to service_role;

-- New functions created later should not be exposed by default either.
alter default privileges in schema public revoke execute on functions from public, anon;
