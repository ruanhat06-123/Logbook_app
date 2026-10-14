# Offline analytics, tax estimates, and service forecasts

This design adds local driver-behaviour insights, a year-versioned South African vehicle-tax estimator, and rolling vehicle-service forecasts. All calculations run in ordinary ES modules in the browser; no new paid analytics, mapping, telematics, or tax API is introduced. Supabase is used only for authenticated records and optional results sync, with the existing RLS policies in force.

Apply [the migration](../supabase/migrations/20261014000000_local_analytics_tax_forecasts.sql) before deploying the app modules. New application modules are [driverBehavior.js](../js/core/driverBehavior.js), [taxCalculator.js](../js/core/taxCalculator.js), and [serviceForecast.js](../js/core/serviceForecast.js).

## 1. Driver-behaviour telemetry

### Design and data flow

1. A driver explicitly checks **Optional driver-behaviour insights (on-device only)** before starting a live trip. The preference is stored in local storage. DeviceMotion access is requested on the Start-trip gesture where the platform requires permission.
2. `gpsTracking.js` continues to own accepted location fixes. `driverBehavior.js` subscribes to its existing `gps-position-recorded` event, applying an accuracy ceiling of 15 m and rejecting implausible speed estimates over 60 m/s.
3. GPS speed deltas are smoothed before thresholds are applied: braking at or below -3.5 m/s², acceleration at or above +3.0 m/s², and cornering at an estimated lateral acceleration of 3.0 m/s² or greater while travelling at least 8 m/s. Cornering needs reliable GPS heading.
4. DeviceMotion uses a 0.8-second low-pass gravity estimate and treats the residual linear acceleration above 2 m/s² as corroboration only. It cannot create an event on its own. This makes a bump, phone rotation, or a phone in a cup holder less likely to create a driving event.
5. Candidate events are de-duplicated by type for 10 seconds, timestamped, and stored under a trip-specific IndexedDB key through the current `localStore.js` helper. Raw coordinates are not copied into behavior-event records.
6. On trip end, a normalized score is computed as `clamp(100 - (weighted corroborated event count × 100 / measured km), 0, 100)`. Weights are 12 for harsh braking, 10 for rapid acceleration, and 8 for aggressive cornering, scaled by event confidence. A score is `null` unless at least five good GPS fixes and 0.5 km are available. The count, category counts, score, and data-quality label are attached to the trip record. The detailed event list stays on the device.

The score is a **relative telemetry indicator**, not a certified road-safety grade, insurance score, driver diagnosis, or evidence of an offence. Thresholds should be calibrated against representative vehicle/device testing before they are used for employment or insurance decisions. Background geolocation can continue through the existing Capacitor plugin; DeviceMotion may pause when the operating system suspends the web view.

### Stored data

The migration adds nullable aggregate fields to `trips`: `driver_safety_score` (0–100), `driver_safety_event_count`, `driver_safety_event_counts` (JSON object), and `driver_safety_data_quality` (`good`, `limited`, or `insufficient`). Nullable values distinguish a trip with no telemetry from a trip that had zero events.

No sensor trace or precise event location is synced. Only the trip aggregate follows the app's current authenticated trip write and RLS rules. The event cache is keyed by the generated trip ID and is not queried by another account. Browser storage is not encrypted; provide a clear-delete control and privacy notice before enabling this feature for teams.

### Bootstrap layout

The trip form exposes the opt-in alongside live-trip controls. A trip summary can use this responsive Bootstrap pattern:

