# LogMate

LogMate is an offline-first vehicle, fuel, trip, service, and fleet logbook for South African drivers and small fleet operators. It runs as a responsive web app/PWA and can be packaged for Android and iOS with Capacitor.

## Features

### Vehicle management

- Add and manage multiple vehicles.
- Store registration number, make, model, year, primary use, current mileage, and service intervals.
- View vehicle activity, mileage, fuel spend, trips, service status, and service history.
- Attach service invoices as photos or PDFs through Supabase Storage.
- Export service history to CSV and print service reports.

### Trip logging

- Create manual trips with vehicle, date, trip type, odometers, origin, destination, purpose, and notes.
- Classify trips as personal or business for tax and reporting purposes.
- Calculate distance locally from odometer or route data.
- Auto-calculate route distance and ending mileage when origin and destination are geocoded.
- Track live trips with GPS using accuracy filtering, drift filtering, minimum movement thresholds, and impossible-speed rejection.
- Persist an active trip locally so a reload or interruption does not lose the trip.
- End a live trip from the app or its persistent notification, then review the prefilled trip form before saving.
- Edit previous trips without creating duplicate records.
- Use a Mapbox map picker to select precise origin and destination locations.
- Optionally enable Smart Trips movement monitoring and background location tracking on supported native devices.

### Fuel and logbook

- Record fill-ups with vehicle, mileage, litres, fuel price, fuel type, date, and location.
- Calculate fuel consumption in litres per 100 km and efficiency in kilometres per litre.
- Suggest regional fuel prices using Supabase data, DMPR fuel-price data, and a persistent offline cache.
- Support fuel reports with filters for vehicle, dates, fuel type, litres, costs, mileage, and consumption.
- Keep trip-style logbook entries alongside refuel entries where applicable.

### Service reminders

- Show reminders when a vehicle is within 1,000 km of its next service or is overdue.
- Send persistent service notifications using the LogMate app icon.
- Keep reminders active until the service details are actually saved.
- Restore interrupted reminder confirmations after a reload.
- Store service title, date, mileage, next service mileage, invoice amount, notes, and attachments.

### Reports and exports

- Trip report filters for vehicle, trip type, purpose, and date range.
- Defaults to the South African tax year from 1 March through the end of February.
- Shows trip totals, total distance, business/personal split, business-use percentage, and odometer summaries.
- Flags trips with unusual distances when analytics are enabled.
- Export trip data as CSV.
- Print or save a SARS-oriented A4 landscape report as PDF.
- Fuel and service reports include printable views and CSV exports where supported.
- Cache reports locally for offline viewing.
- Audit consecutive vehicle odometer readings for gaps and overlaps before SARS export; affected exports are blocked until the selected records are reviewed.
- Share the generated SARS report through the native Web Share sheet on supported devices, including WhatsApp where the operating system exposes it.

### Smart analytics

Available on Premium and Fleet tiers.

- Detect unusual trip distances compared with vehicle history.
- Detect unusual fuel consumption compared with recent fill-ups.
- Identify overdue or soon-due services.
- Forecast the next service date from average usage.
- Estimate monthly fuel cost from recent fill-ups.
- Project the current South African tax-year business/personal mileage split.
- Display fuel-efficiency trends, business/personal charts, and service-compliance indicators using client-side SVG charts.
- Cache analytics in IndexedDB and recalculate when trips or fill-ups change.
- Surface analytics warnings in dashboards, reports, CSV exports, and SARS exports.

### Fleet management

Available on Fleet Starter and Fleet Pro tiers.

- View fleet-wide vehicle count, total distance, business-use percentage, fuel spend, and total litres.
- See service-due vehicles across the fleet.
- Review each vehicle's trip count, logged distance, fuel spend, and next service status.
- See per-vehicle driver reports with each assigned driver's trip count and distance.
- Keep unassigned trips visible in the vehicle's driver report.
- Create, edit, suspend, and manage fleet driver accounts.
- Assign drivers to one or more vehicles.
- Keep fleet data isolated by fleet and role through Supabase row-level security.
- Track AARTO demerit points from 0 to 15 and show local warnings at 9 or more points.
- Store PrDP numbers and expiry dates and warn when a PrDP is expired or within 30 days of expiry.
- Use the optional vehicle barcode scanner to capture supported licence-disc/PrDP payloads into reviewable vehicle fields; manual entry remains available.

### Authentication and account security

- Supabase email/password sign-up and sign-in.
- Password reset by email.
- Password validation and account details management.
- Optional WebAuthn platform authentication using fingerprint or face unlock where supported.
- Offline restoration of a previously authenticated session.
- Account-scoped vehicle, trip, fuel, service, and report data through Supabase RLS.
- Fleet administrator and fleet driver access roles.

