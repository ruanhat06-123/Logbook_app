/**
 * Smart Analytics Engine
 * Fully client-side analytics for LogMate: anomaly detection, predictive
 * insights, and alert generation over trip, fuel, and service data.
 * Results are cached in the IndexedDB-backed local store and reused
 * offline; call computeAnalytics() again whenever new data is logged.
 */

import { getLocalStore, setLocalStore } from "./localStore.js";

const log = (...args) => console.log("[Analytics]", ...args);
const warn = (...args) => console.warn("[Analytics]", ...args);

const CACHE_KEY = "analyticsResults";

/** Number of recent fill-ups used as the fuel-consumption baseline. */
const FUEL_BASELINE_WINDOW = 5;
/** Trip mileage anomaly band (±20% of the historical average). */
const TRIP_ANOMALY_BAND = 0.2;
/** Fuel consumption anomaly band (±20% of the baseline average). */
const FUEL_ANOMALY_BAND = 0.2;
/** Default fuel-efficiency drop alert threshold (percent). */
const DEFAULT_EFFICIENCY_DROP_PCT = 15;
/** Service prediction lead distance in km. */
const SERVICE_LEAD_KM = 1000;

/**
 * Get the configurable efficiency-drop threshold (percent).
 */
export function getEfficiencyDropThreshold() {
  const stored = Number(localStorage.getItem("analyticsEfficiencyDropPct"));
  return Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_EFFICIENCY_DROP_PCT;
}

/**
 * South African tax year (1 March → end of February) containing the date.
 */
export function saTaxYear(referenceDate = new Date()) {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth(); // 0-based; 2 = March
  const startYear = month >= 2 ? year : year - 1;
  return {
    start: new Date(startYear, 2, 1),
    end: new Date(startYear + 1, 1, 0),
    label: `${startYear}/${String(startYear + 1).slice(2)}`,
  };
}

