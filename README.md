# LogMate

A personal vehicle, fuel, trip, and service logbook PWA with offline-first GPS trip tracking, biometric sign-in, smart analytics, SARS-compliant reporting, and service reminders.

## Overview

LogMate helps you keep a complete, audit-ready record of your driving: live GPS trip logging, fuel fill-ups with consumption tracking, service history with reminders, on-device smart analytics, and reports — including a SARS-compliant logbook export for South African tax claims. It works offline and can be installed as a standalone app.

## Features

### Trips
- **Manual trip entry** — vehicle, date, trip type (personal/business), start/end odometer, origin, destination, purpose. The end odometer is auto-calculated from a driving route when origin/destination are geocoded, and the vehicle's current mileage is updated on save.
- **Live GPS trip tracking** — "Start trip" records your actual route continuously on-device using `watchPosition` with drift filtering:
  - Accuracy filter rejects fixes worse than ±15 m.
  - 5 m minimum movement between recorded points.
  - Impossible-speed jump rejection (> 216 km/h) filters GPS glitches.
  - Stationary jitter is ignored in the distance total (accuracy-aware Haversine summation).
- **Minimal API usage** — at most 2 external calls per trip (reverse-geocoding the start and end addresses, fired once in parallel at trip end and cached so reloads never re-spend them). Distance calculation is 100% local.
- **Live notification** — a persistent notification updates every second with the current trip distance to one decimal place in km, with an "End trip" action. It closes automatically when the trip is ended from the app.
- **Single form flow** — ending a live trip pre-fills the existing trip form (vehicle, date, odometers, resolved origin/destination); you confirm the remaining fields and save. No duplicate forms, no automatic DB writes.
- **Edit previous trips** — select any past trip from the dropdown to update it in place.
- **Crash-safe** — pending live-trip data is persisted locally and restored into the form if the page reloads mid-flow.
- **Map picker** — Mapbox GL modal for choosing precise origin/destination points with search, light/dark map theme, and previews.

### Fuel (logbook)
- Fill-up logging with vehicle, mileage, litres, price per litre, fuel type, date, and location.
- Regional fuel-price suggestions that work every time: live lookup from the `regional_fuel_prices` table when online, with a persistent per-country/fuel-type cache so a suggestion is always available offline (see [js/core/fuelPrice.js](js/core/fuelPrice.js)).
- Consumption (L/100 km) and efficiency (km/L) calculated from consecutive fill-ups.

### Service reminders & history
- Reminder banners appear when a vehicle is within 1,000 km of its next service mileage (or overdue).
- **Persistent notifications** with the app logo stay visible until the service is recorded — banners and notifications only clear after the service details (title, date, mileage, next service mileage, notes) are saved to the service history.
- Interruption-safe: if the page closes mid-confirmation, the reminder re-appears on the next visit.
- Full service history per vehicle with titles, dates, mileage, invoice amounts, notes, and file attachments (photos/PDF invoices via Supabase Storage). CSV export and printable reports included.

### Smart analytics (Premium / Fleet)
- Not available on the Free tier — the analytics page shows an upgrade prompt instead when `subscription_tier` is `free` (see [js/pages/analytics.js](js/pages/analytics.js)).
- **Anomaly detection** — trips with distance outside ±20% of the vehicle's historical average; fill-ups with consumption outside ±20% of the previous 5 fill-ups; overdue service intervals.
- **Predictive insights** — next service date forecast from average daily usage; monthly fuel cost estimate from the last 90 days of fill-ups; projected business/personal mileage split for the current SA tax year.
- **Visual dashboards** — pure SVG charts (no libraries): fuel-efficiency trend line, business-vs-personal bar chart, service-compliance gauge.
- **Proactive alerts** — inline banners for anomalies, service-due-soon (≤1,000 km), and fuel-efficiency drops beyond a configurable threshold (`analyticsEfficiencyDropPct` in localStorage, default 15%).
- **Offline-first** — computed on-device in [js/core/analytics.js](js/core/analytics.js), cached in IndexedDB, recalculated whenever new data is logged. Anomalies are highlighted in the trip report table, SARS PDF, and CSV export.

### Reports
- **Trip report** — filter by vehicle, trip type, purpose, and date range. Shows totals, business/personal split, business-use percentage, and annual odometer readings per vehicle. Defaults to the current SA tax year (1 Mar → end Feb); a one-click "Tax year" button re-applies it. Anomalous trips are flagged inline.
- **SARS PDF** — Premium and Fleet users get included print-ready A4-landscape exports; Free users can purchase a single export at the amount configured in [pricing.json](pricing.json). Each Free export is credited only after a verified PayFast webhook and consumed server-side.
- **CSV export** — spreadsheet-friendly trip report download with an anomaly column.
- **Fuel report** — fill-up costs, litres, mileage, and consumption with filters.
- Reports are cached locally for offline viewing ([js/core/reportCache.js](js/core/reportCache.js)).

