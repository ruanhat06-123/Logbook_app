import { getLocalStore, setLocalStore } from "./localStore.js";

const WINDOW_DAYS = 30;
const RECENT_DAYS = 7;
const FORECAST_CACHE_PREFIX = "serviceForecast:";
const WARNING_LEAD_KM = 1000;
const DAY_MS = 86400000;

const finite = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const validDate = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

function getTripDistanceKm(trip) {
  const distance = finite(trip.trip_distance_km ?? trip.distance_km);
  if (distance !== null && distance >= 0) return distance;
  const start = finite(trip.mileage_start ?? trip.mileage_start_km);
  const end = finite(trip.mileage_end ?? trip.mileage_end_km);
  return start !== null && end !== null && end >= start ? end - start : null;
}

function dailyTripStats(trips, vehicleId, from, to) {
  const days = new Map();
  for (const trip of trips) {
    if (String(trip.vehicle_id) !== String(vehicleId)) continue;
    const date = validDate(trip.created_at);
    const distanceKm = getTripDistanceKm(trip);
    if (!date || distanceKm === null || date < from || date >= to) continue;
    const key = date.toISOString().slice(0, 10);
    const entry = days.get(key) || { km: 0, trips: 0, businessKm: 0 };
    entry.km += distanceKm;
    entry.trips += 1;
    if (trip.trip_type === "business") entry.businessKm += distanceKm;
    days.set(key, entry);
  }
  return days;
}

function dailyOdometerStats(readings, vehicleId, from, to) {
  const rows = readings
    .filter((reading) => String(reading.vehicle_id) === String(vehicleId))
    .map((reading) => ({
      date: validDate(reading.reading_at ?? reading.created_at ?? reading.service_date),
      mileage: finite(reading.mileage ?? reading.current_mileage ?? reading.mileage_end),
    }))
    .filter((reading) => reading.date && reading.mileage !== null && reading.date < to)
    .sort((a, b) => a.date - b.date);

  const perDay = new Map();
  for (const reading of rows) {
    const key = reading.date.toISOString().slice(0, 10);
    const previous = perDay.get(key);
    if (!previous || reading.date > previous.date) perDay.set(key, reading);
  }

  function latestOdometerReading(readings, vehicleId, asOf = new Date()) {
    return readings
      .filter((reading) => String(reading.vehicle_id) === String(vehicleId))
      .map((reading) => ({
        date: validDate(reading.reading_at ?? reading.created_at ?? reading.service_date),
        mileage: finite(reading.mileage ?? reading.current_mileage ?? reading.mileage_end),
      }))
      .filter((reading) => reading.date && reading.date <= asOf && reading.mileage !== null)
      .sort((a, b) => b.date - a.date)[0] || null;
  }

  const observed = [...perDay.values()].filter((reading) => reading.date >= from);
  const firstBeforeWindow = [...perDay.values()].filter((reading) => reading.date < from).at(-1);
  if (firstBeforeWindow) observed.unshift(firstBeforeWindow);

  let km = 0;
  let elapsedDays = 0;
  for (let index = 1; index < observed.length; index += 1) {
    const previous = observed[index - 1];
    const current = observed[index];
    const delta = current.mileage - previous.mileage;
    const days = (current.date - previous.date) / DAY_MS;
    if (days <= 0 || delta < 0) continue;
    km += Math.min(delta, days * 1500);
    elapsedDays += Math.min(days, WINDOW_DAYS);
  }
  const observedSpanDays = observed.length > 1
    ? Math.min(WINDOW_DAYS, Math.ceil((observed.at(-1).date - observed[0].date) / DAY_MS))
    : 0;
  return { km, elapsedDays, observedSpanDays };
}

function buildDailyOdometerUsage(readings, vehicleId, from, to) {
  const byDay = dailyOdometerStats(readings, vehicleId, from, to);
  if (byDay.elapsedDays <= 0) return null;
  return {
    kmPerDay: byDay.km / Math.max(1, byDay.elapsedDays),
    observedDays: byDay.observedSpanDays,
  };
}