const toDate = (value) => {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const tripDistance = (trip) => {
  const direct = num(trip.trip_distance_km ?? trip.distance_km);
  if (direct !== null) return direct;
  const start = num(trip.mileage_start ?? trip.mileage_start_km) ?? 0;
  const end = num(trip.mileage_end ?? trip.mileage_end_km) ?? 0;
  return Math.max(0, end - start);
};

/**
 * Detect trips whose distance falls outside ±20% of the vehicle's
 * historical average trip distance.
 */
function detectTripAnomalies(trips) {
  const byVehicle = new Map();
  trips.forEach((trip) => {
    const key = String(trip.vehicle_id ?? "unknown");
    if (!byVehicle.has(key)) byVehicle.set(key, []);
    byVehicle.get(key).push(trip);
  });

  const anomalies = [];
  byVehicle.forEach((vehicleTrips) => {
    const distances = vehicleTrips.map(tripDistance).filter((d) => d > 0);
    if (distances.length < 3) return; // need history to establish an average
    const average = distances.reduce((s, d) => s + d, 0) / distances.length;
    const lower = average * (1 - TRIP_ANOMALY_BAND);
    const upper = average * (1 + TRIP_ANOMALY_BAND);

    vehicleTrips.forEach((trip) => {
      const distance = tripDistance(trip);
      if (distance <= 0) return;
      if (distance < lower || distance > upper) {
        const deviationPct = ((distance - average) / average) * 100;
        anomalies.push({
          kind: "trip-distance",
          tripId: trip.id,
          vehicleId: trip.vehicle_id,
          date: toDate(trip.created_at)?.toISOString().slice(0, 10) || "",
          distanceKm: Math.round(distance),
          averageKm: Math.round(average),
          deviationPct: Number(deviationPct.toFixed(1)),
          direction: distance > upper ? "above" : "below",
          message: `Trip of ${Math.round(distance)} km is ${Math.abs(deviationPct).toFixed(0)}% ${distance > upper ? "above" : "below"} the average of ${Math.round(average)} km`,
        });
      }
    });
  });
  return anomalies;
}

/**
 * Highlight fuel entries whose consumption deviates from the average of the
 * previous 5 fill-ups for the same vehicle.
 */
function detectFuelAnomalies(fuelEntries) {
  const byVehicle = new Map();
  fuelEntries.forEach((entry) => {
    const key = String(entry.vehicle_id ?? "unknown");
    if (!byVehicle.has(key)) byVehicle.set(key, []);
    byVehicle.get(key).push(entry);
  });

  const anomalies = [];
  byVehicle.forEach((entries) => {
    const sorted = [...entries]
      .filter((e) => toDate(e.created_at))
      .sort((a, b) => toDate(a.created_at) - toDate(b.created_at));

    const history = [];
    sorted.forEach((entry) => {
      const consumption = num(entry.fuel_consumption_l_per_100km);
      if (consumption === null || consumption <= 0) return;

      if (history.length >= 3) {
        const window = history.slice(-FUEL_BASELINE_WINDOW);
        const baseline = window.reduce((s, v) => s + v, 0) / window.length;
        const lower = baseline * (1 - FUEL_ANOMALY_BAND);
        const upper = baseline * (1 + FUEL_ANOMALY_BAND);
        if (consumption < lower || consumption > upper) {
          const deviationPct = ((consumption - baseline) / baseline) * 100;
          anomalies.push({
            kind: "fuel-consumption",
            entryId: entry.id,
            vehicleId: entry.vehicle_id,
            date: toDate(entry.created_at)?.toISOString().slice(0, 10) || "",
            consumption: Number(consumption.toFixed(2)),
            baseline: Number(baseline.toFixed(2)),
            deviationPct: Number(deviationPct.toFixed(1)),
            direction: consumption > upper ? "worse" : "better",
            message: `Consumption of ${consumption.toFixed(1)} L/100km is ${Math.abs(deviationPct).toFixed(0)}% ${consumption > upper ? "worse" : "better"} than the recent average of ${baseline.toFixed(1)} L/100km`,
          });
        }
      }
      history.push(consumption);
    });
  });
  return anomalies;
}

/**
 * Detect overdue service intervals and build per-vehicle service status.
 */
function analyzeServiceIntervals(vehicles) {
  return vehicles.map((vehicle) => {
    const current = num(vehicle.current_mileage) ?? 0;
    const next = num(vehicle.next_service_mileage);
    const remaining = next === null ? null : next - current;
    const overdue = remaining !== null && remaining < 0;
    const dueSoon = remaining !== null && remaining >= 0 && remaining <= SERVICE_LEAD_KM;
    return {
      vehicleId: vehicle.id,
      plate: vehicle.number_plate || "Vehicle",
      currentMileage: current,
      nextServiceMileage: next,
      remainingKm: remaining,
      overdue,
      dueSoon,
    };
  });
}

/**
 * Predict the next service date per vehicle from average daily usage,
 * which is estimated from trip history (km per day over the observed span).
 */
function predictServiceDates(vehicles, trips) {
  return vehicles.map((vehicle) => {
    const current = num(vehicle.current_mileage) ?? 0;
    const next = num(vehicle.next_service_mileage);

    const vehicleTrips = trips
      .filter((t) => String(t.vehicle_id) === String(vehicle.id) && toDate(t.created_at))
      .sort((a, b) => toDate(a.created_at) - toDate(b.created_at));

    let kmPerDay = null;
    if (vehicleTrips.length >= 2) {
      const first = vehicleTrips[0];
      const last = vehicleTrips[vehicleTrips.length - 1];
      const startOdo = num(first.mileage_start ?? first.mileage_start_km);
      const endOdo = num(last.mileage_end ?? last.mileage_end_km);
      const days = Math.max(1, (toDate(last.created_at) - toDate(first.created_at)) / 86400000);
      if (startOdo !== null && endOdo !== null && endOdo > startOdo) {
        kmPerDay = (endOdo - startOdo) / days;
      }
    }

    let predictedDate = null;
    let daysRemaining = null;
    if (next !== null && kmPerDay && kmPerDay > 0) {
      const kmRemaining = next - current;
      daysRemaining = Math.round(kmRemaining / kmPerDay);
      predictedDate = new Date(Date.now() + Math.max(0, daysRemaining) * 86400000)
        .toISOString()
        .slice(0, 10);
    }

    return {
      vehicleId: vehicle.id,
      plate: vehicle.number_plate || "Vehicle",
      nextServiceMileage: next,
      kmPerDay: kmPerDay ? Number(kmPerDay.toFixed(1)) : null,
      kmPerWeek: kmPerDay ? Number((kmPerDay * 7).toFixed(0)) : null,
      predictedDate,
      daysRemaining,
    };
  });
}

/**
 * Estimate monthly fuel cost from recent fill-ups (last 90 days),
 * extrapolated to a 30-day month.
 */
function estimateMonthlyFuelCost(fuelEntries) {
  const since = new Date();
  since.setDate(since.getDate() - 90);

  const recent = fuelEntries.filter((entry) => {
    const d = toDate(entry.created_at);
    return d && d >= since;
  });

  const totalCost = recent.reduce((s, e) => s + (num(e.total_cost) ?? 0), 0);
  const totalLitres = recent.reduce((s, e) => s + (num(e.fuel_amount_liters) ?? 0), 0);
  const days = Math.max(1, (Date.now() - Math.min(...recent.map((e) => toDate(e.created_at)?.getTime() ?? Date.now()))) / 86400000);

  if (!recent.length || totalCost <= 0) {
    return { monthlyCost: null, monthlyLitres: null, sampleDays: 0, fillUps: 0 };
  }

  const dailyCost = totalCost / days;
  const dailyLitres = totalLitres / days;
  return {
    monthlyCost: Math.round(dailyCost * 30),
    monthlyLitres: Number((dailyLitres * 30).toFixed(1)),
    sampleDays: Math.round(days),
    fillUps: recent.length,
  };
}

/**
 * Project the business vs personal mileage split for the current SA tax
 * year by extrapolating the split observed so far.
 */
function projectTaxYearSplit(trips) {
  const taxYear = saTaxYear();
  const yearTrips = trips.filter((t) => {
    const d = toDate(t.created_at);
    return d && d >= taxYear.start && d <= taxYear.end;
  });

  const businessKm = yearTrips
    .filter((t) => String(t.trip_type) === "business")
    .reduce((s, t) => s + tripDistance(t), 0);
  const personalKm = yearTrips
    .filter((t) => String(t.trip_type) === "personal")
    .reduce((s, t) => s + tripDistance(t), 0);
  const totalKm = businessKm + personalKm;

  const elapsedDays = Math.max(1, (Date.now() - taxYear.start.getTime()) / 86400000);
  const totalDays = Math.max(1, (taxYear.end.getTime() - taxYear.start.getTime()) / 86400000);
  const yearProgress = Math.min(1, elapsedDays / totalDays);

  const projectedTotal = yearProgress > 0 ? totalKm / yearProgress : 0;
  const projectedBusiness = yearProgress > 0 ? businessKm / yearProgress : 0;
  const projectedPersonal = yearProgress > 0 ? personalKm / yearProgress : 0;

  return {
    taxYearLabel: taxYear.label,
    yearProgressPct: Math.round(yearProgress * 100),
    actualBusinessKm: Math.round(businessKm),
    actualPersonalKm: Math.round(personalKm),
    projectedBusinessKm: Math.round(projectedBusiness),
    projectedPersonalKm: Math.round(projectedPersonal),
    projectedTotalKm: Math.round(projectedTotal),
    projectedBusinessPct: projectedTotal > 0 ? Number(((projectedBusiness / projectedTotal) * 100).toFixed(1)) : 0,
  };
}

/**
 * Build the fuel efficiency trend series (per fill-up, chronological) plus
 * the drop alert relative to the configurable threshold.
 */
function fuelEfficiencyTrend(fuelEntries) {
  const sorted = [...fuelEntries]
    .filter((e) => toDate(e.created_at) && num(e.fuel_efficiency_km_per_l) !== null)
    .sort((a, b) => toDate(a.created_at) - toDate(b.created_at));

  const points = sorted.map((entry) => ({
    date: toDate(entry.created_at).toISOString().slice(0, 10),
    kmPerL: Number(num(entry.fuel_efficiency_km_per_l).toFixed(2)),
    lPer100: num(entry.fuel_consumption_l_per_100km),
    vehicleId: entry.vehicle_id,
  }));

  let dropAlert = null;
  if (points.length >= 3) {
    const threshold = getEfficiencyDropThreshold();
    const baselineWindow = points.slice(-(FUEL_BASELINE_WINDOW + 1), -1);
    const baseline = baselineWindow.reduce((s, p) => s + p.kmPerL, 0) / baselineWindow.length;
    const latest = points[points.length - 1].kmPerL;
    const dropPct = ((baseline - latest) / baseline) * 100;
    if (dropPct >= threshold) {
      dropAlert = {
        kind: "fuel-efficiency-drop",
        latestKmPerL: latest,
        baselineKmPerL: Number(baseline.toFixed(2)),
        dropPct: Number(dropPct.toFixed(1)),
        thresholdPct: threshold,
        message: `Fuel efficiency dropped ${dropPct.toFixed(0)}% (${baseline.toFixed(1)} → ${latest} km/L), beyond the ${threshold}% threshold`,
      };
    }
  }

  return { points, dropAlert };
}

/**
 * Trip category totals for the bar chart (current tax year).
 */
function tripCategoryTotals(trips) {
  const taxYear = saTaxYear();
  const yearTrips = trips.filter((t) => {
    const d = toDate(t.created_at);
    return d && d >= taxYear.start && d <= taxYear.end;
  });
  const business = yearTrips
    .filter((t) => String(t.trip_type) === "business")
    .reduce((s, t) => s + tripDistance(t), 0);
  const personal = yearTrips
    .filter((t) => String(t.trip_type) === "personal")
    .reduce((s, t) => s + tripDistance(t), 0);
  return {
    business: Math.round(business),
    personal: Math.round(personal),
    businessTrips: yearTrips.filter((t) => String(t.trip_type) === "business").length,
    personalTrips: yearTrips.filter((t) => String(t.trip_type) === "personal").length,
  };
}

/**
 * Service compliance score (0–100): fraction of vehicles not overdue,
 * weighted down for vehicles due soon.
 */
function serviceComplianceScore(serviceIntervals) {
  const tracked = serviceIntervals.filter((s) => s.nextServiceMileage !== null);
  if (!tracked.length) return { score: 100, overdueCount: 0, dueSoonCount: 0, trackedCount: 0 };
  const overdueCount = tracked.filter((s) => s.overdue).length;
  const dueSoonCount = tracked.filter((s) => !s.overdue && s.dueSoon).length;
  const score = Math.max(
    0,
    Math.round(100 - (overdueCount / tracked.length) * 70 - (dueSoonCount / tracked.length) * 30),
  );
  return { score, overdueCount, dueSoonCount, trackedCount: tracked.length };
}

/**
 * Compute the full analytics result and cache it locally.
 * @param {object} input
 * @param {Array} input.vehicles - rows from the vehicles table
 * @param {Array} input.trips - rows from the trips table
 * @param {Array} input.fuelEntries - rows from car_logbook where entry_type = 'refuel'
 * @returns {Promise<object>} analytics result
 */
export async function computeAnalytics({ vehicles = [], trips = [], fuelEntries = [] } = {}) {
  const tripAnomalies = detectTripAnomalies(trips);
  const fuelAnomalies = detectFuelAnomalies(fuelEntries);
  const serviceIntervals = analyzeServiceIntervals(vehicles);
  const servicePredictions = predictServiceDates(vehicles, trips);
  const monthlyFuel = estimateMonthlyFuelCost(fuelEntries);
  const taxYearSplit = projectTaxYearSplit(trips);
  const efficiency = fuelEfficiencyTrend(fuelEntries);
  const categories = tripCategoryTotals(trips);
  const compliance = serviceComplianceScore(serviceIntervals);

  // Assemble proactive alerts
  const alerts = [];
  serviceIntervals
    .filter((s) => s.overdue)
    .forEach((s) =>
      alerts.push({
        severity: "high",
        kind: "service-overdue",
        message: `${s.plate} is ${Math.abs(s.remainingKm).toLocaleString()} km overdue for service`,
      }),
    );
  servicePredictions
    .filter((p) => {
      const interval = serviceIntervals.find((s) => String(s.vehicleId) === String(p.vehicleId));
      return interval && !interval.overdue && interval.dueSoon;
    })
    .forEach((p) =>
      alerts.push({
        severity: "medium",
        kind: "service-due-soon",
        message: `${p.plate} service due in ${Math.max(0, serviceIntervals.find((s) => String(s.vehicleId) === String(p.vehicleId)).remainingKm).toLocaleString()} km${p.predictedDate ? ` (predicted ${p.predictedDate})` : ""}`,
      }),
    );
  if (efficiency.dropAlert) {
    alerts.push({ severity: "medium", kind: efficiency.dropAlert.kind, message: efficiency.dropAlert.message });
  }
  tripAnomalies.slice(0, 5).forEach((a) =>
    alerts.push({ severity: "low", kind: a.kind, message: `${a.date}: ${a.message}` }),
  );
  fuelAnomalies.slice(0, 5).forEach((a) =>
    alerts.push({ severity: "low", kind: a.kind, message: `${a.date}: ${a.message}` }),
  );

  const result = {
    computedAt: new Date().toISOString(),
    anomalies: { trips: tripAnomalies, fuel: fuelAnomalies },
    service: { intervals: serviceIntervals, predictions: servicePredictions, compliance },
    predictions: { monthlyFuel, taxYearSplit },
    charts: { efficiencyPoints: efficiency.points, categories },
    alerts,
  };

  try {
    await setLocalStore(CACHE_KEY, result);
  } catch (err) {
    warn("Failed to cache analytics results:", err);
  }

  log("Analytics computed", {
    tripAnomalies: tripAnomalies.length,
    fuelAnomalies: fuelAnomalies.length,
    alerts: alerts.length,
  });

  return result;
}

/**
 * Load the cached analytics result (offline-first), or null when nothing
 * has been computed yet.
 */
export async function getCachedAnalytics() {
  return (await getLocalStore(CACHE_KEY)) || null;
}

export default {
  computeAnalytics,
  getCachedAnalytics,
  getEfficiencyDropThreshold,
  saTaxYear,
};
