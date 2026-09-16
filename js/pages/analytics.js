// analytics.js (page)
// Smart analytics dashboard — friendly, plain-English insights computed
// entirely on-device and cached for offline use.
import "../core/app.js";
import {
  computeAnalytics,
  getCachedAnalytics,
  getEfficiencyDropThreshold,
  saTaxYear,
} from "../core/analytics.js";
import {
  notifyServiceDue,
  requestServiceNotifications,
  restorePendingServiceReminders,
} from "../core/serviceReminder.js";

const user = await requireAuth();
if (!user) throw new Error("Not authenticated");

const subscriptionState = await getSubscriptionState(user.id);
if (!isPremiumTier(subscriptionState)) {
  await shell(
    "analytics",
    `
    <header class="topbar">
      <div><div class="eyebrow">Insights / analytics</div><h1>Smart analytics is a Premium feature.</h1></div>
      <div class="top-date"><strong>PREMIUM / FLEET</strong>On-device insights</div>
    </header>
    <section class="card">
      <div class="card-head"><h2>Unlock trends, predictions, and anomaly alerts</h2></div>
      <p class="row-sub">Premium and Fleet plans include fuel-efficiency trends, business/personal split forecasting, service-compliance tracking, and anomaly detection for trips and fill-ups — all computed on this device.</p>
      <div class="form-actions" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">
        <a class="btn btn-primary" href="settings.html#billing">View plans →</a>
      </div>
    </section>
  `,
  );
  throw new Error("Analytics requires a Premium or Fleet subscription");
}

const escape = (value) =>
  String(value ?? "").replace(
    /[&<>'"]/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c],
  );

// Read the current theme palette from the app's CSS variables so charts and
// accents match light/dark mode exactly.
const themeColor = (name, fallback) => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
};
const palette = {
  get primary() { return themeColor("--teal", "#3a4a66"); },
  get primaryStrong() { return themeColor("--teal-deep", "#29364d"); },
  get good() { return themeColor("--mint", "#6faf8d"); },
  get warn() { return themeColor("--yellow", "#d97a3a"); },
  get bad() { return themeColor("--coral", "#d97a3a"); },
  get muted() { return themeColor("--muted", "#667085"); },
  get track() { return themeColor("--line", "#dfe4ec"); },
};

// ---------- Fetch source data (with graceful degradation) ----------
let vehicleRows = [];
let tripRows = [];
let fuelRows = [];
try {
  const [vehiclesResp, tripsResp, fuelResp] = await Promise.all([
    supabase.from("vehicles").select("*").order("number_plate"),
    supabase.from("trips").select("*").order("created_at", { ascending: false }),
    supabase.from("car_logbook").select("*").eq("entry_type", "refuel").order("created_at", { ascending: false }),
  ]);
  vehicleRows = vehiclesResp.data || [];
  tripRows = tripsResp.data || [];
  fuelRows = fuelResp.data || [];
} catch (err) {
  console.warn("Analytics data fetch failed:", err);
}

// ---------- Compute (or fall back to cache) ----------
let analytics = null;
let fromCache = false;
try {
  analytics = await computeAnalytics({ vehicles: vehicleRows, trips: tripRows, fuelEntries: fuelRows });
} catch (err) {
  console.warn("Analytics computation failed, falling back to cache:", err);
  analytics = await getCachedAnalytics();
  fromCache = true;
}

const hasData =
  (tripRows?.length || 0) > 0 || (fuelRows?.length || 0) > 0 || (vehicleRows?.length || 0) > 0;

