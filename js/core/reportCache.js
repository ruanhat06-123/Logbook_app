/**
 * Report Cache Module
 * Manages offline caching of report data (vehicles, fuel logs, trips)
 * Allows reports to work seamlessly offline
 * 
 * @module reportCache
 */

import { getLocalStore, setLocalStore } from './localStore.js';

// Cache keys
const REPORT_CACHE_KEYS = {
  vehicles: 'report_vehicles_cache',
  logbook: 'report_logbook_cache',
  lastSync: 'report_cache_lastSync',
};

/**
 * Cache vehicles data for offline reports
 * Called when vehicles are fetched from Supabase
 * 
 * @param {Array} vehicleRows - Array of vehicle objects from Supabase
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function cacheVehiclesForReports(vehicleRows) {
  try {
    if (!Array.isArray(vehicleRows)) {
      return { success: false, message: 'Invalid vehicles data' };
    }

    await setLocalStore(REPORT_CACHE_KEYS.vehicles, vehicleRows);
    console.log(`[Report Cache] Cached ${vehicleRows.length} vehicles for offline reports`);
    
    return { success: true, message: `${vehicleRows.length} vehicles cached` };
  } catch (error) {
    console.error('[Report Cache] Error caching vehicles:', error);
    return { success: false, message: error.message };
  }
}

/**
 * Cache logbook/fuel entries for offline reports
 * Called when logbook entries are fetched from Supabase
 * 
 * @param {Array} logbookRows - Array of logbook/fuel entries from Supabase
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function cacheLogbookForReports(logbookRows) {
  try {
    if (!Array.isArray(logbookRows)) {
      return { success: false, message: 'Invalid logbook data' };
    }

    await setLocalStore(REPORT_CACHE_KEYS.logbook, logbookRows);
    
    // Update last sync time
    await setLocalStore(REPORT_CACHE_KEYS.lastSync, new Date().toISOString());
    
    console.log(`[Report Cache] Cached ${logbookRows.length} logbook entries for offline reports`);
    
    return { success: true, message: `${logbookRows.length} entries cached` };
  } catch (error) {
    console.error('[Report Cache] Error caching logbook:', error);
    return { success: false, message: error.message };
  }
}

/**
 * Get cached vehicles for offline reports
 * Returns empty array if no cache exists
 * 
 * @returns {Promise<Array>} Array of cached vehicle objects
 */
export async function getCachedVehicles() {
  try {
    const vehicles = await getLocalStore(REPORT_CACHE_KEYS.vehicles);
    return Array.isArray(vehicles) ? vehicles : [];
  } catch (error) {
    console.warn('[Report Cache] Error retrieving cached vehicles:', error);
    return [];
  }
}

/**
 * Get cached logbook entries for offline reports
 * Returns empty array if no cache exists
 * 
 * @returns {Promise<Array>} Array of cached logbook entries
 */
export async function getCachedLogbook() {
  try {
    const logbook = await getLocalStore(REPORT_CACHE_KEYS.logbook);
    return Array.isArray(logbook) ? logbook : [];
  } catch (error) {
    console.warn('[Report Cache] Error retrieving cached logbook:', error);
    return [];
  }
}

/**
 * Get report data with fallback to cache
 * Tries Supabase first, falls back to cached data if offline
 * 
 * @param {Object} supabaseClient - Supabase client instance
 * @returns {Promise<{vehicles: Array, logbook: Array, isCached: boolean}>}
 */