```html
<section class="card p-3 p-md-4" aria-labelledby="driver-score-title">
  <div class="d-flex flex-column flex-md-row justify-content-between gap-3">
    <div>
      <p class="text-uppercase small text-secondary mb-1">On-device estimate</p>
      <h2 id="driver-score-title" class="h5">Driver insights</h2>
      <p class="small text-secondary mb-0">Based on reliable GPS fixes; motion data is optional.</p>
    </div>
    <div class="text-md-end">
      <strong class="display-6">82</strong><span class="text-secondary"> / 100</span>
      <div class="small text-secondary">Limited data · 2 events</div>
    </div>
  </div>
  <ul class="list-group list-group-flush mt-3">
    <li class="list-group-item d-flex justify-content-between"><span>Harsh braking</span><strong>1</strong></li>
    <li class="list-group-item d-flex justify-content-between"><span>Rapid acceleration</span><strong>1</strong></li>
    <li class="list-group-item d-flex justify-content-between"><span>Aggressive cornering</span><strong>0</strong></li>
  </ul>
</section>
```

Render values with the app's HTML escaping helper. For an insufficient sample, show “Not enough reliable data” rather than a score.

## 2. Wear-and-tear, travel allowance, and vehicle-benefit estimates

### Legal basis and rule version

The calculator is a planning aid, not a tax return or tax opinion. **Seven years is not the passenger-car useful life listed by SARS Interpretation Note 47.** That SARS note lists five years for passenger cars and four for delivery vehicles; it is archived guidance, not a guarantee that the period applies to a particular asset. The calculator therefore defaults to the five-year passenger-car illustration, permits a reviewed asset life to be supplied, and marks every result as requiring tax review. Do not hard-code an unqualified seven-year deduction.

The travel-cost table embedded in `taxCalculator.js` is the SARS **2027 year-of-assessment schedule** (effective 1 March 2026 to 28 February 2027). Store the rules version with each saved calculation and update this local configuration manually each tax year. No runtime API fetch is used.

| Determined vehicle value | Annual fixed cost (R) | Fuel (c/km) | Maintenance (c/km) |
|---|---:|---:|---:|
| Up to 115,000 | 38,344 | 132.9 | 49.1 |
| 115,000.01–230,000 | 68,487 | 148.4 | 61.4 |
| 230,000.01–345,000 | 98,689 | 161.2 | 67.8 |
| 345,000.01–460,000 | 125,393 | 173.4 | 74.0 |
| 460,000.01–575,000 | 152,097 | 185.5 | 86.9 |
| 575,000.01–690,000 | 180,078 | 212.8 | 102.0 |
| 690,000.01–805,000 | 208,106 | 216.5 | 114.5 |
| 805,000.01–920,000 | 237,679 | 220.1 | 126.1 |
| Above 920,000 | 237,679 | 220.1 | 126.9 |

The deemed business-cost illustration prorates annual fixed cost for months of qualifying use, apportions fixed cost by business kilometres / total kilometres, and adds the per-kilometre fuel and maintenance components only where the employee bore those full costs. The table also stores SARS's simplified R4.95/km reimbursive rate, but the allowance calculator does not assume a reimbursement is eligible: confirm the applicable reimbursement conditions before using it.

The module exposes:

- `calculateWearAndTear(...)` — straight-line Section 11(e) illustration, time-apportioned for the year and business-use percentage. Asset type, cost basis, private use, commencement date, and applicable SARS treatment still need review.
- `calculateDeemedTravelCosts(...)` — versioned table calculation with explicit cost-bearing and months-in-use inputs.
- `compareActualAndDeemedTravelCosts(...)` — compares a business-use share of *caller-supplied eligible costs* with the deemed schedule. It does not decide which deduction the taxpayer is legally entitled to claim.
- `calculateVehicleFringeBenefit(...)` — illustrates the monthly 3.5% determined-value rate or 3.25% where the qualifying maintenance plan was included at acquisition, less an employee contribution. It deliberately does not estimate PAYE or the final year-end private/business travel adjustment.
- `saveVehicleTaxProfile(...)` and `saveTaxCalculation(...)` — authenticated Supabase writes for editable vehicle tax inputs and versioned calculation snapshots. RLS remains authoritative.

The 20% vs 80% PAYE-inclusion indicator is based on the employer's expected business-use percentage (20% when the employer is satisfied that business use will be at least 80%; otherwise 80%). It is not inferred from the subsequently observed kilometres. Final tax return calculations can differ.

