# Offline-First GPS Distance Tracking Pipeline - Setup Guide

## Overview

This is a production-ready, offline-first distance-tracking pipeline for your LogMate web-based logbook application. It calculates exact distance traveled using the browser's HTML5 Geolocation API and integrates with OpenRouteService (ORS) for precision road-snapped distances when online.

## Architecture Components

### Core Modules

1. **`gpsTracking.js`** - GPS position tracking with drift filtering
   - `startTripTracking()` - Begin tracking GPS coordinates
   - `endTripTracking()` - Finalize trip and return payload
   - Automatically persists coordinates to local storage after every GPS tick
   - Implements Screen Wake Lock API to prevent phone sleep during tracking

2. **`localStore.js`** - IndexedDB + localStorage persistence layer
   - `setLocalStore(key, value)` - Store data persistently
   - `getLocalStore(key)` - Retrieve data
   - Automatic fallback to localStorage if IndexedDB unavailable

3. **`distanceCalculator.js`** - Haversine formula & ORS integration
   - `calculateDistanceFromCoordinates()` - Offline distance calculation
   - `callOpenRouteServiceMapMatching()` - Road-snapped distance via ORS API
   - `formatDistance()` - Display-ready distance strings

4. **`offlineSync.js`** - Network listener & background sync queue
   - `initializeOfflineSync()` - Set up automatic sync on network restore
   - `syncPendingTrips()` - Push pending trips to ORS API
   - Automatic event listeners for `online` event

5. **`tripUIIntegration.js`** - Complete UI workflow orchestration
   - `initializeTripUI()` - Wire up Start/End buttons and modal handlers
   - Handles trip completion modal for purpose/type selection
   - Integrates GPS tracking with UI state management
   - Shows native notifications when trip ends

## Quick Start - 3 Steps

### Step 1: Update trip.js to Initialize Modules

Add these imports at the top of your `js/pages/trip.js`:

```javascript
import { initializeTripUI } from "../core/tripUIIntegration.js";
import { initializeOfflineSync } from "../core/offlineSync.js";
```

Then add this initialization after the user is authenticated and before rendering the UI:

```javascript
// Initialize offline-first distance tracking system
await initializeOfflineSync();
```

And after the shell() call that renders the UI, add:

```javascript
// Initialize trip UI handlers
await initializeTripUI();
```

### Step 2: Wire Up Start/End Buttons in HTML

Your trip.html already has the buttons and form fields! They're in the "Quick trip" section:

```html
<div class="live-trip-panel">
  <div><span class="eyebrow">Quick trip</span><h1>Start from your current location.</h1></div>
  <div class="live-trip-controls">
    <button id="start-live-trip" class="btn btn-primary" type="button">Start trip</button>
    <button id="end-live-trip" class="btn btn-secondary" type="button" hidden>End trip</button>
  </div>
  <div id="live-trip-status" class="notice" hidden></div>
</div>
```

The "purpose" and "trip-type" fields already exist in the main trip form:

```html
<div class="field">
  <label for="trip-type">Trip type</label>
  <select id="trip-type" required>
    <option value="personal">Personal</option>
    <option value="business">Business</option>
  </select>
</div>

<div class="field">
  <label for="purpose">Purpose</label>
  <select id="purpose" required>
    <option value="">Select purpose</option>
    <option value="commute">Commute</option>
    <option value="errand">Errand</option>
    <option value="delivery">Delivery</option>
    <option value="client_meeting">Client meeting</option>
    <option value="other">Other</option>
  </select>
</div>
```

### Step 3: Set Up OpenRouteService (Optional but Recommended)

The system works offline with Haversine-based distances. For precision road-snapped distances when online:

#### Option A: Server Proxy (Recommended for Production)

Update your `server/api-server.js` to proxy ORS requests:

```javascript
// Add this endpoint to your server
app.post('/api/ors/map-matching', async (req, res) => {
  const ORS_API_KEY = process.env.ORS_API_KEY; // Set this env var
  
  if (!ORS_API_KEY) {
    return res.status(500).json({ error: 'ORS API key not configured' });
  }

  try {
    const response = await fetch('https://api.openrouteservice.org/v2/snap/json', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ORS_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

#### Option B: Direct ORS API (For Testing)

You can pass your ORS API key directly when calling sync:

```javascript
import { manualSync } from "../core/offlineSync.js";