### Authentication & security
- Supabase email/password auth with sign-up (name + password policy), sign-in, password reset via email.
- **Biometrics-first login** — after one online password sign-in, the app offers WebAuthn platform-authenticator enrollment (fingerprint/face). On future visits the login page auto-prompts biometrics and only shows the password form if biometrics fail or are cancelled. Credentials are removed on sign-out.
- **Offline login** — a previously signed-in session can be restored offline.
- Row-level data isolation per account via Supabase.

### Settings
- Account email and password management.
- Appearance (light/dark theme).
- Biometric sign-in management (enable/disable per device, support detection).
- Default trip type and default vehicle.
- Service reminder notifications toggle.
- Live trip tracking notifications toggle.
- Map theme preference (light/dark/follow system).
- Offline data management (clear cached trip coordinates, pending trips, geocode lookups, report caches).
- **Subscription & billing** — current plan, payment status, and renewal date, with monthly upgrade buttons for Premium and Fleet Starter/Pro.

### Subscriptions & fleet management
- **Tiers**: `free`, `premium`, `fleet_starter`, `fleet_pro`, tracked per user in the Supabase `users` table (`subscription_tier`, `subscription_expiry_date`, `payment_status`). New accounts default to `free`.
- **Payments**: PayFast only, via `server/api-server.js` — `/api/billing/checkout` builds a signed PayFast redirect, and `/api/webhooks/payfast` (ITN) updates the subscription row on success/failure (service-role Supabase client, bypasses RLS).
- **Feature gating**: [js/core/subscription.js](js/core/subscription.js) fetches a fresh subscription state on each load (falling back to the offline cache when offline) and exposes `isPremiumTier`, `isFleetTier`, `canExportSarsPdf`, and `isFreeTripLimitReached`. Free tier is capped at 30 trips/month, cannot export the SARS PDF, and has no access to Smart analytics; a database trigger (`enforce_trip_quota` in [server/sql/subscriptions.sql](server/sql/subscriptions.sql)) enforces the trip cap server-side as well.
- **Login flow**: on sign-in (including offline session restore), the subscription row is synced and cached; expired or failed subscriptions are treated as `free` on the client, and `downgrade_expired_subscriptions()` (callable via RPC or `pg_cron`) performs the same downgrade server-side after a 7-day grace period.
- **Notifications**: an in-app banner (`subscriptionBannerMarkup`) warns when a paid plan is expiring within 7 days or when a payment has failed.
- **Fleet dashboard** — [html/fleet.html](html/fleet.html) / [js/pages/fleet.js](js/pages/fleet.js), gated to `fleet_starter`/`fleet_pro`, shows fleet-wide distance, business-use %, fuel spend, and per-vehicle summaries; the nav link only appears for fleet-tier accounts.

### PWA / offline
- Installable (manifest + beforeinstallprompt), standalone display.
- Service worker with network-first for API calls and cache-first for app shell; offline fallback page.
- Offline indicator, IndexedDB-backed local store (with localStorage fallback), background-safe trip data persistence.

## Tech stack

- **Frontend**: vanilla ES modules, single-page modules per route, shared `shell` layout from [js/core/app.js](js/core/app.js).
- **Backend**: Supabase (auth, Postgres tables: `vehicles`, `trips`, `car_logbook`, `service_records`, `service_record_files`, `regional_fuel_prices`; Storage bucket `service-documents`).
- **Maps/geocoding**: Mapbox GL + Geocoding API (token via `window.__ENV.VITE_MAPBOX_TOKEN` from [js/core/env.js](js/core/env.js)).
- **Routing**: OpenRouteService via server proxy at `/api/ors/directions` ([server/api-server.js](server/api-server.js)), with Mapbox Directions fallback.
- **Biometrics**: WebAuthn platform authenticator (local credential gating the saved session).
- **Analytics**: pure client-side engine ([js/core/analytics.js](js/core/analytics.js)) with SVG charts.

## Project structure