### Schema and RLS

The migration adds vehicle tax-profile fields (`tax_cost_basis_rand`, `tax_purchase_date`, `tax_asset_category`, `tax_useful_life_years`, `tax_business_use_percent`, `tax_maintenance_plan`) and a `vehicle_tax_calculations` snapshot table. The snapshot's unique key is user + vehicle + tax year + calculation type, so recalculation replaces that user's saved estimate instead of creating duplicates.

`vehicle_tax_calculations` has RLS enabled. Select/delete require the authenticated row owner; insert/update additionally require an accessible vehicle owned by that same user. No service-role key is used by client calculations.

### Bootstrap layout

Place this card in Premium/Fleet Smart Analytics. Use stacked rows on small screens; use a two-column cost comparison on wider screens.

```html
<section class="card p-3 p-lg-4" aria-labelledby="tax-estimate-title">
  <div class="d-flex flex-column flex-lg-row justify-content-between gap-3">
    <div>
      <p class="text-uppercase small text-secondary mb-1">Tax year 2027 · SARS rules v1</p>
      <h2 id="tax-estimate-title" class="h5">Vehicle tax estimate</h2>
      <p class="small text-secondary">Illustrative only. Confirm asset treatment and claim eligibility with a tax practitioner.</p>
    </div>
    <a class="btn btn-outline-secondary align-self-lg-start" href="https://www.sars.gov.za/tax-rates/employers/rates-per-kilometre/">Review SARS schedule</a>
  </div>
  <div class="row g-3 mt-1">
    <div class="col-12 col-md-6 col-xl-3"><div class="border rounded p-3 h-100"><span class="small text-secondary">Section 11(e) illustration</span><strong class="d-block fs-5">R 36,000</strong><span class="small text-secondary">Business-use share</span></div></div>
    <div class="col-12 col-md-6 col-xl-3"><div class="border rounded p-3 h-100"><span class="small text-secondary">Actual-cost estimate</span><strong class="d-block fs-5">R 18,250</strong><span class="small text-secondary">From eligible entered costs</span></div></div>
    <div class="col-12 col-md-6 col-xl-3"><div class="border rounded p-3 h-100"><span class="small text-secondary">Deemed-cost estimate</span><strong class="d-block fs-5">R 21,870</strong><span class="small text-secondary">2027 rate-per-km schedule</span></div></div>
    <div class="col-12 col-md-6 col-xl-3"><div class="border rounded p-3 h-100"><span class="small text-secondary">Company-car benefit</span><strong class="d-block fs-5">R 4,200 / month</strong><span class="small text-secondary">Before final assessment adjustments</span></div></div>
  </div>
  <p class="small text-secondary mt-3 mb-0">Actual and deemed amounts are alternatives for review, not additive deductions. Keep the SARS schedule and supporting logbook for the selected tax year.</p>
</section>
```

The amounts above are wireframe placeholders; bind them to calculator outputs, not literal values.

## 3. Rolling service forecast

### Algorithm and integration

`serviceForecast.js` forecasts every vehicle independently:

1. Read valid odometer observations from logged mileage entries and trip odometer records within the rolling 30-day window. Use odometer deltas when available; never add those deltas to trip-distance totals, which would double-count movement.
2. When dated odometer deltas are insufficient, use valid trip distance divided across the 30-day window. Invalid, reversed, or physically implausible odometer deltas are skipped/capped.
3. Blend the 30-day daily-use baseline (65%) with the last-seven-day trip-distance rate (35%) when recent trip data exists.
4. Adjust by a bounded recent trip-frequency factor (0.8–1.2) and a bounded business-intensity surge factor (1.0–1.1), comparing the last seven days' business-distance share with the 30-day share.
5. Project both `next_service_mileage - 1,000` and `next_service_mileage` to local calendar dates using the resulting daily-km estimate. The estimate is capped at 1,500 km/day and never reports a date when history or the vehicle's odometer/service target is missing.
6. Cache results per vehicle in IndexedDB. The Premium/Fleet analytics workflow optionally writes the date, warning mileage, rate, and calculation timestamp to `vehicles` while online. `notifyServiceDue()` continues to issue an immediate service notification at the existing 1,000-km threshold and can additionally show a “predicted soon” notification when the cached warning date is within seven days.