function addDays(date, days) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() + days);
  return result;
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function forecastVehicleService({
  vehicle,
  trips = [],
  odometerReadings = [],
  now = new Date(),
  windowDays = WINDOW_DAYS,
}) {
  const referenceDate = validDate(now);
  const currentMileage = finite(vehicle.current_mileage) ??
    finite(latestOdometerReading(odometerReadings, vehicle.id, referenceDate || new Date())?.mileage);
  const nextServiceMileage = finite(vehicle.next_service_mileage);
  if (!referenceDate) throw new TypeError("now must be a valid date.");
  if (!Number.isInteger(windowDays) || windowDays < 7 || windowDays > 90) {
    throw new RangeError("windowDays must be a whole number from 7 to 90.");
  }
  if (currentMileage === null || nextServiceMileage === null || nextServiceMileage < 0) {
    return {
      vehicleId: vehicle.id,
      nextServiceMileage,
      currentMileage,
      warningMileage: nextServiceMileage === null ? null : nextServiceMileage - WARNING_LEAD_KM,
      estimatedKmPerDay: null,
      warningDate: null,
      serviceDate: null,
      sampleDays: 0,
      quality: currentMileage === null ? "missing-odometer" : "missing-service-target",
    };
  }

  const windowStart = new Date(referenceDate.getTime() - windowDays * DAY_MS);
  const recentStart = new Date(referenceDate.getTime() - RECENT_DAYS * DAY_MS);
  const tripDays = dailyTripStats(trips, vehicle.id, windowStart, new Date(referenceDate.getTime() + 1));
  const tripsInWindow = [...tripDays.values()];
  const tripKm = tripsInWindow.reduce((sum, day) => sum + day.km, 0);
  const tripDaysObserved = new Set(
    [...tripDays.keys()].filter((date) => new Date(`${date}T00:00:00`) >= windowStart),
  ).size;
  const recentTripKm = [...tripDays.entries()]
    .filter(([date]) => new Date(`${date}T00:00:00`) >= recentStart)
    .reduce((sum, [, day]) => sum + day.km, 0);
  const recentTripCount = [...tripDays.entries()]
    .filter(([date]) => new Date(`${date}T00:00:00`) >= recentStart)
    .reduce((sum, [, day]) => sum + day.trips, 0);
  const recentBusinessKm = [...tripDays.entries()]
    .filter(([date]) => new Date(`${date}T00:00:00`) >= recentStart)
    .reduce((sum, [, day]) => sum + day.businessKm, 0);
  const businessKm = tripsInWindow.reduce((sum, day) => sum + day.businessKm, 0);

  const odometerDailyKm = buildDailyOdometerUsage(
    odometerReadings,
    vehicle.id,
    windowStart,
    referenceDate,
  );
  const baselineDailyKm = odometerDailyKm !== null
    ? odometerDailyKm.kmPerDay
    : tripDaysObserved > 0
      ? tripKm / windowDays
      : null;
  if (baselineDailyKm === null || baselineDailyKm <= 0) {
    return {
      vehicleId: vehicle.id,
      nextServiceMileage,
      currentMileage,
      warningMileage: nextServiceMileage - WARNING_LEAD_KM,
      estimatedKmPerDay: null,
      warningDate: null,
      serviceDate: null,
      sampleDays: Math.max(0, tripDaysObserved),
      quality: "insufficient-history",
    };
  }

  const recentDailyKm = recentTripKm / RECENT_DAYS;
  const blendedDailyKm = recentTripCount > 0
    ? baselineDailyKm * 0.65 + recentDailyKm * 0.35
    : baselineDailyKm;
  const expectedRecentTrips = tripsInWindow.reduce((sum, day) => sum + day.trips, 0) *
    (RECENT_DAYS / windowDays);
  const tripFrequencyFactor = expectedRecentTrips > 0
    ? clamp(1 + ((recentTripCount - expectedRecentTrips) / expectedRecentTrips) * 0.1, 0.8, 1.2)
    : 1;
  const businessRatio = tripKm > 0 ? businessKm / tripKm : 0;
  const recentBusinessRatio = recentTripKm > 0 ? recentBusinessKm / recentTripKm : businessRatio;
  const businessSurgeFactor = clamp(
    1 + Math.max(0, recentBusinessRatio - businessRatio) * 0.2,
    1,
    1.1,
  );
  const estimatedKmPerDay = clamp(
    blendedDailyKm * tripFrequencyFactor * businessSurgeFactor,
    0.1,
    1500,
  );

  const warningMileage = Math.max(0, nextServiceMileage - WARNING_LEAD_KM);
  const daysUntilWarning = Math.max(0, Math.ceil((warningMileage - currentMileage) / estimatedKmPerDay));
  const daysUntilService = Math.max(0, Math.ceil((nextServiceMileage - currentMileage) / estimatedKmPerDay));
  const sampleDays = odometerDailyKm !== null
    ? odometerDailyKm.observedDays
    : tripDaysObserved;

  return {
    vehicleId: vehicle.id,
    nextServiceMileage,
    currentMileage,
    warningMileage,
    estimatedKmPerDay: Number(estimatedKmPerDay.toFixed(1)),
    warningDate: formatLocalDate(addDays(referenceDate, daysUntilWarning)),
    serviceDate: formatLocalDate(addDays(referenceDate, daysUntilService)),
    daysUntilWarning,
    daysUntilService,
    sampleDays,
    businessKmShare: Number(businessRatio.toFixed(3)),
    quality: sampleDays >= 14 ? "good" : "limited",
    computedAt: referenceDate.toISOString(),
  };
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function forecastFleetServices(input = {}) {
  const { vehicles = [], trips = [], odometerReadings = [], now = new Date() } = input;
  return vehicles.map((vehicle) =>
    forecastVehicleService({ vehicle, trips, odometerReadings, now }),
  );
}

export async function cacheServiceForecasts(forecasts = []) {
  await Promise.all(
    forecasts.map((forecast) =>
      setLocalStore(`${FORECAST_CACHE_PREFIX}${forecast.vehicleId}`, forecast),
    ),
  );
  return forecasts;
}

export async function readServiceForecast(vehicleId) {
  if (!vehicleId) return null;
  return (await getLocalStore(`${FORECAST_CACHE_PREFIX}${vehicleId}`)) || null;
}

export async function persistServiceForecasts(supabase, forecasts = []) {
  if (!supabase) throw new TypeError("A Supabase client is required.");
  const results = [];
  for (const forecast of forecasts) {
    const { data, error } = await supabase
      .from("vehicles")
      .update({
        service_warning_mileage: forecast.warningMileage,
        service_warning_date: forecast.warningDate,
        service_predicted_date: forecast.serviceDate,
        service_forecast_km_per_day: forecast.estimatedKmPerDay,
        service_forecast_computed_at: forecast.computedAt,
      })
      .eq("id", forecast.vehicleId)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error(`No vehicle row was updated for ${forecast.vehicleId}.`);
    results.push(data);
  }
  return results;
}

export default {
  forecastFleetServices,
  cacheServiceForecasts,
  readServiceForecast,
  persistServiceForecasts,
};