await shell(
  "analytics",
  `
  <style>
    .analytics-hero { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 32px; margin: 0 0 34px; padding-bottom: 28px; border-bottom: 1px solid var(--line); }
    .analytics-hero p { color: var(--muted); max-width: 680px; margin: 0; line-height: 1.75; font-size: 14px; }
    .analytics-hero-note { color: var(--ink); white-space: nowrap; font: 11px "DM Mono", monospace; text-transform: uppercase; letter-spacing: 0.08em; }
    .analytics-grid { display: grid; gap: 20px; grid-template-columns: minmax(0, 1.12fr) minmax(300px, 0.88fr); align-items: start; }
    .analytics-card { min-width: 0; border: 1px solid var(--line); border-top: 2px solid var(--teal); border-radius: 0; box-shadow: 0 4px 30px rgba(0, 0, 0, 0.02); }
    .analytics-card:nth-child(2) { border-top-color: var(--mint); }
    .analytics-card:nth-child(3) { border-top-color: var(--yellow); }
    .analytics-card:nth-child(4) { border-top-color: var(--coral); }
    .analytics-card:nth-child(5) { grid-column: 1 / -1; border-top-color: var(--ink); }
    .analytics-card h3 { margin: 0 0 6px; font-family: Georgia, "Times New Roman", serif; font-size: 22px; letter-spacing: -0.02em; }
    .analytics-card .card-sub { color: var(--muted); font-size: 12px; margin-bottom: 20px; line-height: 1.6; }
    .alert-banner { padding: 14px 16px; border: 1px solid var(--line); border-left: 3px solid; border-radius: 0; margin-bottom: 12px; font-size: 13px; display: flex; gap: 12px; align-items: flex-start; background: var(--surface); }
    .alert-banner .alert-icon { min-width: 52px; color: var(--muted); font: 10px "DM Mono", monospace; line-height: 1.4; letter-spacing: 0.08em; text-transform: uppercase; }
    .alert-high { border-left-color: var(--coral); color: var(--coral); }
    .alert-medium { border-left-color: var(--yellow); color: var(--ink); }
    .alert-low { border-left-color: var(--teal); color: var(--ink); }
    .alert-ok { border-left-color: var(--mint); color: var(--ink); }
    .stat-list { display: grid; gap: 0; }
    .stat-row { display: flex; justify-content: space-between; gap: 18px; padding: 13px 0; border-top: 1px solid var(--line); font-size: 13px; align-items: baseline; }
    .stat-row span { color: var(--muted); }
    .stat-row strong { white-space: nowrap; text-align: right; color: var(--ink); }
    .chart-wrap { width: 100%; padding: 10px 8px 0; background: color-mix(in srgb, var(--paper) 55%, var(--surface)); }
    .chart-wrap-efficiency { border-radius: 14px; overflow: hidden; }
    .chart-wrap svg { width: 100%; height: auto; display: block; }
    .chart-wrap path, .chart-wrap circle, .chart-wrap rect { transition: opacity 260ms ease, transform 700ms cubic-bezier(.22, 1, .36, 1); }
    .chart-wrap .analytics-line { stroke-dasharray: 700; stroke-dashoffset: 700; animation: analytics-line-in 900ms ease-out forwards; }
    .chart-wrap .analytics-area { opacity: 0; animation: analytics-area-in 700ms ease-out 180ms forwards; }
    .chart-wrap .pie-slice { transform-box: fill-box; transform-origin: center; animation: analytics-pie-in 700ms cubic-bezier(.22, 1, .36, 1) both; }
    .chart-wrap .pie-slice:nth-of-type(2) { animation-delay: 120ms; }
    .chart-wrap .pie-slice:nth-of-type(3) { animation-delay: 220ms; }
    @keyframes analytics-line-in { to { stroke-dashoffset: 0; } }
    @keyframes analytics-area-in { to { opacity: 1; } }
    @keyframes analytics-pie-in { from { opacity: 0; transform: scale(.72); } to { opacity: 1; transform: scale(1); } }
    @media (prefers-reduced-motion: reduce) {
      .chart-wrap .analytics-line { animation: none; stroke-dashoffset: 0; }
      .chart-wrap .analytics-area, .chart-wrap .pie-slice { animation: none; opacity: 1; transform: none; }
    }
    .chart-empty { min-height: 150px; display: grid; place-items: center; padding: 26px 18px; text-align: center; color: var(--muted); font-size: 13px; border: 1px dashed var(--line); border-radius: 0; }
    .gauge-wrap { display: flex; align-items: center; gap: 26px; flex-wrap: wrap; }
    .insight-plain { font-size: 13px; line-height: 1.7; margin: 20px 0 0; padding-top: 16px; border-top: 1px solid var(--line); color: var(--muted); }
    .anomaly-list { display: grid; gap: 8px; }
    .anomaly-item { display: flex; gap: 14px; align-items: flex-start; padding: 15px 0; border-top: 1px solid var(--line); font-size: 13px; background: transparent; }
    .anomaly-item .a-icon { min-width: 44px; color: var(--muted); font: 10px "DM Mono", monospace; letter-spacing: 0.08em; text-transform: uppercase; }
    .anomaly-item .a-date { color: var(--muted); font-size: 12px; margin-top: 2px; }
    .pill { display: inline-block; padding: 2px 7px; border-radius: 0; font: 10px "DM Mono", monospace; margin-left: 6px; }
    .pill-worse { border: 1px solid #d9a39c; color: var(--coral); }
    .pill-better { border: 1px solid #9cc7ad; color: #21643d; }
    @media (max-width: 760px) {
      .analytics-hero { display: block; }
      .analytics-hero-note { display: block; margin-top: 10px; }
      .analytics-grid { grid-template-columns: 1fr; }
      .analytics-card:nth-child(5) { grid-column: auto; }
    }
  </style>

  <header class="topbar">
    <div><div class="eyebrow">Insights / analytics</div><h1>Smart analytics.</h1></div>
    <div class="top-date"><strong>ANALYTICS</strong>${fromCache ? "Saved offline results" : "Up to date"}</div>
  </header>

  <div class="analytics-hero">
    <p>Review the patterns behind your trips, fuel use, and service schedule. These summaries are calculated on this device from the records you have logged.</p>
    <span class="analytics-hero-note">${tripRows.length} trips · ${fuelRows.length} fill-ups · ${vehicleRows.length} vehicles</span>
  </div>

  <div id="analytics-alerts"></div>

  <div class="analytics-grid">
    <section class="card analytics-card" aria-labelledby="efficiency-title">
      <h3 id="efficiency-title">Fuel efficiency</h3>
      <div class="card-sub">How many kilometres you get per litre, per fill-up</div>
      <div class="chart-wrap chart-wrap-efficiency" id="efficiency-chart"></div>
      <p class="insight-plain" id="efficiency-insight"></p>
    </section>

    <section class="card analytics-card" aria-labelledby="category-title">
      <h3 id="category-title">Business and personal distance</h3>
      <div class="card-sub">Business vs personal driving · tax year ${saTaxYear().label}</div>
      <div class="chart-wrap" id="category-chart"></div>
      <p class="insight-plain" id="category-insight"></p>
    </section>

    <section class="card analytics-card" aria-labelledby="service-title">
      <h3 id="service-title">Service health</h3>
      <div class="card-sub">How well your vehicles are keeping to their service schedule</div>
      <div class="chart-wrap" id="compliance-gauge"></div>
    </section>

    <section class="card analytics-card" aria-labelledby="predictions-title">
      <h3 id="predictions-title">Looking ahead</h3>
      <div class="card-sub">Predictions based on how you actually drive</div>
      <div class="stat-list" id="predictions-list"></div>
    </section>

    <section class="card analytics-card" style="grid-column: 1 / -1" aria-labelledby="anomalies-title">
      <h3 id="anomalies-title">Things worth a look</h3>
      <div class="card-sub">Unusual trips or fill-ups compared to your own history</div>
      <div id="anomalies-list"></div>
    </section>
  </div>
  `,
);

