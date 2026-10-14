begin;

alter table public.vehicles
  add column if not exists tax_cost_basis_rand numeric(12, 2),
  add column if not exists tax_purchase_date date,
  add column if not exists tax_asset_category text,
  add column if not exists tax_useful_life_years numeric(4, 2),
  add column if not exists tax_business_use_percent numeric(5, 2),
  add column if not exists tax_maintenance_plan boolean not null default false,
  add column if not exists service_warning_mileage numeric(12, 1),
  add column if not exists service_warning_date date,
  add column if not exists service_predicted_date date,
  add column if not exists service_forecast_km_per_day numeric(8, 2),
  add column if not exists service_forecast_computed_at timestamptz;

alter table public.vehicles
  drop constraint if exists vehicles_tax_cost_basis_nonnegative,
  add constraint vehicles_tax_cost_basis_nonnegative
    check (tax_cost_basis_rand is null or tax_cost_basis_rand >= 0),
  drop constraint if exists vehicles_tax_useful_life_positive,
  add constraint vehicles_tax_useful_life_positive
    check (tax_useful_life_years is null or tax_useful_life_years > 0),
  drop constraint if exists vehicles_tax_business_use_range,
  add constraint vehicles_tax_business_use_range
    check (tax_business_use_percent is null or tax_business_use_percent between 0 and 100),
  drop constraint if exists vehicles_service_forecast_km_per_day_nonnegative,
  add constraint vehicles_service_forecast_km_per_day_nonnegative
    check (service_forecast_km_per_day is null or service_forecast_km_per_day >= 0);

alter table public.trips
  add column if not exists driver_safety_score smallint,
  add column if not exists driver_safety_event_count integer,
  add column if not exists driver_safety_event_counts jsonb,
  add column if not exists driver_safety_data_quality text;

alter table public.trips
  drop constraint if exists trips_driver_safety_score_range,
  add constraint trips_driver_safety_score_range
    check (driver_safety_score is null or driver_safety_score between 0 and 100),
  drop constraint if exists trips_driver_safety_event_count_nonnegative,
  add constraint trips_driver_safety_event_count_nonnegative
    check (driver_safety_event_count is null or driver_safety_event_count >= 0),
  drop constraint if exists trips_driver_safety_event_counts_object,
  add constraint trips_driver_safety_event_counts_object
    check (driver_safety_event_counts is null or jsonb_typeof(driver_safety_event_counts) = 'object'),
  drop constraint if exists trips_driver_safety_data_quality_valid,
  add constraint trips_driver_safety_data_quality_valid
    check (driver_safety_data_quality is null or driver_safety_data_quality in ('good', 'limited', 'insufficient'));

create table if not exists public.vehicle_tax_calculations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  tax_year text not null,
  rules_version text not null,
  calculation_type text not null
    check (calculation_type in ('wear_and_tear', 'travel_allowance', 'fringe_benefit', 'comparison')),
  inputs jsonb not null default '{}'::jsonb
    check (jsonb_typeof(inputs) = 'object'),
  result jsonb not null
    check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  constraint vehicle_tax_calculations_user_vehicle_year_type_key
    unique (user_id, vehicle_id, tax_year, calculation_type)
);

create index if not exists vehicle_tax_calculations_vehicle_year_idx
  on public.vehicle_tax_calculations (vehicle_id, tax_year desc);

alter table public.vehicle_tax_calculations enable row level security;

drop policy if exists vehicle_tax_calculations_select_own
  on public.vehicle_tax_calculations;
create policy vehicle_tax_calculations_select_own
  on public.vehicle_tax_calculations
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists vehicle_tax_calculations_insert_own
  on public.vehicle_tax_calculations;
create policy vehicle_tax_calculations_insert_own
  on public.vehicle_tax_calculations
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.vehicles vehicle
      where vehicle.id = vehicle_id
        and vehicle.user_id = (select auth.uid())
    )
  );

drop policy if exists vehicle_tax_calculations_update_own
  on public.vehicle_tax_calculations;
create policy vehicle_tax_calculations_update_own
  on public.vehicle_tax_calculations
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.vehicles vehicle
      where vehicle.id = vehicle_id
        and vehicle.user_id = (select auth.uid())
    )
  );

drop policy if exists vehicle_tax_calculations_delete_own
  on public.vehicle_tax_calculations;
create policy vehicle_tax_calculations_delete_own
  on public.vehicle_tax_calculations
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete
  on public.vehicle_tax_calculations
  to authenticated;

commit;