const orsApiKey = "your-ors-api-key";
await manualSync(orsApiKey);
```

Get a free API key from: https://openrouteservice.org/sign-up/

## User Workflow

### Starting a Trip

1. User selects vehicle from dropdown
2. Clicks **"Start trip"** button
3. Browser requests location permission (one-time)
4. Screen Wake Lock activated (phone won't sleep)
5. GPS coordinates recorded every ~1-10 seconds
6. Live tracking status shows elapsed time, point count, accuracy
7. Coordinates persisted to IndexedDB after every GPS tick

### During Trip

- User can close browser/tab safely - coordinates are saved locally
- If network drops, GPS continues tracking
- Phone won't sleep due to Wake Lock API
- Real-time accuracy feedback shown (e.g., "Accuracy: ±8m")

### Ending a Trip

1. User clicks **"End trip"** button
2. GPS tracking stops
3. Screen Wake Lock released
4. Modal appears asking for:
   - **Vehicle** (pre-filled)
   - **Trip type** (Personal/Business)
   - **Purpose** (Commute/Errand/Delivery/Client Meeting/Other)
   - **Notes** (optional)
5. System shows:
   - Trip duration
   - GPS points recorded
   - **Offline distance** (Haversine-calculated from raw coordinates)
   - Status: "Syncing distance with road network when online..."
6. User clicks **"Save trip"**
7. Trip saved to Supabase database
8. Native notification appears (if permissions granted)

### After Trip Ends (Online)

- `offlineSync` module detects network connection
- Automatically sends raw coordinates to OpenRouteService
- ORS snaps coordinates to actual roads
- Returns precise road-based distance
- Database record updated with snapped distance
- UI confirms sync complete

### After Trip Ends (Offline)

- Trip data cached locally
- Native notification appears (if permissions granted)
- When device goes online, automatic sync triggers
- No manual action needed

## Key Features Implemented

### ✅ OFFLINE-FIRST
- All trip coordinates stored in IndexedDB immediately after each GPS tick
- Haversine formula provides distance estimate without network
- Automatic sync to ORS when online
- No data loss if browser crashes mid-trip
- Restoration of pending trips on app reload

### ✅ DRIFT FILTERING
- GPS points with accuracy > 25 meters rejected
- Only records position if > 10 meters from last point
- Prevents "GPS drift" inflation at red lights

### ✅ SCREEN WAKE LOCK
- Mobile phone won't sleep during active tracking
- Automatic re-acquisition after visibility changes
- Graceful fallback for unsupported devices

### ✅ BACKGROUND SYNC
- Listens for `window.online` event
- Automatic retry queue
- Trip data persists across sessions
- Prevents duplicate syncs

### ✅ SERVICE WORKER CACHING
- Network-first strategy for API calls (ORS, Supabase)
- Cache-first strategy for assets (JS, CSS)
- Seamless offline fallback
- Old cache cleanup on updates

### ✅ PURPOSE/TYPE SELECTION
- Modal appears after trip ends (online or offline)
- User selects trip type and purpose before saving
- Optional "other" purpose description field
- Trip saved with metadata to database

## Database Schema

Extend your `trips` table with these columns:

```sql
ALTER TABLE trips ADD COLUMN (
  trip_type TEXT, -- 'personal' or 'business'
  purpose TEXT, -- 'commute', 'errand', 'delivery', 'client_meeting', 'other'
  purpose_other TEXT, -- Custom description if purpose = 'other'
  point_count INTEGER, -- Number of GPS points recorded
  raw_coordinates JSONB, -- Array of {lat, lon, accuracy, timestamp}
  distance_offline NUMERIC, -- Haversine distance in km
  distance_snapped NUMERIC, -- ORS road-snapped distance in km
  status TEXT -- 'pending-sync', 'synced'
);
```

## Event Listeners

The system dispatches custom events for UI integration:

```javascript
// When a GPS position is recorded
window.addEventListener('gps-position-recorded', (event) => {
  const { coord, totalPoints } = event.detail;
  console.log(`Recorded point ${totalPoints}:`, coord);
});

// When GPS position error occurs
window.addEventListener('gps-position-error', (event) => {
  const { code, message } = event.detail;
  console.warn('GPS error:', message);
});

