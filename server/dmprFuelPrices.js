const fetch = require("node-fetch");
const AdmZip = require("adm-zip");
const ExcelJS = require("exceljs");

const DMPR_URL = "https://www.dmpr.gov.za/Branches/Petroleum-Resources/Fuel-Prices";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let cache = { expiresAt: 0, value: null };

const cleanText = (value) => String(value || "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const absoluteUrl = (value) => new URL(value, DMPR_URL).toString();

function findDocumentLinks(html) {
  const links = [];
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const label = cleanText(match[2]);
    if (/fuel price schedule|fuel price adjustment documents|breakdown of prices/i.test(label)) {
      links.push({ label, url: absoluteUrl(match[1]) });
    }
  }
  // The current DMPR page renders the document title in a neighbouring h4,
  // while the View/Download anchors contain only icon text. Its first bit.ly
  // link belongs to the newest effective-price package.
  const newestPackage = html.match(/href=["']([^"']*bit\.ly[^"']*)["']/i);
  if (newestPackage && !links.some((link) => link.url === absoluteUrl(newestPackage[1]))) {
    links.unshift({ label: "Latest DMPR fuel price adjustment documents", url: absoluteUrl(newestPackage[1]) });
  }
  return links;
}

function parseEffectiveDate(html) {
  const match = html.match(/FUEL PRICES EFFECTIVE FROM\s+(\d{2}\s+[A-Z]+\s+\d{4})/i);
  return match ? match[1] : "";
}

function findArchiveEntry(archive, pattern) {
  const entry = archive.getEntries().find((candidate) => pattern.test(candidate.entryName));
  if (entry) return entry.getData();
  const nested = archive.getEntries().find((candidate) => /\.zip$/i.test(candidate.entryName));
  return nested ? findArchiveEntry(new AdmZip(nested.getData()), pattern) : null;
}

async function readDocument(url) {
  const response = await fetch(url, { timeout: 20000, headers: { "User-Agent": "LogMate fuel-price updater" } });
  if (!response.ok) throw new Error(`DMPR document returned ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!/\.zip(?:$|\?)/i.test(url) && buffer.slice(0, 2).toString("hex") !== "504b") {
    throw new Error("DMPR document is not the expected ZIP package");
  }
  const zip = new AdmZip(buffer);
  const workbook = findArchiveEntry(zip, /Fuel Price Schedule.*\.xlsx$/i);
  if (!workbook) throw new Error("DMPR ZIP contains no fuel price schedule workbook");
  return workbook;
}

async function parsePrices(workbookBuffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(workbookBuffer);
  const rowsFor = (name) => workbook.getWorksheet(name).getRows(1, workbook.getWorksheet(name).rowCount).map((row) => row.values.slice(1));
  const petrolRows = rowsFor("Petrol");
  const dieselRows = rowsFor("Diesel");
  const byZone = new Map();
  const addRows = (rows, fuelType, valueColumn) => rows.forEach((row) => {
    const zone = String(row[0] || "").trim();
    const rawValue = row[valueColumn];
    const value = Number(rawValue && typeof rawValue === "object" ? rawValue.result : rawValue);
    if (!/^[0-9]+[A-Z]$/i.test(zone) || !Number.isFinite(value)) return;
    if (!byZone.has(zone)) byZone.set(zone, { region: `Zone ${zone}` });
    byZone.get(zone)[fuelType] = Number((value / 100).toFixed(2));
  });
  // DMPR workbook values are cents/litre. Petrol column 7 is rounded pump
  // price; diesel column 3 is the published regional wholesale price.
  let petrolGrade = null;
  petrolRows.forEach((row) => {
    const heading = row.join(" ");
    if (/93 RON/i.test(heading)) petrolGrade = "petrol_93";
    if (/95 RON/i.test(heading)) petrolGrade = "petrol_95";
    if (petrolGrade) addRows([row], petrolGrade, 7);
  });
  let dieselGrade = null;
  dieselRows.forEach((row) => {
    const heading = row.join(" ");
    if (/0\.05%/i.test(heading)) dieselGrade = "diesel_05";
    if (/0\.005%/i.test(heading)) dieselGrade = "diesel_005";
    if (dieselGrade) addRows([row], dieselGrade, 3);
  });
  const rows = [...byZone.values()].filter((row) => Object.keys(row).length > 1);
  if (!rows.length) throw new Error("No regional fuel price rows found in DMPR workbook");
  return rows;
}

async function scrapeDmprFuelPrices() {
  const pageResponse = await fetch(DMPR_URL, { timeout: 20000, headers: { "User-Agent": "LogMate fuel-price updater" } });
  if (!pageResponse.ok) throw new Error(`DMPR page returned ${pageResponse.status}`);
  const html = await pageResponse.text();
  const links = findDocumentLinks(html);
  const document = links.find((link) => /fuel price adjustment documents/i.test(link.label)) || links.find((link) => /fuel price schedule/i.test(link.label)) || links.find((link) => /breakdown of prices/i.test(link.label));
  if (!document) throw new Error("No current DMPR fuel document link found");
  const prices = await parsePrices(await readDocument(document.url));
  return {
    country: "ZA",
    currency: "R",
    effectiveFrom: parseEffectiveDate(html),
    source: DMPR_URL,
    documentUrl: document.url,
    fetchedAt: new Date().toISOString(),
    prices,
  };
}

async function getDmprFuelPrices() {
  if (cache.value && cache.expiresAt > Date.now()) return cache.value;
  const value = await scrapeDmprFuelPrices();
  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

module.exports = { getDmprFuelPrices, DMPR_URL };