await requestServiceNotifications();
vehicleRows.forEach(notifyServiceDue);
restorePendingServiceReminders(vehicleRows);

const alertsEl = document.querySelector("#analytics-alerts");

// ---------- Friendly empty state when there's nothing to analyze ----------
if (!analytics || !hasData) {
  alertsEl.innerHTML = `
    <div class="alert-banner alert-low">
      <span class="alert-icon">INFO</span>
      <div><strong>Nothing to analyze yet.</strong> Add a vehicle, log a few trips and fill-ups, and this page will come alive with trends, predictions, and alerts.</div>
    </div>`;
  document.querySelector("#efficiency-chart").innerHTML = '<div class="chart-empty">Log a couple of fill-ups to see your fuel efficiency trend.</div>';
  document.querySelector("#category-chart").innerHTML = '<div class="chart-empty">Record trips to see your business vs personal split.</div>';
  document.querySelector("#compliance-gauge").innerHTML = '<div class="chart-empty">Set a next-service mileage on your vehicles to track service health.</div>';
  document.querySelector("#predictions-list").innerHTML = '<div class="chart-empty">Predictions appear once you\'ve logged some driving.</div>';
  document.querySelector("#anomalies-list").innerHTML = '<div class="chart-empty">Anomalies are detected automatically once there\'s enough history.</div>';
  throw new Error("No analytics data yet");
}