// When a trip syncs successfully
window.addEventListener('trip-synced', (event) => {
  const { tripId, snappedDistance } = event.detail;
  console.log(`Trip ${tripId} synced with distance ${snappedDistance}m`);
});
```

## API Reference

### gpsTracking.js

```javascript
import { 
  startTripTracking,
  endTripTracking,
  getTripCoordinates,
  getTrackingStatus,
  cancelTripTracking
} from './gpsTracking.js';

// Start tracking
const result = await startTripTracking();
// Returns: { success: boolean, message: string }

// End tracking
const tripPayload = await endTripTracking();
// Returns: { success: boolean, tripPayload: object, message: string }

// Get current status
const status = getTrackingStatus();
// Returns: { isTracking, pointCount, elapsedSeconds, lastCoord }
```

### distanceCalculator.js

```javascript
import {
  calculateDistanceFromCoordinates,
  formatDistance,
  callOpenRouteServiceMapMatching
} from './distanceCalculator.js';

// Calculate Haversine distance
const meters = calculateDistanceFromCoordinates(coordinates);

// Format for display
const formatted = formatDistance(meters); // "12.34 km"

// Call ORS API
const result = await callOpenRouteServiceMapMatching(coordinates, apiKey);
// Returns: { success, snappedDistance, snappedCoordinates, message }
```

### offlineSync.js

```javascript
import {
  initializeOfflineSync,
  syncPendingTrips,
  manualSync,
  getSyncStatus,
  getPendingTrips
} from './offlineSync.js';

// Initialize (call once on app startup)
initializeOfflineSync();

// Manual sync trigger
await manualSync(orsApiKey);

// Check status
const status = await getSyncStatus();
// Returns: { isSyncing, isOnline, pendingTripsCount, syncedTripsCount }
```

### tripUIIntegration.js

```javascript
import { initializeTripUI } from './tripUIIntegration.js';

// Initialize (call once when trip page loads)
await initializeTripUI();
```

## Testing Checklist

- [ ] Load app in browser
- [ ] Open DevTools Console for logs
- [ ] Test "Start trip" button → location permission → tracking starts
- [ ] Verify live status updates (time, point count)
- [ ] Test "End trip" button → coordinates saved → modal appears
- [ ] Fill purpose/type form → save trip
- [ ] Verify notification appears (if permissions granted)
- [ ] Go offline → verify pending trips cached
- [ ] Go online → verify automatic sync triggers
- [ ] Check browser DevTools > Storage > IndexedDB for cached data
- [ ] Verify Supabase database has trip record
- [ ] Compare offline distance vs synced distance (should be ±10-15%)

## Troubleshooting

### Location permission denied
- Check browser console for errors
- On mobile, allow location in app settings
- HTTPS required in production

### GPS tracking not starting
- Ensure geolocation.watchPosition is supported
- Check if background tabs are being throttled (mobile OS)
- Screen Wake Lock helps with this - enable in manifest

### Coordinates not saving to IndexedDB
- Check browser quota (typically 50MB per origin)
- Verify IndexedDB isn't full from other apps
- localStorage fallback should still work

### ORS API not snapping
- Verify API key is valid and has quota
- Check that coordinates have at least 2 points
- Network-first strategy may cache errors - clear cache
- Try direct API vs server proxy approach

### Notification not showing
- Verify Notification.permission === 'granted'
- Check browser notification settings
- Mobile: verify app has notification permission

## Performance Notes

- Each GPS coordinate ~200 bytes = 100 points = 20KB
- 1-hour trips typically 300-600 points = 60-120KB
- IndexedDB can typically store 1000s of trips offline
- ORS API call takes 1-3 seconds per trip
- Batching multiple trips can improve sync performance

## Next Steps

1. Add trip management UI (view, edit, delete trips)
2. Build reports (distance by purpose, by vehicle)
3. Integrate with fuel economy calculations
4. Add recurring trip templates
5. Export trips to CSV/PDF

## Support

All modules include detailed logging prefixed with `[module-name]`.
Enable in DevTools Console: `console.log` shows all activity.

Errors are prefixed with `[module-name]` for easy debugging.

Questions? Check the inline JSDoc comments in each module for detailed API documentation.
