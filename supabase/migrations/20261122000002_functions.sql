-- CleanCity: business rules as RPCs. Mirrors logic.js (the demo) so both behave the same.
-- Every app-facing function is SECURITY DEFINER with an explicit role check and a fixed search_path.

-- ---------- helpers ----------
create or replace function public.my_role() returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and not suspended
$$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false)
$$;
-- Service role (Edge Functions) or a database job with no API caller at all (pg_cron, SQL editor).
-- PostgREST always sets a role claim (anon/authenticated/service_role), so app users can never match the second branch.
-- Note: current_user is NOT used, because inside SECURITY DEFINER functions it is always the owner.
create or replace function public.is_service() returns boolean language sql stable as $$
  select coalesce(auth.role() = 'service_role', false) or (auth.role() is null and auth.uid() is null)
$$;

create or replace function public.audit(p_action text, p_details jsonb default '{}') returns void
language sql security definer set search_path = public as $$
  insert into public.audit_log (actor, action, details) values (auth.uid(), p_action, coalesce(p_details, '{}'))
$$;

create or replace function public.notify_user(p_user uuid, p_kind text, p_title text, p_body text, p_data jsonb default '{}') returns void
language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, kind, title, body, data) values (p_user, p_kind, p_title, p_body, coalesce(p_data, '{}'))
$$;

-- Normalises a Cameroon mobile number to 2376XXXXXXXX (or null).
create or replace function public.normalize_phone(p text) returns text language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g');
begin
  if d like '00%' then d := substr(d, 3); end if;
  if length(d) = 9 then d := '237' || d; end if;
  if d ~ '^2376[0-9]{8}$' then return d; end if;
  return null;
end $$;

-- MTN or Orange from the number prefix (same table as logic.js detectOperator).
create or replace function public.detect_operator(p text) returns text language plpgsql immutable as $$
declare n text := public.normalize_phone(p); p2 int; p3 int;
begin
  if n is null then return null; end if;
  p2 := substr(n, 4, 2)::int; p3 := substr(n, 4, 3)::int;
  if p2 = 67 or p3 between 650 and 654 or p3 between 680 and 689 then return 'mtn'; end if;
  if p2 = 69 or p3 between 655 and 659 then return 'orange'; end if;
  return null;
end $$;

create or replace function public.distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

create or replace function public.next_saturday(p_from date default (now() at time zone 'Africa/Douala')::date) returns date
language sql immutable as $$
  select p_from + ((6 - extract(isodow from p_from)::int + 7) % 7)
$$;

create or replace function public.random_code() returns text language sql volatile as $$
  select lpad(floor(random() * 1000000)::int::text, 6, '0')
$$;

-- ---------- budget ----------
create or replace function public.fee_for(p_amount int) returns int language sql stable security definer set search_path = public as $$
  select ceil(p_amount * payout_fee_pct / 100.0)::int from public.settings
$$;

create or replace function public.unit_cost() returns int language sql stable security definer set search_path = public as $$
  select pay_per_person_xaf + case when fees_in_budget then public.fee_for(pay_per_person_xaf) else 0 end from public.settings
$$;

-- People per zone this week: floor(budget / zones / (pay [+ fee])). Defaults → 50000 / 1 / 5000 = 10.
create or replace function public.crew_size() returns int language sql stable security definer set search_path = public as $$
  select greatest(0, floor(weekly_budget_xaf::numeric / zones_per_week / public.unit_cost()))::int from public.settings
$$;

-- Internal (no caller check): used by the selection engine, which may run on a worker's decline.
create or replace function public.week_budget(p_week date)
returns table (budget int, committed int, paid int, fees int, used int, remaining int, crew_size int)
language plpgsql stable security definer set search_path = public as $$
declare s public.settings; c int; p int; f int;
begin
  select * into s from public.settings;
  select coalesce(sum(case when a.status in ('invited', 'confirmed', 'checked_in') then s.pay_per_person_xaf
                           when a.status = 'signed_off' then coalesce(a.pay_xaf, 0) else 0 end), 0)::int
    into c from public.assignments a where a.week = p_week;
  select coalesce(sum(pr.amount_xaf) filter (where pr.status = 'paid'), 0)::int,
         coalesce(sum(pr.fee_xaf) filter (where pr.status = 'paid'), 0)::int
    into p, f from public.payout_requests pr where pr.week = p_week;
  return query select s.weekly_budget_xaf, c, p, f, c + case when s.fees_in_budget then f else 0 end,
    s.weekly_budget_xaf - c - case when s.fees_in_budget then f else 0 end, public.crew_size();
