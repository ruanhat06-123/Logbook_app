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
    .analytics-hero { margin-bottom: 20px; }
    .analytics-hero p { color: var(--muted); max-width: 640px; }
    .analytics-grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); }
    .analytics-card h3 { margin: 0 0 2px; font-size: 17px; }
    .analytics-card .card-sub { color: var(--muted); font-size: 13px; margin-bottom: 14px; }
    .alert-banner { padding: 12px 16px; border-radius: 10px; margin-bottom: 10px; font-size: 14px; border-left: 4px solid; display: flex; gap: 10px; align-items: flex-start; }
    .alert-banner .alert-icon { font-size: 17px; line-height: 1.2; }
    .alert-high { background: #fdecea; border-color: var(--coral); color: #7b241c; }
    .alert-medium { background: #fef5e7; border-color: var(--yellow); color: #7e5109; }
    .alert-low { background: #eaf2f8; border-color: var(--teal); color: #1b4f72; }
    .alert-ok { background: #eafaf1; border-color: var(--mint); color: #145a32; }
    [data-theme="dark"] .alert-high { background: #3b1512; color: #f5b7b1; }
    [data-theme="dark"] .alert-medium { background: #3a2c10; color: #f8c471; }
    [data-theme="dark"] .alert-low { background: #12293a; color: #85c1e9; }
    [data-theme="dark"] .alert-ok { background: #10301c; color: #7dcea0; }
    .stat-list { display: grid; gap: 10px; }
    .stat-row { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; align-items: baseline; }
    .stat-row span { color: var(--muted); }
    .stat-row strong { white-space: nowrap; text-align: right; color: var(--ink); }
    .chart-wrap { width: 100%; }
    .chart-wrap svg { width: 100%; height: auto; display: block; }
    .chart-empty { padding: 26px 10px; text-align: center; color: var(--muted); font-size: 13px; }
    .gauge-wrap { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
    .insight-plain { font-size: 14px; line-height: 1.55; margin: 0 0 10px; color: var(--ink); }
    .anomaly-list { display: grid; gap: 8px; }
    .anomaly-item { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; font-size: 13.5px; background: var(--surface); }
    .anomaly-item .a-icon { font-size: 15px; }
    .anomaly-item .a-date { color: var(--muted); font-size: 12px; margin-top: 2px; }
    .pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; margin-left: 6px; }
    .pill-worse { background: #fdecea; color: #7b241c; }
    .pill-better { background: #eafaf1; color: #145a32; }
    [data-theme="dark"] .pill-worse { background: #3b1512; color: #f5b7b1; }
    [data-theme="dark"] .pill-better { background: #10301c; color: #7dcea0; }
  </style>

  <header class="topbar">
    <div><div class="eyebrow">Insights / analytics</div><h1>Smart analytics.</h1></div>
    <div class="top-date"><strong>ANALYTICS</strong>${fromCache ? "Saved offline results" : "Up to date"}</div>
  </header>

  <div class="analytics-hero">
    <p>LogMate quietly studies your trips, fill-ups, and services to spot anything unusual, predict what's coming, and help you stay on top of your vehicles — all computed on this device.</p>
  </div>

  <div id="analytics-alerts"></div>

  <div class="analytics-grid">
    <section class="card analytics-card">
      <h3>Fuel efficiency</h3>
      <div class="card-sub">How many kilometres you get per litre, per fill-up</div>
      <div class="chart-wrap" id="efficiency-chart"></div>
      <p class="insight-plain" id="efficiency-insight"></p>
    </section>

    <section class="card analytics-card">
      <h3>Where your kilometres go</h3>
      <div class="card-sub">Business vs personal driving · tax year ${saTaxYear().label}</div>
      <div class="chart-wrap" id="category-chart"></div>
      <p class="insight-plain" id="category-insight"></p>
    </section>

    <section class="card analytics-card">
      <h3>Service health</h3>
      <div class="card-sub">How well your vehicles are keeping to their service schedule</div>
      <div class="chart-wrap" id="compliance-gauge"></div>
    </section>

    <section class="card analytics-card">
      <h3>Looking ahead</h3>
      <div class="card-sub">Predictions based on how you actually drive</div>
      <div class="stat-list" id="predictions-list"></div>
    </section>

    <section class="card analytics-card" style="grid-column: 1 / -1">
      <h3>Things worth a look</h3>
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
      <span class="alert-icon">ℹ️</span>
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
const alertIcon = { high: "🔴", medium: "🟠", low: "🔵" };
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
      <span class="alert-icon">✅</span>
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
    <defs><linearGradient id="effGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${palette.primary}" stop-opacity="0.22"/><stop offset="100%" stop-color="${palette.primary}" stop-opacity="0"/>
    </linearGradient></defs>
    ${gridLines}
    <path d="${areaPath}" fill="url(#effGrad)"/>
    <path d="${linePath}" fill="none" stroke="${palette.primary}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
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

// ---------- SVG: trip category bar chart ----------
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

  const W = 560, H = 200, PAD = { top: 26, right: 16, bottom: 36, left: 16 };
  const maxVal = Math.max(business, personal, 1);
  const barWidth = 100;
  const gap = 130;
  const x0 = W / 2 - gap / 2 - barWidth;
  const x1 = W / 2 + gap / 2;
  const barH = (v) => ((H - PAD.top - PAD.bottom) * v) / maxVal;

  const bar = (x, value, color, label, count) => {
    const h = barH(value);
    const y = H - PAD.bottom - h;
    return `
      <rect x="${x}" y="${y.toFixed(1)}" width="${barWidth}" height="${h.toFixed(1)}" rx="8" fill="${color}"><title>${label}: ${value.toLocaleString()} km across ${count} trips</title></rect>
      <text x="${x + barWidth / 2}" y="${(y - 8).toFixed(1)}" font-size="13" font-weight="700" text-anchor="middle" fill="currentColor">${value.toLocaleString()} km</text>
      <text x="${x + barWidth / 2}" y="${H - 18}" font-size="12" text-anchor="middle" fill="currentColor">${label}</text>
      <text x="${x + barWidth / 2}" y="${H - 5}" font-size="10" text-anchor="middle" fill="currentColor" opacity="0.6">${count} trips</text>`;
  };

  container.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Business vs personal driving">
    <line x1="${PAD.left}" y1="${H - PAD.bottom}" x2="${W - PAD.right}" y2="${H - PAD.bottom}" stroke="${palette.track}"/>
    ${bar(x0, business, palette.primary, "Business", businessTrips)}
    ${bar(x1, personal, palette.muted, "Personal", personalTrips)}
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
      <span class="a-icon">🛣️</span>
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
      <span class="a-icon">⛽</span>
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
