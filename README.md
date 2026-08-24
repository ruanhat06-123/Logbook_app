# Mileage / Log

A responsive car logbook UI for vehicle, fuel, and date-range reporting. It runs as a static site with a seeded local-storage demo so it can be opened directly from the `html/` folder.

## Run

Open `html/index.html` in a browser, sign in with any valid-looking email and a six-character password, then explore the dashboard. Data created in demo mode is stored in browser local storage.

## Supabase setup

Run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL Editor first. It creates both tables, indexes, validation constraints, per-user row-level security policies, and the cascade that removes a vehicle's fuel logs when that vehicle is removed. Number plates are unique per user, ignoring case and surrounding spaces.

The vehicle policies require `auth.uid()` to match `vehicles.user_id`, and the log policies verify ownership through the linked vehicle. Anonymous users have no table privileges, so users can only see cars belonging to their own authenticated account.

`js/supabaseClient.js` contains the Supabase client entry point. Provide `window.SUPABASE_URL` and `window.SUPABASE_ANON_KEY` before loading the app, then replace the demo handlers in `auth.js`, `vehicles.js`, `logbook.js`, and `report.js` with queries against the exported client. The current static frontend remains in local-storage demo mode until those handlers are connected.

The static demo intentionally does not include credentials or pretend to provide server-side security. Never put a Supabase service-role key in browser code; use only the project URL and anon key, with RLS enabled as provided by the migration.

## Pages

- `html/index.html`: sign in and registration shell
- `html/vehicles.html`: dashboard, vehicle list, and vehicle creation
- `html/logbook.html`: fuel fill-up entry
- `html/report.html`: vehicle/date filters and totals table