end $$;

create or replace function public.budget_summary(p_week date)
returns table (budget int, committed int, paid int, fees int, used int, remaining int, crew_size int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_service()) then raise exception 'admin only' using errcode = '42501'; end if;
  return query select * from public.week_budget(p_week);
end $$;

-- ---------- fair queue ----------
-- Eligible: consented, available on Saturdays, not suspended, worker role, in the city, not already active this week.
-- Order: never served first (by sign-up time), then least recently served. Serving (or a no-show) sends you to the back.
create or replace function public.queue_for(p_city text, p_week date)
returns table (person_id uuid, pos int)
language sql stable security definer set search_path = public as $$
  select p.id, (row_number() over (order by p.last_served_at nulls first, p.created_at, p.id))::int
  from public.profiles p
  where p.city_id = p_city and p.saturdays and not p.suspended and p.role = 'worker'
    and not exists (select 1 from public.assignments a where a.person_id = p.id and a.week = p_week and a.status not in ('declined', 'expired'))
$$;

create or replace function public.my_queue_position()
returns table (city_id text, pos int, total int, week date)
language plpgsql stable security definer set search_path = public as $$
declare me public.profiles; w date := public.next_saturday();
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null then raise exception 'sign up first' using errcode = 'P0002'; end if;
  return query select me.city_id, (select q.pos from public.queue_for(me.city_id, w) q where q.person_id = me.id),
    (select count(*)::int from public.queue_for(me.city_id, w)), w;
end $$;

-- ---------- sign-up ----------
create or replace function public.sign_up(p_full_name text, p_region text, p_city text, p_quarter text,
  p_saturdays boolean, p_id_number text, p_consent boolean, p_locale text default 'fr')
returns public.profiles language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); ph text; r public.profiles;
begin
  if uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if not coalesce(p_consent, false) then raise exception 'consent is required' using errcode = '22023'; end if;
  select public.normalize_phone(phone) into ph from auth.users where id = uid;
  if ph is null then raise exception 'a Cameroon mobile number (+237 6…) is required' using errcode = '22023'; end if;
  if not exists (select 1 from public.cities where id = p_city and region_id = p_region) then
    raise exception 'city does not belong to region' using errcode = '22023'; end if;
  insert into public.profiles (id, full_name, phone, operator, region_id, city_id, quarter, saturdays, id_number, consent_at, locale)
  values (uid, trim(p_full_name), ph, public.detect_operator(ph), p_region, p_city, trim(p_quarter), coalesce(p_saturdays, true),
          nullif(trim(coalesce(p_id_number, '')), ''), now(), coalesce(p_locale, 'fr'))
  on conflict (id) do update set full_name = excluded.full_name, region_id = excluded.region_id, city_id = excluded.city_id,
    quarter = excluded.quarter, saturdays = excluded.saturdays, id_number = excluded.id_number, locale = excluded.locale
  returning * into r;
  return r;
end $$;

create or replace function public.register_push_token(p_token text, p_platform text) returns void
language sql security definer set search_path = public as $$
  insert into public.push_tokens (token, user_id, platform) values (p_token, auth.uid(), p_platform)
  on conflict (token) do update set user_id = auth.uid(), platform = excluded.platform, updated_at = now()
$$;

-- ---------- scheduling + selection ----------
-- Creates the week's shifts: zones_per_week zones, least recently cleaned first, spread across cities. Idempotent per week.
create or replace function public.schedule_week(p_week date default null)
returns setof public.shifts language plpgsql security definer set search_path = public as $$
declare s public.settings; w date := coalesce(p_week, public.next_saturday()); z record; n int := 0; picked text[] := '{}'; cities text[] := '{}';
  st timestamptz;