// ---------- Proactive alert banners (plain language + icons) ----------
const alertIcon = { high: "ACTION", medium: "CHECK", low: "NOTE" };
const alertTitle = { high: "Action needed", medium: "Heads up", low: "Notice" };

if (analytics.alerts?.length) {
  alertsEl.innerHTML = analytics.alerts
    .map(
      (a) => `
      <div class="alert-banner alert-${escape(a.severity)}">
        <span class="alert-icon">${alertIcon[a.severity] || "ℹ️"}</span>
        <div><strong>${alertTitle[a.severity] || "Notice"}.</strong> ${escape(a.message)}</div>
      </div>`,
    )
    .join("");
} else {
  alertsEl.innerHTML = `
    <div class="alert-banner alert-ok">
      <span class="alert-icon">CLEAR</span>
      <div><strong>All clear.</strong> Your driving, fuel use, and service schedule all look healthy.</div>
    </div>`;
}

// ---------- SVG: fuel efficiency line chart ----------
function renderEfficiencyChart(points) {
  const container = document.querySelector("#efficiency-chart");
  const insight = document.querySelector("#efficiency-insight");
  if (!container) return;

  if (!points || points.length < 2) {
    container.innerHTML = '<div class="chart-empty">Log a couple of fill-ups with efficiency data to see your trend.</div>';
    if (insight) insight.textContent = "";
    return;
  }

  const W = 560, H = 200, PAD = { top: 18, right: 16, bottom: 30, left: 46 };
  const values = points.map((p) => p.kmPerL);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i) => PAD.left + (i / (points.length - 1)) * (W - PAD.left - PAD.right);
  const y = (v) => PAD.top + (1 - (v - min) / span) * (H - PAD.top - PAD.bottom);

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.kmPerL).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${x(points.length - 1).toFixed(1)},${H - PAD.bottom} L${x(0).toFixed(1)},${H - PAD.bottom} Z`;

  const gridLines = Array.from({ length: 5 }, (_, i) => {
    const v = min + (span * i) / 4;
    const yy = y(v);
    return `<line x1="${PAD.left}" y1="${yy}" x2="${W - PAD.right}" y2="${yy}" stroke="rgba(128,128,128,0.18)"/><text x="${PAD.left - 6}" y="${yy + 3}" font-size="9" text-anchor="end" fill="currentColor" opacity="0.55">${v.toFixed(1)}</text>`;
  }).join("");

  const dots = points
    .map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.kmPerL).toFixed(1)}" r="3.5" fill="${palette.primary}"><title>${escape(p.date)} — ${p.kmPerL} km/L</title></circle>`)
    .join("");

  const labelStep = Math.max(1, Math.ceil(points.length / 5));
  const xLabels = points
    .map((p, i) => (i % labelStep === 0 ? `<text x="${x(i).toFixed(1)}" y="${H - 10}" font-size="9" text-anchor="middle" fill="currentColor" opacity="0.55">${escape(p.date.slice(5))}</text>` : ""))
    .join("");

  container.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Fuel efficiency trend">
    ${gridLines}
    <path class="analytics-area" d="${areaPath}" fill="${palette.primary}" fill-opacity="0.08"/>
    <path class="analytics-line" d="${linePath}" fill="none" stroke="${palette.primary}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}${xLabels}
  </svg>`;

  // Plain-English insight
  if (insight) {
    const latest = points[points.length - 1].kmPerL;
    const best = max;
    const worst = min;
    const first = points[0].kmPerL;
    const trendPct = ((latest - first) / first) * 100;
    let sentence = `Your latest fill-up gave ${latest} km/L`;
    if (Math.abs(trendPct) >= 3) {
      sentence += trendPct > 0 ? ` — improving by about ${Math.abs(trendPct).toFixed(0)}% since ${escape(points[0].date)}.` : ` — down about ${Math.abs(trendPct).toFixed(0)}% since ${escape(points[0].date)}.`;
    } else {
      sentence += ` — holding steady.`;
    }
    sentence += ` Your best was ${best} km/L and your lowest ${worst} km/L.`;
    insight.textContent = sentence;
  }
}

// ---------- SVG: trip category pie chart ----------
function renderCategoryChart(categories) {
  const container = document.querySelector("#category-chart");
  const insight = document.querySelector("#category-insight");
  if (!container) return;
  const { business, personal, businessTrips, personalTrips } = categories;

  if (business + personal <= 0) {
    container.innerHTML = '<div class="chart-empty">No trips recorded this tax year yet. Start a live trip or add one manually.</div>';
    if (insight) insight.textContent = "";
    return;
  }

  const W = 560, H = 220;
  const cx = 150, cy = 108, radius = 78;
  const total = business + personal;
  const polar = (angle) => {
    const radians = (angle - 90) * Math.PI / 180;
    return [cx + radius * Math.cos(radians), cy + radius * Math.sin(radians)];
  };
  const slice = (value, color, label, count, startAngle) => {
    const endAngle = startAngle + (value / total) * 360;
    const [x1, y1] = polar(startAngle);
    const [x2, y2] = polar(endAngle);
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    return `<path class="pie-slice" d="M ${cx} ${cy} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${radius} ${radius} 0 ${largeArc} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="${color}" stroke="${themeColor("--surface", "#fff")}" stroke-width="3"><title>${label}: ${value.toLocaleString()} km across ${count} trips</title></path>`;
  };
  const businessPct = Math.round((business / total) * 100);
  const personalPct = 100 - businessPct;

  container.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Business versus personal driving pie chart">
    ${slice(business, palette.primary, "Business", businessTrips, 0)}
    ${slice(personal, palette.muted, "Personal", personalTrips, (business / total) * 360)}
    <circle cx="${cx}" cy="${cy}" r="42" fill="${themeColor("--surface", "#fff")}"/>
    <text x="${cx}" y="${cy - 2}" font-size="22" font-weight="700" text-anchor="middle" fill="currentColor">${businessPct}%</text>
    <text x="${cx}" y="${cy + 16}" font-size="10" text-anchor="middle" fill="currentColor" opacity="0.6">business</text>
    <g transform="translate(300 72)"><rect width="10" height="10" fill="${palette.primary}"/><text x="18" y="10" font-size="12" fill="currentColor">Business · ${businessPct}%</text><text x="18" y="28" font-size="10" fill="currentColor" opacity="0.6">${business.toLocaleString()} km · ${businessTrips} trips</text></g>
    <g transform="translate(300 132)"><rect width="10" height="10" fill="${palette.muted}"/><text x="18" y="10" font-size="12" fill="currentColor">Personal · ${personalPct}%</text><text x="18" y="28" font-size="10" fill="currentColor" opacity="0.6">${personal.toLocaleString()} km · ${personalTrips} trips</text></g>
  </svg>`;

  if (insight) {
    const total = business + personal;
    const pct = Math.round((business / total) * 100);
    insight.textContent = `So far this tax year, ${pct}% of your driving is business — that's the portion you can claim. Keep logging every trip so the split stays accurate for SARS.`;
  }
}