export async function getReportDataWithFallback(supabaseClient) {
  try {
    const [vehiclesResp, logbookResp] = await Promise.all([
      supabaseClient.from("vehicles").select("*").order("number_plate"),
      supabaseClient.from("car_logbook").select("*").order("created_at", { ascending: false }),
    ]);

    let vehicles = vehiclesResp.data || [];
    let logbook = logbookResp.data || [];

    // Cache successful responses
    if (!vehiclesResp.error && vehicles.length > 0) {
      await cacheVehiclesForReports(vehicles).catch(() => {});
    }
    if (!logbookResp.error && logbook.length > 0) {
      await cacheLogbookForReports(logbook).catch(() => {});
    }

    // Log any errors
    if (vehiclesResp.error) {
      console.warn('[Report Cache] Vehicles fetch error:', vehiclesResp.error);
    }
    if (logbookResp.error) {
      console.warn('[Report Cache] Logbook fetch error:', logbookResp.error);
    }

    return {
      vehicles,
      logbook,
      isCached: false,
      source: 'network',
    };
  } catch (error) {
    console.warn('[Report Cache] Network error, using cached data:', error);
    
    // Fall back to cached data
    const cachedVehicles = await getCachedVehicles();
    const cachedLogbook = await getCachedLogbook();

    if (cachedVehicles.length === 0 && cachedLogbook.length === 0) {
      console.error('[Report Cache] No cached data available');
      return {
        vehicles: [],
        logbook: [],
        isCached: false,
        source: 'none',
        error: 'No data available. Please load the report while online.',
      };
    }

    return {
      vehicles: cachedVehicles,
      logbook: cachedLogbook,
      isCached: true,
      source: 'cache',
    };
  }
}

/**
 * Clear all cached report data
 * Useful for logout or manual cache clear
 * 
 * @returns {Promise<{success: boolean}>}
 */
export async function clearReportCache() {
  try {
    await Promise.all([
      setLocalStore(REPORT_CACHE_KEYS.vehicles, []),
      setLocalStore(REPORT_CACHE_KEYS.logbook, []),
      setLocalStore(REPORT_CACHE_KEYS.lastSync, null),
    ]);

    console.log('[Report Cache] Cleared all cached report data');
    return { success: true };
  } catch (error) {
    console.error('[Report Cache] Error clearing cache:', error);
    return { success: false, message: error.message };
  }
}

/**
 * Get cache metadata (last sync time, cache sizes)
 * 
 * @returns {Promise<{lastSync: string|null, vehicleCount: number, logbookCount: number}>}
 */
export async function getReportCacheMetadata() {
  try {
    const lastSync = await getLocalStore(REPORT_CACHE_KEYS.lastSync);
    const vehicles = await getCachedVehicles();
    const logbook = await getCachedLogbook();

    return {
      lastSync,
      vehicleCount: vehicles.length,
      logbookCount: logbook.length,
      hasData: vehicles.length > 0 || logbook.length > 0,
    };
  } catch (error) {
    console.error('[Report Cache] Error getting cache metadata:', error);
    return {
      lastSync: null,
      vehicleCount: 0,
      logbookCount: 0,
      hasData: false,
    };
  }
}

/**
 * Initialize report caching with current data
 * Called on app startup or when user navigates to reports
 * 
 * @param {Object} supabaseClient - Supabase client instance
 * @returns {Promise<{cached: boolean, vehicleCount: number, logbookCount: number}>}
 */
export async function initializeReportCaching(supabaseClient) {
  try {
    console.log('[Report Cache] Initializing report caching...');
    
    const result = await getReportDataWithFallback(supabaseClient);
    
    if (result.source === 'network') {
      console.log('[Report Cache] ✓ Report data cached from network');
      return {
        cached: true,
        vehicleCount: result.vehicles.length,
        logbookCount: result.logbook.length,
        source: 'network',
      };
    } else if (result.source === 'cache') {
      console.log('[Report Cache] ⚠ Using cached report data (offline mode)');
      return {
        cached: true,
        vehicleCount: result.vehicles.length,
        logbookCount: result.logbook.length,
        source: 'cache',
      };
    } else {
      console.warn('[Report Cache] ✗ No report data available');
      return {
        cached: false,
        vehicleCount: 0,
        logbookCount: 0,
        source: 'none',
      };
    }
  } catch (error) {
    console.error('[Report Cache] Initialization error:', error);
    return {
      cached: false,
      vehicleCount: 0,
      logbookCount: 0,
      source: 'error',
      error: error.message,
    };
  }
}