begin
  if not (public.is_admin() or public.is_service()) then raise exception 'admin only' using errcode = '42501'; end if;
  if extract(isodow from w) <> 6 then raise exception 'week must be a Saturday' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('cc-week-' || w));
  if exists (select 1 from public.shifts where week = w and status <> 'cancelled') then
    return query select * from public.shifts where week = w order by created_at; return;
  end if;
  select * into s from public.settings;
  st := (w + s.shift_start) at time zone s.timezone;
  -- pass 1: distinct cities; pass 2: fill up if fewer cities than zones wanted
  for z in select * from public.zones where active order by last_scheduled nulls first, rotation, id loop
    exit when n >= s.zones_per_week;
    if not (z.city_id = any (cities)) then picked := picked || z.id; cities := cities || z.city_id; n := n + 1; end if;
  end loop;
  for z in select * from public.zones where active order by last_scheduled nulls first, rotation, id loop
    exit when n >= s.zones_per_week;
    if not (z.id = any (picked)) then picked := picked || z.id; n := n + 1; end if;
  end loop;
  insert into public.shifts (week, zone_id, city_id, starts_at, ends_at, crew_size)
    select w, zz.id, zz.city_id, st, st + make_interval(mins => (s.shift_hours * 60)::int), public.crew_size()
    from public.zones zz where zz.id = any (picked);
  update public.zones set last_scheduled = w where id = any (picked);
  perform public.audit('schedule_week', jsonb_build_object('week', w, 'zones', picked));
  return query select * from public.shifts where week = w order by created_at;
end $$;

-- Invites people from the city queue until the shift is full, never exceeding the weekly budget.
create or replace function public.fill_shift(p_shift uuid) returns int
language plpgsql security definer set search_path = public as $$
declare sh public.shifts; s public.settings; need int; remaining int; unit int; deadline timestamptz; q record; invited int := 0; z public.zones;
begin
  select * into sh from public.shifts where id = p_shift for update;
  if sh.id is null or sh.status not in ('scheduled', 'in_progress') then return 0; end if;
  if sh.starts_at <= now() then return 0; end if;
  perform pg_advisory_xact_lock(hashtext('cc-week-' || sh.week));
  select * into s from public.settings;
  select * into z from public.zones where id = sh.zone_id;
  unit := public.unit_cost();
  need := sh.crew_size - (select count(*) from public.assignments where shift_id = sh.id and status not in ('declined', 'expired'));
  select b.remaining into remaining from public.week_budget(sh.week) b;
  deadline := least(now() + make_interval(hours => s.confirm_hours), sh.starts_at - interval '12 hours');
  if deadline <= now() then deadline := least(now() + interval '1 hour', sh.starts_at); end if;
  for q in select qf.person_id from public.queue_for(sh.city_id, sh.week) qf
           where not exists (select 1 from public.assignments a where a.shift_id = sh.id and a.person_id = qf.person_id)
           order by qf.pos loop
    exit when invited >= need or remaining < unit;
    insert into public.assignments (shift_id, week, person_id, confirm_by, code)
      values (sh.id, sh.week, q.person_id, deadline,
              (select c from (select public.random_code() c from generate_series(1, 20)) x
                where not exists (select 1 from public.assignments a where a.shift_id = sh.id and a.code = x.c) limit 1));
    perform public.notify_user(q.person_id, 'invited', 'Ville Propre / CleanCity',
      format('Samedi %s, %s : confirmez avant %s. / Saturday %s, %s: confirm before %s.',
        to_char(sh.week, 'DD/MM'), z.name, to_char(deadline at time zone s.timezone, 'DD/MM HH24:MI'),
        to_char(sh.week, 'DD/MM'), z.name, to_char(deadline at time zone s.timezone, 'DD/MM HH24:MI')),
      jsonb_build_object('shift_id', sh.id));
    invited := invited + 1; remaining := remaining - unit;
  end loop;
  if invited > 0 then perform public.audit('fill_shift', jsonb_build_object('shift', sh.id, 'invited', invited)); end if;
  return invited;
end $$;

create or replace function public.run_selection(p_week date default null) returns int
language plpgsql security definer set search_path = public as $$
declare w date := coalesce(p_week, public.next_saturday()); sid uuid; total int := 0;
begin
  if not (public.is_admin() or public.is_service()) then raise exception 'admin only' using errcode = '42501'; end if;
  for sid in select id from public.shifts where week = w and status = 'scheduled' order by created_at loop
    total := total + public.fill_shift(sid);
  end loop;
  return total;
end $$;

