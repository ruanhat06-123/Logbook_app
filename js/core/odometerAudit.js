/**
 * Validate consecutive trip odometer readings for SARS-oriented reporting.
 * A vehicle's next trip should start at the previous trip's ending reading.
 */

const numberValue = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const tripStart = (trip) => numberValue(trip.mileage_start ?? trip.mileage_start_km);
const tripEnd = (trip) => numberValue(trip.mileage_end ?? trip.mileage_end_km);
const tripDate = (trip) => {
  const timestamp = new Date(trip.created_at || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

export function auditOdometerGaps(trips = []) {
  const byVehicle = new Map();
  trips.forEach((trip) => {
    const vehicleId = String(trip.vehicle_id ?? "unknown");
    if (!byVehicle.has(vehicleId)) byVehicle.set(vehicleId, []);
    byVehicle.get(vehicleId).push(trip);
  });

  const findings = [];
  byVehicle.forEach((vehicleTrips, vehicleId) => {
    const ordered = [...vehicleTrips].sort((a, b) => tripDate(a) - tripDate(b));
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      const previousEnd = tripEnd(previous);
      const currentStart = tripStart(current);
      if (previousEnd === null || currentStart === null || previousEnd === currentStart) continue;

      const difference = currentStart - previousEnd;
      findings.push({
        kind: difference > 0 ? "odometer-gap" : "odometer-overlap",
        vehicleId,
        previousTripId: previous.id,
        currentTripId: current.id,
        previousEnd,
        currentStart,
        difference,
        message: difference > 0
          ? `${difference.toLocaleString()} km gap between consecutive trip readings`
          : `${Math.abs(difference).toLocaleString()} km overlap between consecutive trip readings`,
      });
    }
  });

  return findings;
}

export const odometerAuditSummary = (findings = []) => ({
  count: findings.length,
  hasBlockingFindings: findings.length > 0,
  gaps: findings.filter((finding) => finding.kind === "odometer-gap"),
  overlaps: findings.filter((finding) => finding.kind === "odometer-overlap"),
});
