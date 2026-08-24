-- Run this once if the vehicles table already exists.
alter table public.vehicles
add column if not exists current_mileage numeric not null default 0
check (current_mileage >= 0);

-- New vehicle mileage is exposed through the existing authenticated vehicle policies.
notify pgrst, 'reload schema';