-- Expires missed deadlines and invites the next people in line. Run every 15 minutes by pg_cron.
create or replace function public.expire_invites() returns int
language plpgsql security definer set search_path = public as $$
declare n int; sid uuid;
begin
  if not (public.is_admin() or public.is_service()) then raise exception 'admin only' using errcode = '42501'; end if;
  with x as (update public.assignments set status = 'expired' where status = 'invited' and confirm_by < now() returning shift_id)
  select count(*) into n from x;
  for sid in select distinct a.shift_id from public.assignments a join public.shifts s on s.id = a.shift_id
             where s.status = 'scheduled' and s.starts_at > now() loop
    perform public.fill_shift(sid);
  end loop;
  return n;
end $$;

-- Weekly job (pg_cron, Monday 08:00 Douala): schedule next Saturday and run the selection.
create or replace function public.weekly_job() returns int
language plpgsql security definer set search_path = public as $$
begin
  perform public.schedule_week(public.next_saturday());
  return public.run_selection(public.next_saturday());
end $$;

-- Friday reminder for confirmed workers (pg_cron).
create or replace function public.queue_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare a record; n int := 0; s public.settings;
begin
  if not public.is_service() then raise exception 'service only' using errcode = '42501'; end if;
  select * into s from public.settings;
  for a in select x.id, x.person_id, x.code, sh.starts_at, z.name, z.meet from public.assignments x
           join public.shifts sh on sh.id = x.shift_id join public.zones z on z.id = sh.zone_id
           where x.status = 'confirmed' and x.reminded_at is null and sh.starts_at between now() and now() + interval '36 hours' loop
    perform public.notify_user(a.person_id, 'reminder', 'Ville Propre / CleanCity',
      format('Demain %s, %s (%s). Gants, gilet et chaussures fermées fournis/obligatoires. / Tomorrow %s, %s (%s).',
        to_char(a.starts_at at time zone s.timezone, 'HH24:MI'), a.name, a.meet, to_char(a.starts_at at time zone s.timezone, 'HH24:MI'), a.name, a.meet),
      jsonb_build_object('assignment_id', a.id));
    update public.assignments set reminded_at = now() where id = a.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- worker actions ----------
create or replace function public.respond_invite(p_assignment uuid, p_accept boolean) returns public.assignments
language plpgsql security definer set search_path = public as $$
declare a public.assignments;
begin
  select * into a from public.assignments where id = p_assignment and person_id = auth.uid() for update;
  if a.id is null then raise exception 'invitation not found' using errcode = 'P0002'; end if;
  if a.status <> 'invited' then raise exception 'invitation already answered' using errcode = '55000'; end if;
  if a.confirm_by < now() then
    update public.assignments set status = 'expired' where id = a.id;
    raise exception 'the deadline has passed' using errcode = '55000';
  end if;
  update public.assignments set status = case when p_accept then 'confirmed' else 'declined' end, responded_at = now()
    where id = a.id returning * into a;
  if not p_accept then perform public.fill_shift(a.shift_id); end if;
  return a;
end $$;