```
index.html              Landing page
manifest.json           PWA manifest
sw.js                   Service worker
assets/logo.svg         App logo (used for all notifications)
css/style.css           Global styles
html/                   Page shells (login, dashboard, trip, logbook, analytics, …)
js/landing.js           Landing page script
js/core/
  app.js                Shared shell, auth guard, vehicles helper, sign-out
  analytics.js          On-device analytics engine (anomalies, predictions, alerts)
  distanceCalculator.js Haversine + accuracy-aware distance, formatting
  env.js                Runtime public env (Mapbox token)
  fuelPrice.js          Regional fuel prices with persistent offline cache
  gpsTracking.js        GPS watch with filters, wake lock, local persistence
  localStore.js         IndexedDB/localStorage key-value store
  offlineIndicator.js   Online/offline UI indicator
  offlineSync.js        Legacy ORS sync queue (kept, no longer auto-used)
  reportCache.js        Offline report caching
  serviceReminder.js    Reminder banners, notifications, confirm flow
  subscription.js       Offline-first subscription state, feature gating (SARS export, trip cap, fleet)
  supabaseClient.js     Supabase client init
  tripUIIntegration.js  Live trip start/end, notification, form population
js/pages/               Per-page controllers (trip, logbook, analytics, fleet, …)
server/api-server.js    ORS proxy + PayFast checkout/webhook (subscription billing)
server/sql/subscriptions.sql  Supabase migration: users table, RLS, triggers
```

## Data model (Supabase)

- **vehicles** — number plate, make, model, year, current_mileage, last_service_mileage, next_service_mileage, user_id.
- **trips** — vehicle_id, trip_type, mileage_start, mileage_end, trip_distance_km, created_at, trip_origin, trip_destination, trip_purpose.
- **car_logbook** — entries (entry_type "refuel"/"trip"); refuel rows carry current_mileage, fuel_amount_liters, fuel_price, total_cost, fuel_type, fuel_consumption_l_per_100km, fuel_efficiency_km_per_l, fuel_location.
- **service_records** — vehicle_id, title, service_date, mileage, invoice_amount, notes.
- **service_record_files** — service_record_id, file_path, file_name, content_type.
- **regional_fuel_prices** — country_code, fuel_type, price_per_litre, currency, region, valid_from, source.
- **users** — mirrors `auth.users`, adds `subscription_tier`, `subscription_expiry_date`, `payment_status`, `billing_cycle` (see [server/sql/subscriptions.sql](server/sql/subscriptions.sql)).
- **subscription_events** — payment webhook audit log (provider, event_type, amount, raw_payload).

## SARS compliance

The trip report captures and exports everything SARS requires: trip date, opening/closing odometer, distance, destination, business reason, annual odometer readings per vehicle, and business/personal split with percentage. Anomalous trips are highlighted for review. Records are retained server-side (≥ 5 years). Export via **SARS PDF** (print/save as PDF) or CSV.

## Running locally

1. Serve the static files (e.g. Five Server / any static host) — HTTPS or localhost is required for geolocation, notifications, and WebAuthn.
2. Copy [.env.example](.env.example) to `.env`, fill in the server credentials, run [server/sql/export_credits.sql](server/sql/export_credits.sql) in Supabase, and run the API/proxy server for route-based auto distance and subscription billing: `node server/api-server.js`. ORS is optional for checkout; directions return a JSON `503` until `ORS_API_KEY` is configured. Billing requires `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PAYFAST_MERCHANT_ID`, `PAYFAST_MERCHANT_KEY`, and `PAYFAST_PASSPHRASE`. PayFast and API URLs use `https://logmate.co.za` by default. Set `APP_BASE_URL`, `PAYFAST_RETURN_URL`, `PAYFAST_CANCEL_URL`, or `PAYFAST_NOTIFY_URL` to override them when needed. Test with PayFast sandbox before switching `PAYFAST_SANDBOX=false`.
  Verify the deployed API with `https://logmate.co.za/api/health`; it should return JSON with `ok: true`. The Five Server frontend on port 5500 calls the production API at `https://logmate.co.za/api/billing/checkout`.
3. Run [server/sql/subscriptions.sql](server/sql/subscriptions.sql) once in the Supabase SQL editor to add the `users`/`subscription_events` tables, triggers, and RLS policies.
4. Ensure [js/core/env.js](js/core/env.js) exposes `VITE_MAPBOX_TOKEN`.

## Notes & conventions

- The service worker cache version (`CACHE_NAME` in [sw.js](sw.js)) must be bumped whenever JS modules change, otherwise clients keep serving stale code. The app calls `registration.update()` on load.
- All notifications use `/assets/logo.svg` as icon/badge.
- Live trip distance displays use whole meters under 1 km and one decimal place for kilometres above 1 km.
- Analytics results are cached in IndexedDB under the `analyticsResults` key and recomputed whenever trips or fill-ups are logged.
