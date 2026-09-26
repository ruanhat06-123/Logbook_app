const dateValue = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const tripDistance = (trip) => {
  const direct = Number(trip.trip_distance_km ?? trip.distance_km);
  if (Number.isFinite(direct)) return direct;
  const start = Number(trip.mileage_start ?? trip.mileage_start_km ?? 0);
  const end = Number(trip.mileage_end ?? trip.mileage_end_km ?? 0);
  return Math.max(0, end - start);
};

const projectTaxYearSplit = (trips) => {
  const now = new Date();
  const startYear = now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
  const start = new Date(startYear, 2, 1);
  const end = new Date(startYear + 1, 1, 28, 23, 59, 59, 999);
  const yearTrips = trips.filter((trip) => {
    const date = dateValue(trip.created_at);
    return date && date >= start && date <= end;
  });
  const businessKm = yearTrips.filter((trip) => String(trip.trip_type) === "business").reduce((sum, trip) => sum + tripDistance(trip), 0);
  const personalKm = yearTrips.filter((trip) => String(trip.trip_type) === "personal").reduce((sum, trip) => sum + tripDistance(trip), 0);
  const totalKm = businessKm + personalKm;
  const elapsedDays = Math.max(1, (Date.now() - start.getTime()) / 86400000);
  const totalDays = Math.max(1, (end.getTime() - start.getTime()) / 86400000);
  const progress = Math.min(1, elapsedDays / totalDays);
  const projectedTotal = progress > 0 ? totalKm / progress : 0;
  return {
    taxYearLabel: `${startYear}/${String(startYear + 1).slice(2)}`,
    yearProgressPct: Math.round(progress * 100),
    actualBusinessKm: Math.round(businessKm),
    actualPersonalKm: Math.round(personalKm),
    projectedBusinessKm: Math.round(progress > 0 ? businessKm / progress : 0),
    projectedPersonalKm: Math.round(progress > 0 ? personalKm / progress : 0),
    projectedTotalKm: Math.round(projectedTotal),
    projectedBusinessPct: projectedTotal > 0 ? Number(((businessKm / totalKm) * 100).toFixed(1)) : 0,
  };
};

self.onmessage = ({ data }) => {
  self.postMessage({ id: data.id, result: projectTaxYearSplit(data.trips || []) });
};