-- ---------- supervisor actions ----------
create or replace function public.can_supervise(p_shift uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (select 1 from public.shifts where id = p_shift and supervisor_id = auth.uid() and public.my_role() = 'supervisor')
$$;

create or replace function public.assign_supervisor(p_shift uuid, p_supervisor uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = p_supervisor and role = 'supervisor' and not suspended) then
    raise exception 'not a supervisor' using errcode = '22023'; end if;
  update public.shifts set supervisor_id = p_supervisor where id = p_shift;
  perform public.audit('assign_supervisor', jsonb_build_object('shift', p_shift, 'supervisor', p_supervisor));
end $$;

create or replace function public.record_safety_briefing(p_shift uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_supervise(p_shift) then raise exception 'not your shift' using errcode = '42501'; end if;
  update public.shifts set safety_briefing_at = coalesce(safety_briefing_at, now()), status = 'in_progress' where id = p_shift and status <> 'completed';
end $$;

-- Check-in needs the worker's code (typed or scanned from their QR) AND the supervisor's phone GPS near the meeting point.
create or replace function public.check_in(p_shift uuid, p_code text, p_lat double precision, p_lng double precision, p_method text default 'code')
returns public.assignments language plpgsql security definer set search_path = public as $$
declare sh public.shifts; z public.zones; s public.settings; a public.assignments; d int;
begin
  if not public.can_supervise(p_shift) then raise exception 'not your shift' using errcode = '42501'; end if;
  select * into sh from public.shifts where id = p_shift;
  select * into z from public.zones where id = sh.zone_id;
  select * into s from public.settings;
  if sh.status = 'completed' then raise exception 'shift already completed' using errcode = '55000'; end if;
  if now() < sh.starts_at - interval '1 hour' or now() > sh.ends_at then raise exception 'check-in is only open from 1 h before the start until the end of the shift' using errcode = '55000'; end if;
  d := round(public.distance_m(p_lat, p_lng, z.lat, z.lng));
  if d > s.checkin_radius_m then raise exception 'too far from the meeting point (% m > % m)', d, s.checkin_radius_m using errcode = '22023'; end if;
  select * into a from public.assignments where shift_id = p_shift and code = p_code for update;
  if a.id is null then raise exception 'code not found in this crew' using errcode = 'P0002'; end if;
  if a.status = 'checked_in' then raise exception 'already checked in' using errcode = '55000'; end if;
  if a.status <> 'confirmed' then raise exception 'this person has not confirmed' using errcode = '55000'; end if;
  update public.assignments set status = 'checked_in', checkin_at = now(), checkin_lat = p_lat, checkin_lng = p_lng, checkin_dist_m = d,
    checkin_method = case when p_method = 'qr' then 'qr' else 'code' end where id = a.id returning * into a;
  update public.shifts set status = 'in_progress' where id = p_shift and status = 'scheduled';
  return a;
end $$;

create or replace function public.check_out(p_assignment uuid, p_lat double precision, p_lng double precision) returns void
language plpgsql security definer set search_path = public as $$
declare a public.assignments; z public.zones;
begin
  select * into a from public.assignments where id = p_assignment for update;
  if a.id is null or not public.can_supervise(a.shift_id) then raise exception 'not your shift' using errcode = '42501'; end if;
  if a.status <> 'checked_in' then raise exception 'not checked in' using errcode = '55000'; end if;
  select z2.* into z from public.zones z2 join public.shifts s on s.zone_id = z2.id where s.id = a.shift_id;
  update public.assignments set checkout_at = now(), checkout_dist_m = round(public.distance_m(p_lat, p_lng, z.lat, z.lng)) where id = a.id;
end $$;

create or replace function public.pay_for(p_outcome text, p_hours numeric) returns int
language sql stable security definer set search_path = public as $$
  select case p_outcome
    when 'full' then pay_per_person_xaf
    when 'partial' then (floor(pay_per_person_xaf * least(shift_hours, greatest(0, coalesce(p_hours, 0))) / shift_hours / partial_round_xaf) * partial_round_xaf)::int
    else 0 end
  from public.settings
$$;

create or replace function public.ledger_account(p_kind text, p_owner uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  select id into v from public.ledger_accounts where kind = p_kind and owner_id is not distinct from p_owner;
  if v is null then
    insert into public.ledger_accounts (kind, owner_id) values (p_kind, p_owner) on conflict do nothing returning id into v;
    if v is null then select id into v from public.ledger_accounts where kind = p_kind and owner_id is not distinct from p_owner; end if;
  end if;
  return v;
end $$;

-- p_entries: [{"account": uuid, "amount": int}, ...] summing to zero.
create or replace function public.ledger_post(p_kind text, p_entries jsonb, p_payout uuid default null, p_memo text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare tx uuid; e jsonb;
begin
  insert into public.ledger_transactions (kind, payout_id, memo, created_by) values (p_kind, p_payout, p_memo, auth.uid())
    on conflict (kind, payout_id) where payout_id is not null do nothing returning id into tx;
  if tx is null then return null; end if; -- already posted (idempotent)
  for e in select * from jsonb_array_elements(p_entries) loop
    if (e->>'amount')::bigint <> 0 then
      insert into public.ledger_entries (transaction_id, account_id, amount_xaf) values (tx, (e->>'account')::uuid, (e->>'amount')::bigint);
    end if;
  end loop;
  return tx;
end $$;

-- Supervisor sign-off: full / partial (pro rata) / absent. Creates the payout request and accrues the wage.
create or replace function public.sign_off(p_assignment uuid, p_outcome text, p_hours numeric default null, p_notes text default null)
returns public.assignments language plpgsql security definer set search_path = public as $$
declare a public.assignments; s public.settings; pay int; h numeric; p public.profiles; pr uuid;
begin
  select * into a from public.assignments where id = p_assignment for update;
  if a.id is null or not public.can_supervise(a.shift_id) then raise exception 'not your shift' using errcode = '42501'; end if;
  if a.person_id = auth.uid() then raise exception 'you cannot sign yourself off' using errcode = '42501'; end if;
  if p_outcome not in ('full', 'partial', 'absent') then raise exception 'invalid outcome' using errcode = '22023'; end if;
  if a.status = 'signed_off' then raise exception 'already signed off' using errcode = '55000'; end if;
  if p_outcome <> 'absent' and a.status <> 'checked_in' then raise exception 'only checked-in workers can be paid' using errcode = '55000'; end if;
  if a.status not in ('confirmed', 'checked_in') then raise exception 'not part of the crew' using errcode = '55000'; end if;
  select * into s from public.settings;
  h := case p_outcome when 'full' then s.shift_hours when 'absent' then 0 else least(s.shift_hours, greatest(0, coalesce(p_hours, 0))) end;
  pay := public.pay_for(p_outcome, h);
  update public.assignments set status = 'signed_off', outcome = p_outcome, hours = h, pay_xaf = pay, notes = nullif(trim(coalesce(p_notes, '')), ''),
    signed_off_by = auth.uid(), signed_off_at = now() where id = a.id returning * into a;
  update public.profiles set last_served_at = now(), served_count = served_count + case when p_outcome = 'absent' then 0 else 1 end where id = a.person_id;
  if pay > 0 then
    select * into p from public.profiles where id = a.person_id;
    insert into public.payout_requests (id, assignment_id, person_id, week, amount_xaf, phone, operator, reference)
      values (gen_random_uuid(), a.id, a.person_id, a.week, pay, p.phone, coalesce(p.operator, public.detect_operator(p.phone), 'mtn'), 'cc-' || a.id)
      returning id into pr;
    perform public.ledger_post('wage_accrued', jsonb_build_array(
      jsonb_build_object('account', public.ledger_account('wages_expense'), 'amount', pay),
      jsonb_build_object('account', public.ledger_account('worker_payable', a.person_id), 'amount', -pay)), pr, 'sign-off ' || a.id);
  end if;
  perform public.audit('sign_off', jsonb_build_object('assignment', a.id, 'outcome', p_outcome, 'pay', pay));
  return a;
end $$;

create or replace function public.add_shift_photo(p_shift uuid, p_kind text, p_path text, p_lat double precision default null, p_lng double precision default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not public.can_supervise(p_shift) then raise exception 'not your shift' using errcode = '42501'; end if;
  if p_path !~ ('^shifts/' || p_shift || '/') then raise exception 'photo must be stored under shifts/<shift id>/' using errcode = '22023'; end if;
  insert into public.shift_photos (shift_id, kind, storage_path, lat, lng, taken_by) values (p_shift, p_kind, p_path, p_lat, p_lng, auth.uid()) returning id into v;
  return v;
end $$;

create or replace function public.complete_shift(p_shift uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_supervise(p_shift) then raise exception 'not your shift' using errcode = '42501'; end if;
  if exists (select 1 from public.assignments where shift_id = p_shift and status in ('invited', 'confirmed', 'checked_in')) then
    raise exception 'sign off every worker first' using errcode = '55000'; end if;
  if not exists (select 1 from public.shift_photos where shift_id = p_shift and kind = 'before')
     or not exists (select 1 from public.shift_photos where shift_id = p_shift and kind = 'after') then
    raise exception 'add at least one before and one after photo' using errcode = '55000'; end if;
  update public.shifts set status = 'completed', completed_at = now() where id = p_shift;
  perform public.audit('complete_shift', jsonb_build_object('shift', p_shift));
end $$;

-- ---------- admin ----------
create or replace function public.update_settings(p jsonb) returns public.settings
language plpgsql security definer set search_path = public as $$
declare r public.settings;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  update public.settings set
    weekly_budget_xaf = coalesce((p->>'weekly_budget_xaf')::int, weekly_budget_xaf),
    pay_per_person_xaf = coalesce((p->>'pay_per_person_xaf')::int, pay_per_person_xaf),
    zones_per_week = coalesce((p->>'zones_per_week')::int, zones_per_week),
    shift_start = coalesce((p->>'shift_start')::time, shift_start),
    shift_hours = coalesce((p->>'shift_hours')::numeric, shift_hours),
    confirm_hours = coalesce((p->>'confirm_hours')::int, confirm_hours),
    checkin_radius_m = coalesce((p->>'checkin_radius_m')::int, checkin_radius_m),
    payout_fee_pct = coalesce((p->>'payout_fee_pct')::numeric, payout_fee_pct),
    fees_in_budget = coalesce((p->>'fees_in_budget')::boolean, fees_in_budget),
    partial_round_xaf = coalesce((p->>'partial_round_xaf')::int, partial_round_xaf),
    updated_at = now(), updated_by = auth.uid()
  returning * into r;
  perform public.audit('update_settings', p || jsonb_build_object('crew_size', public.crew_size()));
  return r;
end $$;

create or replace function public.upsert_zone(p_id text, p_city text, p_name text, p_meet text, p_lat double precision, p_lng double precision,
  p_rotation int default 0, p_active boolean default true, p_quarters text[] default '{}') returns text
language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  insert into public.zones (id, city_id, name, meet, lat, lng, rotation, active, quarters)
    values (coalesce(p_id, gen_random_uuid()::text), p_city, p_name, p_meet, p_lat, p_lng, p_rotation, p_active, p_quarters)
  on conflict (id) do update set city_id = excluded.city_id, name = excluded.name, meet = excluded.meet, lat = excluded.lat, lng = excluded.lng,
    rotation = excluded.rotation, active = excluded.active, quarters = excluded.quarters
  returning id into v;
  perform public.audit('upsert_zone', jsonb_build_object('zone', v));
  return v;
end $$;

create or replace function public.set_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'you cannot change your own role' using errcode = '42501'; end if;
  update public.profiles set role = p_role where id = p_user;
  perform public.audit('set_role', jsonb_build_object('user', p_user, 'role', p_role));
end $$;

create or replace function public.set_suspended(p_user uuid, p_suspended boolean, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  update public.profiles set suspended = p_suspended where id = p_user;
  perform public.audit('set_suspended', jsonb_build_object('user', p_user, 'suspended', p_suspended, 'reason', p_reason));
end $$;

-- Separation of duties: whoever signed the worker off cannot approve that payout.
create or replace function public.approve_payout(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pr public.payout_requests;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into pr from public.payout_requests where id = p_id for update;
  if pr.id is null then raise exception 'payout not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.assignments where id = pr.assignment_id and signed_off_by = auth.uid()) then
    raise exception 'the person who signed off a worker cannot approve that payout' using errcode = '42501'; end if;
  if pr.status = 'failed' then
    update public.payout_requests set status = 'approved', failure_reason = null where id = p_id;
  elsif pr.status = 'awaiting_approval' then
    update public.payout_requests set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_id;
  else
    raise exception 'payout is already %', pr.status using errcode = '55000';
  end if;
  perform public.audit('approve_payout', jsonb_build_object('payout', p_id, 'amount', pr.amount_xaf));
end $$;

-- Admin records money added to the merchant balance (sponsor, council, diaspora...).
create or replace function public.record_funding(p_amount int, p_memo text) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_amount <= 0 then raise exception 'amount must be positive' using errcode = '22023'; end if;
  perform public.audit('record_funding', jsonb_build_object('amount', p_amount, 'memo', p_memo));
  return public.ledger_post('funding', jsonb_build_array(
    jsonb_build_object('account', public.ledger_account('merchant_balance'), 'amount', p_amount),
    jsonb_build_object('account', public.ledger_account('funding'), 'amount', -p_amount)), null, p_memo);
end $$;

-- ---------- payout processing (service role only: payouts-process Edge Function) ----------
create or replace function public.claim_payouts(p_limit int default 20) returns setof public.payout_requests
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_service() then raise exception 'service only' using errcode = '42501'; end if;
  return query
  update public.payout_requests pr set status = 'processing', attempts = attempts + 1, last_attempt_at = now()
  where pr.id in (select id from public.payout_requests where status = 'approved' order by approved_at nulls last, created_at limit p_limit for update skip locked)
  returning pr.*;
end $$;

create or replace function public.stale_processing_payouts(p_older_than interval default interval '2 minutes', p_limit int default 50)
returns setof public.payout_requests language plpgsql security definer set search_path = public as $$
begin
  if not public.is_service() then raise exception 'service only' using errcode = '42501'; end if;
  return query select * from public.payout_requests where status = 'processing' and last_attempt_at < now() - p_older_than order by last_attempt_at limit p_limit;
end $$;

-- Idempotent: settling a paid payout twice posts the ledger once.
create or replace function public.settle_payout(p_id uuid, p_status text, p_provider text, p_provider_ref text, p_fee int default null, p_reason text default null)
returns public.payout_requests language plpgsql security definer set search_path = public as $$
declare pr public.payout_requests; fee int;
begin
  if not public.is_service() then raise exception 'service only' using errcode = '42501'; end if;
  select * into pr from public.payout_requests where id = p_id for update;
  if pr.id is null then raise exception 'payout not found' using errcode = 'P0002'; end if;
  if pr.status = 'paid' then return pr; end if;
  if p_status = 'processing' then
    update public.payout_requests set provider = p_provider, provider_ref = coalesce(p_provider_ref, provider_ref) where id = p_id returning * into pr;
  elsif p_status = 'failed' then
    update public.payout_requests set status = 'failed', provider = p_provider, provider_ref = coalesce(p_provider_ref, provider_ref),
      failure_reason = left(coalesce(p_reason, 'failed'), 300) where id = p_id returning * into pr;
    perform public.notify_user(pr.person_id, 'payout_failed', 'Ville Propre / CleanCity',
      'Votre paiement est retardé ; un administrateur va le relancer. / Your payment is delayed; an admin will retry it.', jsonb_build_object('payout_id', pr.id));
  elsif p_status = 'paid' then
    fee := coalesce(p_fee, public.fee_for(pr.amount_xaf));
    update public.payout_requests set status = 'paid', provider = p_provider, provider_ref = coalesce(p_provider_ref, provider_ref),
      fee_xaf = fee, paid_at = now(), failure_reason = null where id = p_id returning * into pr;
    perform public.ledger_post('payout_sent', jsonb_build_array(
      jsonb_build_object('account', public.ledger_account('worker_payable', pr.person_id), 'amount', pr.amount_xaf),
      jsonb_build_object('account', public.ledger_account('merchant_balance'), 'amount', -pr.amount_xaf)), pr.id, pr.reference);
    if fee > 0 then
      perform public.ledger_post('payout_fee', jsonb_build_array(
        jsonb_build_object('account', public.ledger_account('fees_expense'), 'amount', fee),
        jsonb_build_object('account', public.ledger_account('merchant_balance'), 'amount', -fee)), pr.id, pr.reference);
    end if;
    perform public.notify_user(pr.person_id, 'paid', 'Ville Propre / CleanCity',
      format('%s FCFA envoyés sur votre %s. Merci ! / %s FCFA sent to your %s. Thank you!', pr.amount_xaf,
        case pr.operator when 'mtn' then 'MTN MoMo' else 'Orange Money' end, pr.amount_xaf, case pr.operator when 'mtn' then 'MTN MoMo' else 'Orange Money' end),
      jsonb_build_object('payout_id', pr.id));
  else
    raise exception 'invalid status %', p_status using errcode = '22023';
  end if;
  return pr;
end $$;

create or replace function public.ledger_balances() returns table (kind text, owner_id uuid, balance_xaf bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_service()) then raise exception 'admin only' using errcode = '42501'; end if;
  return query select la.kind, la.owner_id, coalesce(sum(le.amount_xaf), 0)::bigint from public.ledger_accounts la
    left join public.ledger_entries le on le.account_id = la.id group by la.id order by la.kind;
end $$;

-- ---------- notifications (service role only: notify Edge Function) ----------
create or replace function public.claim_notifications(p_limit int default 100)
returns table (id uuid, user_id uuid, title text, body text, data jsonb, tokens text[])
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_service() then raise exception 'service only' using errcode = '42501'; end if;
  return query
  with c as (
    update public.notifications n set attempts = attempts + 1
    where n.id in (select x.id from public.notifications x where x.status = 'pending' and x.attempts < 5 order by x.created_at limit p_limit for update skip locked)
    returning n.*)
  select c.id, c.user_id, c.title, c.body, c.data, coalesce((select array_agg(t.token) from public.push_tokens t where t.user_id = c.user_id), '{}') from c;
end $$;

create or replace function public.mark_notification(p_id uuid, p_status text, p_error text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_service() then raise exception 'service only' using errcode = '42501'; end if;
  update public.notifications set status = p_status, error = left(p_error, 300), sent_at = case when p_status = 'sent' then now() end where id = p_id;
end $$;

create or replace function public.drop_push_token(p_token text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_service() then raise exception 'service only' using errcode = '42501'; end if;
  delete from public.push_tokens where token = p_token;
end $$;
