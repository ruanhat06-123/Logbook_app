const fetch = require("node-fetch");

const API_URL = "https://fuelprice.co.za/api/v1/prices/current";
const CACHE_TTL_MS = 3 * 60 * 60 * 1000;
const cache = new Map();
const ALLOWED_FUEL_TYPES = new Set(["petrol_93", "petrol_95", "diesel_005", "diesel_05"]);

const fuelQueryFor = (fuelType) => {
  if (fuelType === "petrol_93" || fuelType === "petrol_95") {
    return { fuel_type: "unleaded", octane: fuelType.endsWith("93") ? "93" : "95" };
  }
  return { fuel_type: fuelType === "diesel_05" ? "500ppm" : "50ppm" };
};

const scalar = (value) => typeof value === "string" || typeof value === "number" ? String(value) : "";

function collectRecords(value, pathParts = [], records = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectRecords(item, [...pathParts, String(index)], records));
    return records;
  }
  if (!value || typeof value !== "object") return records;

  const keys = Object.keys(value);
  const hasPrice = keys.some((key) => ["price_zar", "priceZar", "price_per_litre", "pricePerLitre", "price_cents", "priceCents", "price"].includes(key));
  if (hasPrice) records.push({ value, path: pathParts.join(" ") });

  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === "object") collectRecords(child, [...pathParts, key], records);
  }
  return records;
}

const recordText = ({ value, path }) => {
  const descriptiveFields = [
    "fuel_type", "fuelType", "fuel_category", "fuelCategory", "category",
    "type", "grade", "name", "product", "label", "octane", "location",
    "region", "zone", "fuel_name", "fuelName",
  ];
  return [path, ...descriptiveFields.map((key) => scalar(value[key]))]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
};

function matchesFuel(record, fuelType) {
  const text = recordText(record).replace(/[^a-z0-9.]+/g, " ");
  const diesel = fuelType.startsWith("diesel");
  if (diesel !== /diesel|ppm/.test(text)) return false;
  if (fuelType === "petrol_93") return /93/.test(text) && /petrol|unleaded|ron/.test(text);
  if (fuelType === "petrol_95") return /95/.test(text) && /petrol|unleaded|ron/.test(text);
  if (fuelType === "diesel_05") return /\b500\s*ppm|\bppm\s*500\b|diesel\s*0?\.?0?5\b/.test(text);
  return /\b50\s*ppm|\bppm\s*50\b|diesel\s*0?\.0?05\b/.test(text);
}

function priceInRand(value) {
  const direct = Number(value.price_zar ?? value.priceZar ?? value.price_per_litre ?? value.pricePerLitre);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const cents = Number(value.price_cents ?? value.priceCents ?? value.cents);
  if (Number.isFinite(cents) && cents > 0) return cents / 100;
  const generic = Number(value.price);
  if (!Number.isFinite(generic) || generic <= 0) return null;
  // The provider documents generic `price` values in cents per litre.
  return generic > 150 ? generic / 100 : generic;
}

function regionFor(record) {
  const text = recordText(record);
  if (/reef|inland|gauteng/.test(text)) return "Inland (Reef)";
  if (/coast|coastal|cape town|durban/.test(text)) return "Coastal";
  return "South Africa";
}

function effectiveDateFor(payload) {
  const keys = ["effective_date", "effectiveDate", "effective_from", "effectiveFrom", "date"];
  for (const key of keys) {
    const value = payload?.[key] ?? payload?.data?.[key] ?? payload?.meta?.[key];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

function normalizePayload(payload, fuelType) {
  const prices = collectRecords(payload)
    .filter((record) => matchesFuel(record, fuelType))
    .map((record) => ({ region: regionFor(record), price: priceInRand(record.value) }))
    .filter((record) => Number.isFinite(record.price) && record.price > 0);

  const unique = [...new Map(prices.map((row) => [`${row.region}:${row.price}`, row])).values()];
  if (!unique.length) throw new Error("Fuel-price provider returned no matching price rows");

  return {
    country: "ZA",
    currency: "R",
    source: "FuelPrice.co.za",
    effectiveFrom: effectiveDateFor(payload),
    fetchedAt: new Date().toISOString(),
    fuelType,
    prices: unique,
  };
}

async function getFuelPriceCatalog(fuelType) {
  const type = String(fuelType || "petrol_95").toLowerCase();
  if (!ALLOWED_FUEL_TYPES.has(type)) throw new Error("Unsupported fuel type");

  const cached = cache.get(type);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const apiKey = String(process.env.FUELPRICE_API_KEY || "").trim();
  if (!apiKey) throw new Error("FuelPrice API is not configured");

  const url = new URL(API_URL);
  for (const [key, value] of Object.entries(fuelQueryFor(type))) url.searchParams.set(key, value);

  const response = await fetch(url.toString(), {
    headers: { "X-API-Key": apiKey, Accept: "application/json" },
    timeout: 10000,
  });
  if (!response.ok) {
    throw new Error(`FuelPrice API returned HTTP ${response.status}`);
  }

  const payload = await response.json();
  const catalog = normalizePayload(payload, type);
  cache.set(type, { value: catalog, expiresAt: Date.now() + CACHE_TTL_MS });
  return catalog;
}

module.exports = { getFuelPriceCatalog, normalizePayload };
