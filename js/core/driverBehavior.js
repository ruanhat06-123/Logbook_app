import { getLocalStore, setLocalStore } from "./localStore.js";

const ACTIVE_SESSION_KEY = "driverBehaviorActiveSession";
const EVENT_LIMIT = 500;
const GPS_ACCURACY_LIMIT_METERS = 15;
const MIN_SPEED_MPS = 5;
const MAX_SPEED_MPS = 60;
const SPEED_SAMPLE_MAX_AGE_MS = 5000;
const EVENT_DEDUPE_MS = 10000;
const GRAVITY_FILTER_SECONDS = 0.8;
const MOTION_SUPPORT_THRESHOLD = 2;

const EVENT_WEIGHTS = {
  harsh_braking: 12,
  rapid_acceleration: 10,
  aggressive_cornering: 8,
};

let session = null;
let writeQueue = Promise.resolve();
let motionPermission = "unavailable";
let gravity = null;
let lastMotionAt = null;
let linearMotionMagnitude = 0;
let motionSampleAt = 0;
let lastEventAt = new Map();

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const toRadians = (degrees) => (degrees * Math.PI) / 180;

function distanceMeters(a, b) {
  const radius = 6371000;
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const dLat = lat2 - lat1;
  const dLon = toRadians(b.longitude - a.longitude);
  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function normalizeAngleDegrees(value) {
  return ((value + 540) % 360) - 180;
}

function persistSession() {
  if (!session) return Promise.resolve();
  const snapshot = JSON.parse(JSON.stringify(session));
  writeQueue = writeQueue.then(() => setLocalStore(ACTIVE_SESSION_KEY, snapshot));
  return writeQueue;
}

function recordMotion(event) {
  const acceleration = event.acceleration &&
    [event.acceleration.x, event.acceleration.y, event.acceleration.z].every(Number.isFinite)
    ? event.acceleration
    : event.accelerationIncludingGravity;
  const values = [acceleration?.x, acceleration?.y, acceleration?.z];
  if (!values.every(Number.isFinite)) return;

  const timestamp = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();
  const elapsed = lastMotionAt === null ? null : (timestamp - lastMotionAt) / 1000;
  lastMotionAt = timestamp;
  if (elapsed === null || elapsed <= 0 || elapsed > 2) {
    gravity = values;
    linearMotionMagnitude = 0;
    return;
  }

  const alpha = 1 - Math.exp(-elapsed / GRAVITY_FILTER_SECONDS);
  gravity = values.map((value, index) => gravity[index] + alpha * (value - gravity[index]));
  const linear = values.map((value, index) => value - gravity[index]);
  linearMotionMagnitude = Math.hypot(...linear);
  motionSampleAt = Date.now();
}

function getMotionSupport(now = Date.now()) {
  return now - motionSampleAt <= 2000 && linearMotionMagnitude >= MOTION_SUPPORT_THRESHOLD;
}

function queueGpsSample(coord) {
  writeQueue = writeQueue.then(async () => {
    if (!session) return;
    const current = {
      latitude: Number(coord.latitude),
      longitude: Number(coord.longitude),
      accuracy: Number(coord.accuracy),
      timestamp: Number(coord.timestamp) || Date.now(),
      heading: Number(coord.heading),
      speed: Number(coord.speed),
    };
    if (
      !Number.isFinite(current.latitude) ||
      !Number.isFinite(current.longitude) ||
      !Number.isFinite(current.accuracy) ||
      current.accuracy < 0 ||
      current.accuracy > GPS_ACCURACY_LIMIT_METERS
    ) return;

    const previous = session.lastGpsFix;
    session.validGpsFixes += 1;
    if (previous) {
      const elapsedMs = current.timestamp - previous.timestamp;
      if (elapsedMs > 0 && elapsedMs <= 60000) {
        const elapsedSeconds = elapsedMs / 1000;
        const distance = distanceMeters(previous, current);
        const derivedSpeed = distance / elapsedSeconds;
        const measuredSpeed = Number.isFinite(current.speed) && current.speed >= 0
          ? current.speed
          : derivedSpeed;
        const speed = Number.isFinite(session.smoothedSpeed)
          ? session.smoothedSpeed * 0.65 + measuredSpeed * 0.35
          : measuredSpeed;
        const previousSpeed = Number.isFinite(previous.smoothedSpeed)
          ? previous.smoothedSpeed
          : Number.isFinite(previous.speed) && previous.speed >= 0
            ? previous.speed
            : previous.derivedSpeed;
        const plausible = speed <= MAX_SPEED_MPS && derivedSpeed <= MAX_SPEED_MPS;

        if (plausible) {
          session.distanceMeters += distance;
          if (
            Number.isFinite(previousSpeed) &&
            elapsedMs >= 1000 &&
            elapsedMs <= SPEED_SAMPLE_MAX_AGE_MS &&
            Math.max(speed, previousSpeed) >= MIN_SPEED_MPS
          ) {
            classifySpeedChange({
              current,
              previous,
              speed,
              previousSpeed,
              elapsedSeconds,
            });
            classifyCornering({
              current,
              previous,
              speed,
              elapsedSeconds,
            });
          }
        }
        current.derivedSpeed = derivedSpeed;
        current.smoothedSpeed = speed;
        session.smoothedSpeed = speed;
      }
    }

    session.lastGpsFix = current;
    await setLocalStore(ACTIVE_SESSION_KEY, session);
  }).catch((error) => {
    console.error("[Driver behavior] Failed to cache telemetry:", error);
    throw error;
  });
}

function classifySpeedChange({ current, speed, previousSpeed, elapsedSeconds }) {
  const acceleration = (speed - previousSpeed) / elapsedSeconds;
  if (acceleration <= -3.5) {
    addEvent("harsh_braking", current, Math.min(1, Math.abs(acceleration) / 5));
  } else if (acceleration >= 3) {
    addEvent("rapid_acceleration", current, Math.min(1, acceleration / 4.5));
  }
}

function classifyCornering({ current, previous, speed, elapsedSeconds }) {
  if (
    !Number.isFinite(current.heading) ||
    !Number.isFinite(previous.heading) ||
    speed < 8 ||
    current.accuracy > 10 ||
    previous.accuracy > 10 ||
    elapsedSeconds < 1
  ) return;
  const yawRate = Math.abs(normalizeAngleDegrees(current.heading - previous.heading)) *
    (Math.PI / 180) / elapsedSeconds;
  const lateralAcceleration = speed * yawRate;
  if (lateralAcceleration >= 3) {
    addEvent("aggressive_cornering", current, Math.min(1, lateralAcceleration / 5));
  }
}

function addEvent(type, coord, baseConfidence) {
  const timestamp = coord.timestamp || Date.now();
  const previousEventAt = lastEventAt.get(type) || 0;
  if (timestamp - previousEventAt < EVENT_DEDUPE_MS) return;

  const motionSupported = getMotionSupport();
  const event = {
    id: crypto.randomUUID(),
    type,
    occurredAt: new Date(timestamp).toISOString(),
    confidence: Number(clamp(baseConfidence * (motionSupported ? 1 : 0.75), 0, 1).toFixed(2)),
    corroboratedByDeviceMotion: motionSupported,
  };
  session.events.push(event);
  if (session.events.length > EVENT_LIMIT) {
    session.events.splice(0, session.events.length - EVENT_LIMIT);
    session.truncatedEvents = true;
  }
  session.eventCounts[type] += 1;
  lastEventAt.set(type, timestamp);
}

function makeSummary(value) {
  const distanceKm = value.distanceMeters / 1000;
  const sufficientData = value.validGpsFixes >= 5 && distanceKm >= 0.5;
  if (!sufficientData) {
    return {
      score: null,
      eventCount: Object.values(value.eventCounts).reduce((sum, count) => sum + count, 0),
      eventCounts: { ...value.eventCounts },
      distanceKm: Number(distanceKm.toFixed(2)),
      validGpsFixes: value.validGpsFixes,
      quality: "insufficient",
      truncatedEvents: value.truncatedEvents,
    };
  }

  const confidenceTotals = new Map();
  value.events.forEach((event) => {
    confidenceTotals.set(
      event.type,
      (confidenceTotals.get(event.type) || 0) + event.confidence,
    );
  });
  const penalties = Object.entries(value.eventCounts).reduce((sum, [type, count]) => {
    const recorded = Math.min(count, value.events.filter((event) => event.type === type).length);
    const averageConfidence = recorded > 0
      ? confidenceTotals.get(type) / recorded
      : 0.75;
    return sum + EVENT_WEIGHTS[type] * count * averageConfidence;
  }, 0);
  const score = Math.round(clamp(100 - penalties * (100 / distanceKm), 0, 100));
  return {
    score,
    eventCount: Object.values(value.eventCounts).reduce((sum, count) => sum + count, 0),
    eventCounts: { ...value.eventCounts },
    distanceKm: Number(distanceKm.toFixed(2)),
    validGpsFixes: value.validGpsFixes,
    quality: value.validGpsFixes >= 20 ? "good" : "limited",
    truncatedEvents: value.truncatedEvents,
  };
}

export async function requestDriverMotionPermission() {
  if (typeof window === "undefined" || !("DeviceMotionEvent" in window)) {
    motionPermission = "unavailable";
    return motionPermission;
  }
  const requestPermission = window.DeviceMotionEvent.requestPermission;
  if (typeof requestPermission !== "function") {
    motionPermission = "available";
    return motionPermission;
  }
  try {
    motionPermission = (await requestPermission.call(window.DeviceMotionEvent)) === "granted"
      ? "granted"
      : "denied";
    return motionPermission;
  } catch (error) {
    motionPermission = "denied";
    console.warn("[Driver behavior] Motion permission was not granted:", error);
    return motionPermission;
  }
}

export async function startDriverBehaviorTracking({
  tripId,
  enabled = false,
  motionAccess = motionPermission,
} = {}) {
  if (!enabled) return { enabled: false, reason: "opted-out" };
  if (!tripId) throw new Error("A trip ID is required for behavior telemetry.");
  if (session) throw new Error("Driver behavior tracking is already active.");
  if (motionAccess === "granted" || motionAccess === "available") {
    motionPermission = motionAccess;
  }

  const stored = await getLocalStore(ACTIVE_SESSION_KEY);
  if (stored && stored.tripId !== tripId) {
    throw new Error("A previous driver-behaviour session must be recovered before starting another.");
  }
  if (stored?.tripId === tripId) {
    session = stored;
    lastEventAt = new Map(
      Object.entries(session.eventCounts).map(([type]) => {
        const lastEvent = [...session.events].reverse().find((event) => event.type === type);
        return [type, lastEvent ? new Date(lastEvent.occurredAt).getTime() : 0];
      }),
    );
  } else {
    session = {
      tripId,
      startedAt: new Date().toISOString(),
      distanceMeters: 0,
      validGpsFixes: 0,
      lastGpsFix: null,
      events: [],
      eventCounts: {
        harsh_braking: 0,
        rapid_acceleration: 0,
        aggressive_cornering: 0,
      },
      truncatedEvents: false,
    };
  }

  gravity = null;
  lastMotionAt = null;
  linearMotionMagnitude = 0;
  motionSampleAt = 0;
  lastEventAt = new Map();
  window.addEventListener("gps-position-recorded", handleGpsPosition);
  if (motionPermission === "granted" || motionPermission === "available") {
    window.addEventListener("devicemotion", recordMotion, { passive: true });
  }
  await persistSession();
  return { enabled: true, motionPermission };
}

function handleGpsPosition(event) {
  if (event.detail?.coord) queueGpsSample(event.detail.coord);
}

export async function finishDriverBehaviorTracking() {
  if (!session) return null;
  window.removeEventListener("gps-position-recorded", handleGpsPosition);
  window.removeEventListener("devicemotion", recordMotion);
  await writeQueue;
  const completed = session;
  const summary = makeSummary(completed);
  await setLocalStore(`driverBehaviorEvents:${completed.tripId}`, completed.events);
  await setLocalStore(`driverBehaviorSummary:${completed.tripId}`, summary);
  await setLocalStore(ACTIVE_SESSION_KEY, null);
  session = null;
  return summary;
}

export async function getDriverBehaviorSummary(tripId) {
  if (!tripId) return null;
  return (await getLocalStore(`driverBehaviorSummary:${tripId}`)) || null;
}
