-- Run this once if car_logbook already exists.
alter table public.car_logbook
add column if not exists fuel_type text not null default 'Petrol'
check (length(trim(fuel_type)) > 0);

notify pgrst, 'reload schema';
