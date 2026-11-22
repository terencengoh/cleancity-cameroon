-- CleanCity Cameroon / Ville Propre Cameroun: core schema.
-- Money is integer FCFA (XAF). Times are timestamptz; shifts are scheduled in Africa/Douala local time.
-- All writes from the apps go through SECURITY DEFINER RPCs (migration 2); tables are read through RLS (migration 3).

-- ---------- geography ----------
create table public.regions (
  id text primary key,
  name_en text not null,
  name_fr text not null
);

create table public.cities (
  id text primary key,
  region_id text not null references public.regions(id),
  name text not null,
  lat double precision not null check (lat between 1.6 and 13.1),
  lng double precision not null check (lng between 8.4 and 16.2),
  quarters text[] not null default '{}'
);
create index cities_region_idx on public.cities (region_id);

-- A zone is the portion of a city cleaned in one Saturday shift.
create table public.zones (
  id text primary key default gen_random_uuid()::text,
  city_id text not null references public.cities(id),
  name text not null check (length(name) between 2 and 80),
  quarters text[] not null default '{}',
  meet text not null check (length(meet) between 2 and 120),
  lat double precision not null check (lat between 1.6 and 13.1),
  lng double precision not null check (lng between 8.4 and 16.2),
  rotation int not null default 0,
  active boolean not null default true,
  last_scheduled date
);
create index zones_city_idx on public.zones (city_id);

-- ---------- settings (single row, admin-configurable) ----------
-- Defaults confirmed by the project owner: 50,000 FCFA per week, 5,000 FCFA per person, 1 zone per week → crew of 10.
create table public.settings (
  id boolean primary key default true check (id),
  weekly_budget_xaf int not null default 50000 check (weekly_budget_xaf >= 0),
  pay_per_person_xaf int not null default 5000 check (pay_per_person_xaf > 0),
  zones_per_week int not null default 1 check (zones_per_week between 1 and 50),
  shift_start time not null default '07:00',
  shift_hours numeric(4,1) not null default 4 check (shift_hours > 0 and shift_hours <= 8),
  confirm_hours int not null default 48 check (confirm_hours between 1 and 168),
  checkin_radius_m int not null default 300 check (checkin_radius_m between 50 and 5000),
  payout_fee_pct numeric(5,2) not null default 1.5 check (payout_fee_pct >= 0 and payout_fee_pct < 20),
  fees_in_budget boolean not null default false,
  partial_round_xaf int not null default 500 check (partial_round_xaf > 0),
  timezone text not null default 'Africa/Douala',
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- ---------- people ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'worker' check (role in ('worker', 'supervisor', 'admin')),
  full_name text not null check (length(full_name) between 2 and 80),
  phone text not null unique check (phone ~ '^2376[0-9]{8}$'),
  operator text check (operator in ('mtn', 'orange')),
  region_id text not null references public.regions(id),
  city_id text not null references public.cities(id),
  quarter text not null check (length(quarter) between 1 and 80),
  saturdays boolean not null default true,
  id_number text check (id_number is null or length(id_number) <= 30),
  id_verified_at timestamptz,
  consent_at timestamptz not null,
  locale text not null default 'fr' check (locale in ('fr', 'en')),
  last_served_at timestamptz,
  served_count int not null default 0,
  suspended boolean not null default false,
  created_at timestamptz not null default now()
);
-- The fair queue reads this index: city, then never-served first, then least recently served, then sign-up time.
create index profiles_queue_idx on public.profiles (city_id, last_served_at nulls first, created_at);