This is a calendar-date **forecast**, not a guarantee of the exact day a vehicle will reach a threshold. A service worker cannot wake itself on a future date without push/background infrastructure; notifications are evaluated when LogMate is opened. No background server or third-party scheduler is introduced.

### Schema and RLS

Vehicle rows gain `service_warning_mileage`, `service_warning_date`, `service_predicted_date`, `service_forecast_km_per_day`, and `service_forecast_computed_at`. Forecast persistence uses the current user's Supabase client and the existing `vehicles` RLS policy. When offline, the forecast remains available from the local cache; a failed sync is logged and does not invalidate the local display.

## 4. Payment activation on confirmed success

The repository already has the correct server-side boundary: Paystack's signed `/api/webhooks/paystack` route verifies the HMAC-SHA512 signature before handling events. `activateSubscriptionForSuccessfulPayment()` in `server/paystack.js` writes the paid tier, expiry, and active payment status to the `users` row, then writes the subscription audit event. `charge.success` and paid `invoice.update` invoke this function only after a successful status and a payment amount matching the configured plan. A `subscription.create` event now only stores the Paystack subscription code and cannot independently grant paid features.

The browser checkout page only waits for the Supabase row to change; it never sets a plan from a redirect parameter. This prevents a forged `?status=success` URL from granting access. Production still needs the Paystack webhook URL `https://logmate.co.za/api/webhooks/paystack`, a configured `PAYSTACK_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY` on the server only, and working `paystack_events` / `subscription_events` tables. Configure the provider to retry webhook failures. Do not expose service-role credentials to the app or introduce a client-callable “activate plan” endpoint.

## 5. Deployment and operational checks

1. Apply the SQL migration using the project's normal privileged migration process. Review the policies against the deployed fleet/vehicle ownership model before applying to a production database.
2. Deploy the static application, Node API, and service worker together. Increment the service-worker cache when changing offline modules; this change uses `logmate-shell-v45`.
3. For annual tax updates, update `SARS_TRAVEL_COST_RULES`, change the `rulesVersion`, verify every bracket against the new official SARS PDF, and retain old calculation snapshots as historical versions.
4. Test online and offline: no motion permission, denied permission, background/reboot resume, inaccurate GPS, sparse/missing odometer readings, odometer rollback, vehicle due/overdue, and at least two vehicles with different histories.
5. Test payment webhooks with signed Paystack test events: valid `charge.success`, paid invoice, duplicate event, invalid signature, unmatched amount, and `subscription.create` without a successful payment. Confirm the final `users` row and audit event in Supabase.

## Sources

- [SARS 2027 rates-per-kilometre schedule](https://www.sars.gov.za/tax-rates/employers/rates-per-kilometre/) and [official 2027 schedule PDF](https://www.sars.gov.za/wp-content/uploads/Docs/PAYE/Tables/tables2026/PAYE-GEN-01-G03-A01-Rate-per-Kilometre-Schedule-External-Annexure.pdf)
- [SARS Guide for Employers in respect of Allowances](https://www.sars.gov.za/guide-for-employers-in-respect-of-allowances/)
- [SARS Guide for Employers in respect of Fringe Benefits](https://www.sars.gov.za/guide-for-employers-in-respect-of-fringe-benefits/)
- [SARS Travel e-log book](https://www.sars.gov.za/types-of-tax/personal-income-tax/travel-e-log-book/)
- [SARS Interpretation Note 47, Issue 4 (archived guidance)](https://www.sars.gov.za/wp-content/uploads/Legal/Notes/IntR-IN-2021-01-Arc-01-IN-47-Issue-4-IN47-Wear-And-Tear-Depreciation-Allowance-9-February-2021.pdf)