// ---------- SVG: service compliance gauge ----------
function renderComplianceGauge(compliance, intervals) {
  const container = document.querySelector("#compliance-gauge");
  if (!container) return;
  const { score, overdueCount, dueSoonCount, trackedCount } = compliance;

  if (!trackedCount) {
    container.innerHTML = '<div class="chart-empty">Set a next-service mileage on your vehicles (My vehicles → edit) to track service health.</div>';
    return;
  }

  const cx = 110, cy = 110, r = 82;
  const polar = (angleDeg) => {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };
  const arc = (fromDeg, toDeg) => {
    const [x1, y1] = polar(fromDeg);
    const [x2, y2] = polar(toDeg);
    const largeArc = toDeg - fromDeg > 180 ? 1 : 0;
    return `M${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${largeArc} 1 ${x2.toFixed(1)},${y2.toFixed(1)}`;
  };

  const startAngle = -120, endAngle = 120;
  const scoreAngle = startAngle + ((endAngle - startAngle) * score) / 100;
  const color = score >= 80 ? palette.good : score >= 50 ? palette.warn : palette.bad;
  const verdict =
    score >= 80 ? "Looking good" : score >= 50 ? "Keep an eye on it" : "Needs attention";

  const overdueList = intervals
    .filter((s) => s.overdue)
    .map((s) => `<div class="stat-row"><span>${escape(s.plate)}</span><strong style="color:${palette.bad}">${Math.abs(s.remainingKm).toLocaleString()} km overdue</strong></div>`)
    .join("");
  const soonList = intervals
    .filter((s) => !s.overdue && s.dueSoon)
    .map((s) => `<div class="stat-row"><span>${escape(s.plate)}</span><strong>${s.remainingKm.toLocaleString()} km to go</strong></div>`)
    .join("");

  container.innerHTML = `
    <div class="gauge-wrap">
      <svg viewBox="0 0 220 145" style="max-width:220px;flex:0 0 auto" role="img" aria-label="Service compliance ${score} percent">
        <path d="${arc(startAngle, endAngle)}" fill="none" stroke="${palette.track}" stroke-width="14" stroke-linecap="round"/>
        <path d="${arc(startAngle, scoreAngle)}" fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round"/>
        <text x="${cx}" y="${cy + 2}" font-size="30" font-weight="700" text-anchor="middle" fill="${color}">${score}%</text>
        <text x="${cx}" y="${cy + 22}" font-size="10.5" text-anchor="middle" fill="currentColor" opacity="0.65">${verdict}</text>
      </svg>
      <div class="stat-list" style="flex:1;min-width:170px">
        <div class="stat-row"><span>Vehicles tracked</span><strong>${trackedCount}</strong></div>
        ${overdueList || `<div class="stat-row"><span>Overdue</span><strong style="color:${palette.good}">None</strong></div>`}
        ${soonList}
      </div>
    </div>`;
}

