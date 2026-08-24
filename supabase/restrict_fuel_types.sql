-- Run this after add_fuel_type.sql to enforce the five supported fuel grades.
alter table public.car_logbook
drop constraint if exists car_logbook_fuel_type_check;

update public.car_logbook
set fuel_type = 'Petrol 93'
where fuel_type not in ('Petrol 93', 'Petrol 95', 'Diesel PPM500', 'Diesel PPM50', 'Diesel PPM10');

alter table public.car_logbook
add constraint car_logbook_fuel_type_check
check (fuel_type in ('Petrol 93', 'Petrol 95', 'Diesel PPM500', 'Diesel PPM50', 'Diesel PPM10'));

notify pgrst, 'reload schema';
