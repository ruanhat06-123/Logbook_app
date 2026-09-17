/**
 * Fuel Price Module
 * Fetches regional fuel prices with a persistent cache so a suggestion is
 * available every time — including offline. Successful lookups are cached
 * per country + fuel type; when the network or table is unavailable, the
 * most recent cached price for that combination is returned instead.
 */

import { getLocalStore, setLocalStore } from "./localStore.js";

const log = (...args) => console.log("[Fuel Price]", ...args);
const warn = (...args) => console.warn("[Fuel Price]", ...args);

const CACHE_KEY = "fuelPriceCache";

const readCache = async () => (await getLocalStore(CACHE_KEY)) || {};
const writeCache = (cache) => setLocalStore(CACHE_KEY, cache);

const cacheKeyFor = (countryCode, fuelType) =>
  `${String(countryCode || "").toUpperCase()}_${String(fuelType || "").toLowerCase()}`;

const apiBaseUrl = () => {
  if (typeof window !== "undefined" && window.__ENV?.VITE_API_URL) {
    return window.__ENV.VITE_API_URL.replace(/\/$/, "");
  }
  if (typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    return "http://localhost:3000";
  }
  return "";
};

/**
 * Detect the user's country code from the browser locale (defaults to ZA).
 */
export function detectCountryCode() {
  const locale = navigator.language || "en-ZA";
  return (locale.split("-")[1] || "ZA").toUpperCase();
}

const normalizeFuelType = (value) => {
  const type = String(value || "").toLowerCase().replace(/\s+/g, "_");
  if (type.includes("93")) return "petrol_93";
  if (type.includes("95")) return "petrol_95";
  if (type.includes("ppm500") || type.includes("0.05")) return "diesel_05";
  if (type.includes("ppm10") || type.includes("ppm50") || type.includes("0.005")) return "diesel_005";
  return type;
};

/**
 * Get the suggested fuel price for a country + fuel type.
 * Tries the cached DMPR proxy first for South Africa, then Supabase; on any failure (offline, error, no row) falls back
 * to the last cached price for the same combination, then to any cached
 * price for the country, and finally to the most recent cached price at all.
 *
 * @param {object} input
 * @param {object} input.supabase - Supabase client
 * @param {string} input.countryCode - e.g. "ZA"
 * @param {string} input.fuelType - e.g. "petrol_95"
 * @returns {Promise<{price: number|null, currency: string, region: string, source: string, fromCache: boolean, message: string}>}
 */
export async function getRegionalFuelPrice({ supabase, countryCode, fuelType } = {}) {
  const country = String(countryCode || detectCountryCode()).toUpperCase();
  const type = normalizeFuelType(fuelType);
  const empty = { price: null, currency: "R", region: "", source: "", fromCache: false, message: "No price available" };

  if (!country || !type) return empty;

  // 1) Try the network
  try {
    if (country === "ZA" && navigator.onLine) {
      const response = await fetch(`${apiBaseUrl()}/api/fuel-prices?fuelType=${encodeURIComponent(type)}`, { cache: "no-store" });
      if (response.ok) {
        const data = await response.json();
        const regional = (data.prices || []).filter((row) => Number.isFinite(Number(row.price)));
        if (regional.length) {
          const average = regional.reduce((sum, row) => sum + Number(row.price), 0) / regional.length;
          const record = {
            price: Number(average.toFixed(2)),
            currency: data.currency || "R",
            region: "South Africa regional average",
            source: "DMPR",
            fetchedAt: data.fetchedAt || new Date().toISOString(),
          };
          const cache = await readCache();
          cache[cacheKeyFor(country, type)] = record;
          await writeCache(cache);
          return { ...record, fromCache: false, message: `DMPR price effective ${data.effectiveFrom || "currently"}` };
        }
      }
    }
    if (supabase && navigator.onLine) {
      const { data, error } = await supabase
        .from("regional_fuel_prices")
        .select("price_per_litre, currency, region, valid_from, source")
        .eq("country_code", country)
        .eq("fuel_type", type)
        .order("valid_from", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error && data && Number.isFinite(Number(data.price_per_litre))) {
        const record = {
          price: Number(data.price_per_litre),
          currency: data.currency || "R",
          region: data.region || "",
          source: data.source || "",
          fetchedAt: new Date().toISOString(),
        };
        const cache = await readCache();
        cache[cacheKeyFor(country, type)] = record;
        await writeCache(cache);
        return { ...record, fromCache: false, message: "Live price" };
      }
      if (error) warn("Fuel price query error:", error.message || error);
    }
  } catch (err) {
    warn("Fuel price fetch failed, trying cache:", err);
  }

  // 2) Fall back to cached price for this exact combination
  const cache = await readCache();
  const exact = cache[cacheKeyFor(country, type)];
  if (exact) {
    return { ...exact, fromCache: true, message: "Cached price (offline)" };
  }

  // 3) Any cached price for this country
  const countryEntries = Object.entries(cache).filter(([key]) => key.startsWith(`${country}_`));
  if (countryEntries.length) {
    const latest = countryEntries.sort((a, b) => String(b[1].fetchedAt).localeCompare(String(a[1].fetchedAt)))[0][1];
    return { ...latest, fromCache: true, message: "Cached price for your region" };
  }

  // 4) Most recent cached price overall
  const all = Object.values(cache);
  if (all.length) {
    const latest = all.sort((a, b) => String(b.fetchedAt).localeCompare(String(a.fetchedAt)))[0];
    return { ...latest, fromCache: true, message: "Last known price" };
  }

  log("No fuel price available (network or cache)");
  return empty;
}

export default { getRegionalFuelPrice, detectCountryCode };
