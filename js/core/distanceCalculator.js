/**
 * Distance Calculator Module
 * Haversine formula for offline distance calculation
 * Integrates with OpenRouteService (ORS) Map Matching API for precise snapped distance when online
 */

const log = (...args) => console.log("[Distance Calculator]", ...args);
const warn = (...args) => console.warn("[Distance Calculator]", ...args);
const error = (...args) => console.error("[Distance Calculator]", ...args);

const EARTH_RADIUS_METERS = 6371000;

/**
 * Haversine formula: calculate distance between two points
 * @param {number} lat1 - Latitude of point 1
 * @param {number} lon1 - Longitude of point 1
 * @param {number} lat2 - Latitude of point 2
 * @param {number} lon2 - Longitude of point 2
 * @returns {number} Distance in meters
 */
export function haversineDistance(lat1, lon1, lat2, lon2) {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

/**
 * Calculate total distance from an array of GPS coordinates
 * Uses Haversine formula to sum distances between sequential points
 * @param {Array<{latitude, longitude}>} coordinates - Array of coordinate objects
 * @returns {number} Total distance in meters
 */
export function calculateDistanceFromCoordinates(coordinates) {
  if (!coordinates || coordinates.length < 2) {
    return 0;
  }

  let totalDistance = 0;

  for (let i = 1; i < coordinates.length; i++) {
    const prev = coordinates[i - 1];
    const curr = coordinates[i];

    const segmentDistance = haversineDistance(
      prev.latitude,
      prev.longitude,
      curr.latitude,
      curr.longitude
    );

    totalDistance += segmentDistance;
  }

  return totalDistance;
}

/**
 * Format distance for display
 * @param {number} meters - Distance in meters
 * @param {boolean} imperial - True for miles, false for km (default: false)
 * @returns {string} Formatted distance string
 */
export function formatDistance(meters, imperial = false) {
  if (imperial) {
    const miles = meters / 1609.34;
    return `${miles.toFixed(2)} mi`;
  } else {
    const km = meters / 1000;
    return `${km.toFixed(2)} km`;
  }
}

/**
 * Convert distance to kilometers
 * @param {number} meters - Distance in meters
 * @returns {number} Distance in kilometers
 */
export function metersToKm(meters) {
  return meters / 1000;
}

/**
 * Convert distance to miles
 * @param {number} meters - Distance in meters
 * @returns {number} Distance in miles
 */
export function metersToMiles(meters) {
  return meters / 1609.34;
}

/**
 * Call OpenRouteService Map Matching API to snap coordinates to roads
 * Returns snapped coordinates and precise distance when online
 * @param {Array<{latitude, longitude, timestamp}>} coordinates - Raw GPS coordinates
 * @param {string} apiKey - OpenRouteService API key (optional if using server proxy)
 * @returns {Promise<{success: boolean, snappedDistance: number, snappedCoordinates: Array, message: string}>}
 */
export async function callOpenRouteServiceMapMatching(coordinates, apiKey = null) {
  if (!coordinates || coordinates.length < 2) {
    return { success: false, snappedDistance: 0, snappedCoordinates: [], message: "Insufficient coordinates" };
  }

  try {
    // Build ORS request payload
    // ORS expects: [[lon, lat], [lon, lat], ...] format (note: lon FIRST, then lat)
    const geometry = coordinates.map((c) => [c.longitude, c.latitude]);

    const payload = {
      coordinates: geometry,
      profile: "car",
      radiuses: Array(geometry.length).fill(25), // 25 meter radius for snapping
      format: "geojson",
    };

    log("Calling OpenRouteService Map Matching API", {
      pointCount: coordinates.length,
      endpoint: apiKey ? "direct" : "server-proxy",
    });

    // Use server proxy if no API key (recommended for production)
    const endpoint = apiKey
      ? "https://api.openrouteservice.org/v2/snapping/actions/snapshot"
      : "/api/ors/map-matching";

    const headers = {
      "Content-Type": "application/json",
    };

    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`ORS API error: ${response.status} - ${errorData}`);
    }

    const result = await response.json();

    // Parse response and calculate snapped distance
    const snappedCoordinates = parseOrsResponse(result);
    const snappedDistance = calculateDistanceFromCoordinates(
      snappedCoordinates.map((coord) => ({
        latitude: coord[1],
        longitude: coord[0],
      }))
    );

    log("OpenRouteService response received", {
      snappedPoints: snappedCoordinates.length,
      snappedDistanceKm: (snappedDistance / 1000).toFixed(2),
    });

    return {
      success: true,
      snappedDistance,
      snappedCoordinates,
      message: "Distance snapped to road network",
    };
  } catch (err) {
    error("OpenRouteService API call failed:", err);
    return {
      success: false,
      snappedDistance: 0,
      snappedCoordinates: [],
      message: `ORS error: ${err.message}`,
    };
  }
}

/**
 * Parse OpenRouteService Map Matching API response
 * Extracts snapped coordinates from the GeoJSON response
 * @private
 */
function parseOrsResponse(response) {
  try {
    if (response.features && response.features.length > 0) {
      const feature = response.features[0];
      if (feature.geometry && feature.geometry.coordinates) {
        return feature.geometry.coordinates;
      }
    }
    return [];
  } catch (err) {
    error("Failed to parse ORS response:", err);
    return [];
  }
}

/**
 * Compare offline distance (Haversine) vs online distance (road-snapped)
 * Useful for diagnostics and accuracy validation
 * @param {Array} rawCoordinates - Raw GPS coordinates
 * @param {number} snappedDistance - Distance from ORS API (meters)
 * @returns {object} Comparison metrics
 */
export function compareDistances(rawCoordinates, snappedDistance) {
  const offlineDistance = calculateDistanceFromCoordinates(rawCoordinates);
  const difference = snappedDistance - offlineDistance;
  const percentDiff = ((difference / offlineDistance) * 100).toFixed(1);

  return {
    offlineDistance,
    snappedDistance,
    difference,
    percentDiff,
    offlineDistanceKm: (offlineDistance / 1000).toFixed(2),
    snappedDistanceKm: (snappedDistance / 1000).toFixed(2),
  };
}

export default {
  haversineDistance,
  calculateDistanceFromCoordinates,
  formatDistance,
  metersToKm,
  metersToMiles,
  callOpenRouteServiceMapMatching,
  compareDistances,
};