// ---------- Predictions (plain language) ----------
function renderPredictions(analyticsData) {
  const container = document.querySelector("#predictions-list");
  if (!container) return;
  const { monthlyFuel, taxYearSplit } = analyticsData.predictions;
  const servicePredictions = analyticsData.service.predictions.filter((p) => p.predictedDate);

  const rows = [];
  rows.push(
    monthlyFuel.monthlyCost !== null
      ? `<div class="stat-row"><span>Fuel budget for a typical month</span><strong>± R ${monthlyFuel.monthlyCost.toLocaleString()} <small style="font-weight:400;opacity:0.65">(${monthlyFuel.monthlyLitres} L)</small></strong></div>`
      : `<div class="stat-row"><span>Fuel budget for a typical month</span><strong>Log a few fill-ups first</strong></div>`,
  );
  rows.push(
    `<div class="stat-row"><span>Projected business driving (${taxYearSplit.taxYearLabel} tax year)</span><strong>${taxYearSplit.projectedBusinessKm.toLocaleString()} km of ${taxYearSplit.projectedTotalKm.toLocaleString()} km (${taxYearSplit.projectedBusinessPct}%)</strong></div>`,
  );
  if (servicePredictions.length) {
    servicePredictions.forEach((p) => {
      const date = new Date(p.predictedDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
      rows.push(`<div class="stat-row"><span>${escape(p.plate)} next service</span><strong>around ${escape(date)}</strong></div>`);
    });
  } else {
    rows.push(`<div class="stat-row"><span>Next service dates</span><strong>Needs more trip history</strong></div>`);
  }

  container.innerHTML = rows.join("");
}

// ---------- Anomalies (friendly cards) ----------
function renderAnomalies(analyticsData) {
  const container = document.querySelector("#anomalies-list");
  if (!container) return;
  const { trips: tripAnomalies, fuel: fuelAnomalies } = analyticsData.anomalies;

  if (!tripAnomalies.length && !fuelAnomalies.length) {
    container.innerHTML = '<div class="chart-empty">Nothing unusual so far — your trips and fuel use are consistent with your own history.</div>';
    return;
  }

  const tripItems = tripAnomalies.map(
    (a) => `
    <div class="anomaly-item">
      <span class="a-icon">TRIP</span>
      <div>
        <div>A trip of <strong>${a.distanceKm.toLocaleString()} km</strong> — ${Math.abs(a.deviationPct).toFixed(0)}% ${a.direction === "above" ? "longer" : "shorter"} than your usual ${a.averageKm.toLocaleString()} km
          <span class="pill ${a.direction === "above" ? "pill-worse" : "pill-better"}">${a.deviationPct > 0 ? "+" : ""}${a.deviationPct}%</span>
        </div>
        <div class="a-date">${escape(a.date)} · worth double-checking the odometer readings if this doesn't look right</div>
      </div>
    </div>`,
  );

  const fuelItems = fuelAnomalies.map(
    (a) => `
    <div class="anomaly-item">
      <span class="a-icon">FUEL</span>
      <div>
        <div>A fill-up used <strong>${a.consumption} L/100km</strong> — ${Math.abs(a.deviationPct).toFixed(0)}% ${a.direction === "worse" ? "worse" : "better"} than your recent ${a.baseline} L/100km
          <span class="pill ${a.direction === "worse" ? "pill-worse" : "pill-better"}">${a.deviationPct > 0 ? "+" : ""}${a.deviationPct}%</span>
        </div>
        <div class="a-date">${escape(a.date)}${a.direction === "worse" ? " · could indicate a leak, tyre pressure, or heavy load" : " · nice driving!"}</div>
      </div>
    </div>`,
  );

  container.innerHTML = `<div class="anomaly-list">${[...tripItems, ...fuelItems].join("")}</div>`;
}

// ---------- Render everything ----------
renderEfficiencyChart(analytics.charts?.efficiencyPoints);
renderCategoryChart(analytics.charts?.categories || { business: 0, personal: 0, businessTrips: 0, personalTrips: 0 });
renderComplianceGauge(analytics.service?.compliance || { score: 100, overdueCount: 0, dueSoonCount: 0, trackedCount: 0 }, analytics.service?.intervals || []);
renderPredictions(analytics);
renderAnomalies(analytics);

console.log("[analytics] dashboard rendered", {
  alerts: analytics.alerts?.length ?? 0,
  computedAt: analytics.computedAt,
  threshold: getEfficiencyDropThreshold(),
});
