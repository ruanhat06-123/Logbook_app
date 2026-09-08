-- ============================================================================
-- LogMate — Subscription management & user categorization
-- Run this once in the Supabase SQL editor (or via the CLI) on your project.
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE / ON CONFLICT throughout.
-- ============================================================================

-- 1. Enums -------------------------------------------------------------------
do $$ begin
  create type subscription_tier as enum ('free', 'premium', 'fleet_starter', 'fleet_pro');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type payment_status as enum ('active', 'failed', 'pending');
exception when duplicate_object then null;
end $$;

-- 2. public.users — profile + subscription state, keyed to auth.users -------
create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  subscription_tier subscription_tier not null default 'free',
  subscription_expiry_date date,
  payment_status payment_status not null default 'pending',
  billing_cycle text check (billing_cycle in ('monthly', 'annual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_users_updated_at on public.users;
create trigger trg_users_updated_at
before update on public.users
for each row execute function public.set_updated_at();

-- 3. Auto-populate public.users whenever a new auth user signs up -----------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, full_name, subscription_tier, payment_status)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    'free',
    'pending'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- 4. Backfill public.users from any auth.users that already exist ----------
insert into public.users (id, email, full_name, subscription_tier, payment_status)
select u.id, u.email, coalesce(u.raw_user_meta_data ->> 'full_name', ''), 'free', 'pending'
from auth.users u
on conflict (id) do nothing;

-- 5. Row level security on public.users --------------------------------------
alter table public.users enable row level security;

drop policy if exists "Users can view own profile" on public.users;
create policy "Users can view own profile"
  on public.users for select
  using (auth.uid() = id);

-- Clients may only ever touch their own row, and only via the update policy
-- below. Billing columns (subscription_tier / subscription_expiry_date /
-- payment_status) are written exclusively by webhook handlers using the
-- Supabase service role key, which bypasses RLS entirely — authenticated
-- users never have a policy that lets them write those columns themselves.
drop policy if exists "Users can update own profile" on public.users;
create policy "Users can update own profile"
  on public.users for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- 6. Subscription/payment event log (populated by payment webhooks) --------
create table if not exists public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  provider text not null default 'payfast' check (provider in ('payfast')),
  event_type text not null,
  amount numeric(10, 2),
  currency text default 'ZAR',
  raw_payload jsonb,
  created_at timestamptz not null default now()
);

alter table public.subscription_events enable row level security;

drop policy if exists "Users can view own subscription events" on public.subscription_events;
create policy "Users can view own subscription events"
  on public.subscription_events for select
  using (auth.uid() = user_id);
-- No insert/update/delete policy is defined for authenticated users, so only
-- the service role (webhook handler) can write rows here.

-- 7. Helper — is a user's subscription active for a given set of tiers ------
create or replace function public.has_active_subscription(uid uuid, tiers subscription_tier[])
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.users
    where id = uid
      and payment_status = 'active'
      and subscription_tier = any(tiers)
      and (subscription_expiry_date is null or subscription_expiry_date >= current_date)
  );
$$;

-- 8. Database-level safety net for the free tier's 30 trips/month limit -----
-- (in addition to the client-side check — belt and braces).
create or replace function public.enforce_trip_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tier subscription_tier;
  trip_count int;
begin
  select subscription_tier into tier from public.users where id = auth.uid();

  if tier is null or tier = 'free' then
    select count(*) into trip_count
    from public.trips
    where user_id = auth.uid()
      and date_trunc('month', created_at) = date_trunc('month', now());

    if trip_count >= 30 then
      raise exception 'Free tier is limited to 30 trips per month. Upgrade to Premium for unlimited trips.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_trip_quota on public.trips;
create trigger trg_enforce_trip_quota
before insert on public.trips
for each row execute function public.enforce_trip_quota();

-- 9. Auto-downgrade expired/failed subscriptions back to free ---------------
-- Called by the login flow via `select public.downgrade_expired_subscriptions();`
-- (see js/core/subscription.js). Can also be scheduled nightly with pg_cron:
--   select cron.schedule('downgrade-expired-subscriptions', '0 2 * * *',
--     $$select public.downgrade_expired_subscriptions();$$);
create or replace function public.downgrade_expired_subscriptions()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.users
  set subscription_tier = 'free',
      payment_status = 'pending'
  where subscription_tier <> 'free'
    and (
      payment_status = 'failed'
      or (subscription_expiry_date is not null and subscription_expiry_date < current_date - interval '7 days')
    );
end;
$$;

-- 10. Allow authenticated clients to call the downgrade check via RPC -------
grant execute on function public.downgrade_expired_subscriptions() to authenticated;
grant execute on function public.has_active_subscription(uuid, subscription_tier[]) to authenticated;