-- ---------- weeks, shifts, assignments ----------
create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  week date not null check (extract(isodow from week) = 6), -- always a Saturday
  zone_id text not null references public.zones(id),
  city_id text not null references public.cities(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  crew_size int not null check (crew_size >= 0),
  supervisor_id uuid references public.profiles(id),
  status text not null default 'scheduled' check (status in ('scheduled', 'in_progress', 'completed', 'cancelled')),
  safety_briefing_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (week, zone_id)
);
create index shifts_week_idx on public.shifts (week);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id) on delete cascade,
  week date not null,
  person_id uuid not null references public.profiles(id),
  status text not null default 'invited'
    check (status in ('invited', 'confirmed', 'declined', 'expired', 'checked_in', 'signed_off')),
  invited_at timestamptz not null default now(),
  confirm_by timestamptz not null,
  responded_at timestamptz,
  reminded_at timestamptz,
  code text not null check (code ~ '^[0-9]{6}$'),
  checkin_at timestamptz,
  checkin_lat double precision,
  checkin_lng double precision,
  checkin_dist_m int,
  checkin_method text check (checkin_method in ('qr', 'code')),
  checkout_at timestamptz,
  checkout_dist_m int,
  outcome text check (outcome in ('full', 'partial', 'absent')),
  hours numeric(4,1),
  pay_xaf int check (pay_xaf >= 0),
  notes text check (notes is null or length(notes) <= 500),
  signed_off_by uuid references public.profiles(id),
  signed_off_at timestamptz,
  unique (shift_id, person_id),
  unique (shift_id, code)
);
-- One active shift per person per week (declined/expired invitations don't count).
create unique index assignments_one_per_week on public.assignments (week, person_id) where status not in ('declined', 'expired');
create index assignments_shift_idx on public.assignments (shift_id, status);
create index assignments_person_idx on public.assignments (person_id, invited_at desc);
create index assignments_deadline_idx on public.assignments (confirm_by) where status = 'invited';

create table public.shift_photos (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id) on delete cascade,
  kind text not null check (kind in ('before', 'after')),
  storage_path text not null,
  lat double precision,
  lng double precision,
  taken_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index shift_photos_shift_idx on public.shift_photos (shift_id);

-- ---------- payouts + double-entry ledger ----------
create table public.payout_requests (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null unique references public.assignments(id), -- one payout per sign-off
  person_id uuid not null references public.profiles(id),
  week date not null,
  amount_xaf int not null check (amount_xaf > 0),
  phone text not null check (phone ~ '^2376[0-9]{8}$'),
  operator text not null check (operator in ('mtn', 'orange')),
  reference text not null unique, -- idempotency key sent to the provider: 'cc-<uuid>'
  status text not null default 'awaiting_approval'
    check (status in ('awaiting_approval', 'approved', 'processing', 'paid', 'failed')),
  provider text,
  provider_ref text,
  fee_xaf int not null default 0 check (fee_xaf >= 0),
  failure_reason text,
  attempts int not null default 0,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  last_attempt_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index payout_requests_status_idx on public.payout_requests (status, created_at);
create index payout_requests_person_idx on public.payout_requests (person_id, created_at desc);

create table public.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('funding', 'merchant_balance', 'wages_expense', 'fees_expense', 'worker_payable')),
  owner_id uuid references public.profiles(id),
  constraint ledger_accounts_owner check ((kind = 'worker_payable') = (owner_id is not null))
);
create unique index ledger_accounts_uq on public.ledger_accounts (kind, owner_id) nulls not distinct;

create table public.ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('funding', 'wage_accrued', 'payout_sent', 'payout_fee')),
  payout_id uuid references public.payout_requests(id),
  memo text,
  created_by uuid,
  created_at timestamptz not null default now()
);
-- Idempotency: each payout can be accrued, sent and charged a fee at most once.
create unique index ledger_tx_payout_uq on public.ledger_transactions (kind, payout_id) where payout_id is not null;

create table public.ledger_entries (
  id bigint generated always as identity primary key,
  transaction_id uuid not null references public.ledger_transactions(id),
  account_id uuid not null references public.ledger_accounts(id),
  amount_xaf bigint not null check (amount_xaf <> 0), -- debits positive, credits negative; each transaction sums to 0
  created_at timestamptz not null default now()
);
create index ledger_entries_account_idx on public.ledger_entries (account_id);
create index ledger_entries_tx_idx on public.ledger_entries (transaction_id);

create or replace function public.ledger_check_balanced() returns trigger language plpgsql as $$
declare s bigint;
begin
  select coalesce(sum(amount_xaf), 0) into s from public.ledger_entries where transaction_id = new.transaction_id;
  if s <> 0 then raise exception 'ledger transaction % is unbalanced by %', new.transaction_id, s using errcode = '23514'; end if;
  return null;
end $$;
create constraint trigger ledger_entries_balanced after insert on public.ledger_entries
  deferrable initially deferred for each row execute function public.ledger_check_balanced();

create or replace function public.ledger_immutable() returns trigger language plpgsql as $$
begin raise exception 'the ledger is append-only' using errcode = '55000'; end $$;
create trigger ledger_entries_immutable before update or delete on public.ledger_entries for each row execute function public.ledger_immutable();
create trigger ledger_transactions_immutable before update or delete on public.ledger_transactions for each row execute function public.ledger_immutable();

-- ---------- audit, push, notifications ----------
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor uuid,
  action text not null,
  details jsonb not null default '{}',
  at timestamptz not null default now()
);
create index audit_log_at_idx on public.audit_log (at desc);

create table public.push_tokens (
  token text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  platform text check (platform in ('ios', 'android', 'web')),
  updated_at timestamptz not null default now()
);
create index push_tokens_user_idx on public.push_tokens (user_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'no_token')),
  attempts int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index notifications_pending_idx on public.notifications (created_at) where status = 'pending';
create index notifications_user_idx on public.notifications (user_id, created_at desc);