### Subscriptions and billing

Supported tiers are `free`, `premium`, `fleet_starter`, and `fleet_pro`.

- Free tier with a configurable monthly trip limit.
- Premium access to Smart Analytics and SARS PDF exports.
- Fleet Starter and Fleet Pro access to fleet dashboards and driver management.
- PayFast checkout with signed payment redirects.
- PayFast webhook validation for successful and failed payments.
- Subscription expiry and payment-status handling.
- In-app warnings for expiring subscriptions and failed payments.
- Paid SARS export credits for eligible Free-tier users, consumed server-side after verified payment.

### Offline-first PWA

- Installable as a standalone browser application.
- Service worker with cached application shell and offline fallback page.
- Network-first API handling with cached fallback responses where appropriate.
- Cache-first delivery for application pages and static assets.
- Online/offline status indicator.
- IndexedDB storage with localStorage fallback.
- Local persistence for active trips, pending data, geocoding, fuel suggestions, reports, and analytics.
- Background-safe trip data handling for intermittent connectivity.
- Data budgeting mode pauses Mapbox searches, routing, reverse geocoding, and service-invoice uploads until Wi-Fi or Ethernet is detected.
- Tax-year analytics projection runs in a Web Worker when supported, with a main-thread fallback for older browsers and native shells.

### Native mobile support

- Capacitor Android and iOS projects are included.
- Native background geolocation support for active trips and Smart Trips monitoring.
- Native location notifications and wake-lock handling where supported.
- Android debug installation and Android Studio workflows.
- iOS build workflow through Xcode and CocoaPods on macOS.

## Technology

- Frontend: vanilla JavaScript ES modules, HTML, CSS, and Bootstrap 5.3.8 styling.
- Authentication and database: Supabase Auth, Postgres, RLS, and Storage.
- Maps: Mapbox GL and Mapbox Geocoding API.
- Routing: OpenRouteService through the server proxy, with Mapbox fallback.
- Billing: PayFast checkout and ITN webhooks.
- Backend: Node.js and Express.
- Mobile packaging: Capacitor.
- Local storage: IndexedDB with localStorage fallback.
- Analytics: client-side JavaScript with SVG charts.

## Project structure

```text
index.html                 Public landing page
manifest.json              PWA manifest
sw.js                      Service worker
assets/                    Logo and application assets
css/style.css              Shared styles
html/app.html              Single HTML entry for the application views
js/landing.js              Landing page behavior
js/core/                   Shared routing, auth, storage, GPS, analytics, reports, and billing logic
js/pages/                  Page-specific controllers
server/api-server.js       ORS proxy, fuel API, checkout, and PayFast webhook server
server/sql/                Supabase migrations and billing SQL
scripts/capacitor-build.mjs Web asset sync for Capacitor
capacitor/www/             Generated web bundle for native apps
android/                   Capacitor Android project
ios/                       Capacitor iOS project
docs/                      Extended documentation
```

## Application routes

| Route | Purpose |
| --- | --- |
| `html/app.html?page=login` | Sign in, sign up, biometrics, and password recovery entry |
| `html/app.html?page=dashboard` | Personal vehicle and activity overview |
| `html/app.html?page=vehicles` | Vehicle list and vehicle activity |
| `html/app.html?page=add-vehicle` | Add a vehicle |
| `html/app.html?page=trip` | Manual and live trip logging |
| `html/app.html?page=logbook` | Fuel and logbook entries |
| `html/app.html?page=trip-report` | Trip filters, analytics, CSV, print, and SARS export |
| `html/app.html?page=report` | Fuel reports |
| `html/app.html?page=analytics` | Smart analytics |
| `html/app.html?page=fleet` | Fleet overview and vehicle driver reports |
| `html/app.html?page=drivers` | Fleet driver accounts and vehicle assignments |
| `html/app.html?page=settings` | Account, appearance, notifications, offline data, and billing settings |
| `html/app.html?page=help` | Help and support information |
| `html/app.html?page=checkout` | Billing checkout status and payment results |
| `html/app.html?page=reset-password` | Password reset completion |
| `html/app.html?page=offline` | Offline fallback view |

The public website also publishes [Terms and Conditions](terms.html), [Privacy Policy](privacy.html), and a [Refund and Cancellation Policy](refund-policy.html). These are linked from the marketing page and authentication/checkout screens.

## Data model

The main Supabase tables are:

- `users`: application account, subscription, payment, and billing state.
- `vehicles`: vehicle identity, mileage, and service intervals.
- `trips`: trip type, odometers, route details, distance, vehicle, driver, and fleet references.
- `car_logbook`: refuel and trip-style logbook entries.
- `service_records`: vehicle service history.
- `service_record_files`: service invoice attachments.
- `regional_fuel_prices`: regional fuel-price suggestions.
- `fleets`: fleet ownership and limits.
- `fleet_drivers`: fleet driver accounts and identities.
- `fleet_driver_vehicles`: driver-to-vehicle assignments.
- `subscription_events`: billing webhook audit history.

## Local development

### Requirements

- Node.js 20 or newer.
- A Supabase project and configured database migrations.
- HTTPS or `localhost` for geolocation, notifications, and WebAuthn.
- Mapbox token for maps and geocoding.
- OpenRouteService key for server-side route requests.
- PayFast credentials for billing flows.

### PayFast Express service

For the standalone Express PayFast service, run `cd server && npm install && npm start`.
Configure `PUBLIC_API_URL` to the deployed Render/Railway service URL and set the
frontend `VITE_PAYFAST_API_URL` in `js/core/env.js` to that same public URL.

Set these server-only environment variables in Render/Railway; never place the
merchant credentials or service-role key in `js/core/env.js` or any browser-loaded file:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
PAYFAST_MERCHANT_ID
PAYFAST_MERCHANT_KEY
PAYFAST_PASSPHRASE
PAYFAST_API_URL
PAYFAST_SANDBOX
PUBLIC_API_URL
```

Use `PAYFAST_SANDBOX=true` locally and `false` in production with live credentials.
The previous Supabase functions can remain deployed temporarily, but the frontend
no longer calls them.

### Frontend

Serve the repository root with a static HTTPS-capable development server. The app is not a traditional bundler project; its pages load native ES modules directly.

For local development, configure the public runtime values used by `js/core/env.js`, including the Mapbox token and Supabase client values where required.

### API server

Install the server dependencies and start the Express API:

```bash
cd server
npm install
npm start
```

The health endpoint is:

```text
GET http://localhost:3000/api/health
```

The server provides:

- `GET /api/health`
- `GET /api/fuel-prices`
- `POST /api/ors/directions`
- `POST /api/billing/checkout`
- `POST /api/billing/consume-export`
- `POST /api/webhooks/payfast`
- Fleet driver management endpoints used by the fleet UI

Configure the server environment with the values required by the deployment, including `FUELPRICE_API_KEY`, Supabase service-role access, ORS, PayFast, and application URL settings. `FUELPRICE_API_KEY` is sent only from the server to FuelPrice.co.za; if it is unset or the provider is unavailable, the API falls back to DMPR prices. Keep the key in the ignored root `.env` for local development or deployment secrets, never in frontend files.

### Supabase setup

Allow `https://logmate.co.za/html/app.html?page=reset-password` in the Supabase Auth redirect URL configuration so recovery emails return to the consolidated app.

Run the SQL migrations in `server/sql/` in the Supabase SQL editor before using subscriptions, billing, export credits, fleet roles, or fleet driver assignments. Keep RLS enabled for user and fleet data.

Run `server/sql/fleet_compliance.sql` as well to enable AARTO demerit points, PrDP expiry fields, and vehicle licence-disc/VIN/engine metadata.

### Capacitor web sync

After changing frontend files, rebuild the generated native web bundle:

```bash
node scripts/capacitor-build.mjs
```

The generated files are written to `capacitor/www/`.

## Native builds

### Android

Install Node.js, a JDK, Android Studio, and the Android SDK. Then use the repository's Capacitor scripts or open the Android project in Android Studio. A connected device or emulator is required for installation.

### iOS

iOS builds require macOS, Xcode, and CocoaPods. Open the included iOS workspace after syncing the Capacitor web bundle.

## Deployment notes

- Serve the app over HTTPS in production.
- Configure the production Supabase, Mapbox, ORS, and PayFast values outside source control.
- Use PayFast sandbox before setting `PAYFAST_SANDBOX=false` in production.
- Run the required Supabase migrations before enabling billing or fleet features.
- Bump the service-worker cache version in `sw.js` when deploying changed application assets.
- Keep authenticated application pages out of search indexes.
- Verify the deployed API with `/api/health`.
- Review browser permission and mobile battery settings before relying on background GPS tracking.

## Roadmap boundaries

The South African fleet roadmap also proposes depot-to-depot WebRTC/Wi-Fi sync, live load-shedding data, silent panic-button hardware controls, native camera plugins, and NatIS traffic-fine integrations. Those require a signaling service, third-party data agreements, native Capacitor plugins, or a reviewed emergency-response workflow. They are deliberately not simulated by the browser implementation; the current code provides the local data contracts and offline primitives needed to add them safely in later phases.

## Documentation

- [Extended feature and setup guide](docs/README.md)
- [SEO implementation guide](docs/seo-implementation.md)
