// Läuft automatisch bei GitHub (siehe .github/workflows/update.yml):
// 1. lädt alle aktuellen Angebote von marktguru für die PLZ aus config.json
// 2. übernimmt CSV-Dateien aus dem Ordner import/ (Exporte deiner alten Website)
// 3. speichert alles in docs/data/products.json (= die "Datenbank")
//
// Lokal testen: node scripts/update.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAllOffers, STORES } from "../docs/js/marktguru.js";
import { mergeOffers, mergeProducts, parseLegacyCSV, guessStoreFromFilename } from "../docs/js/data.js";
import { DEFAULT_KEYWORDS } from "../docs/js/categories.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "docs/data/products.json");
const META = path.join(ROOT, "docs/data/meta.json");
const IMPORT_DIR = path.join(ROOT, "import");
const DONE_DIR = path.join(IMPORT_DIR, "erledigt");

const readJSON = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fallback; } };

const config = {
  zip: "21629",
  stores: STORES.map((s) => s.id),
  keywords: DEFAULT_KEYWORDS,
  extraKeywords: [],
  apiKey: "",
  clientKey: "",
  ...readJSON(path.join(ROOT, "config.json"), {}),
};
// Schlüssel können auch als GitHub-Secret hinterlegt werden
config.apiKey = process.env.MARKTGURU_APIKEY || config.apiKey;
config.clientKey = process.env.MARKTGURU_CLIENTKEY || config.clientKey;

const products = new Map((readJSON(DATA, { products: [] }).products || []).map((p) => [p.id, p]));
const before = products.size;
const meta = readJSON(META, {});
const log = [];

// ---- 1) alte CSV-Dateien übernehmen
if (fs.existsSync(IMPORT_DIR)) {
  for (const f of fs.readdirSync(IMPORT_DIR)) {
    if (!/\.csv$/i.test(f)) continue;
    const store = guessStoreFromFilename(f);
    if (!store) { log.push(`⚠ ${f}: Markt nicht erkennbar – Dateiname muss edeka, aldi, lidl, rewe oder famila enthalten`); continue; }
    try {
      const rows = parseLegacyCSV(fs.readFileSync(path.join(IMPORT_DIR, f), "utf8"), store);
      mergeProducts(products, rows);
      fs.mkdirSync(DONE_DIR, { recursive: true });
      fs.renameSync(path.join(IMPORT_DIR, f), path.join(DONE_DIR, f));
      log.push(`✔ ${f}: ${rows.length} Produkte für ${store} übernommen`);
    } catch (e) {
      log.push(`⚠ ${f}: ${e.message}`);
    }
  }
}

// ---- 2) aktuelle Angebote laden
let fetchResult = null, fetchError = null;
if (process.env.SKIP_FETCH !== "1") {
  try {
    fetchResult = await fetchAllOffers({
      zip: config.zip,
      stores: config.stores,
      keywords: [...config.keywords, ...config.extraKeywords],
      manualKeys: config.apiKey && config.clientKey ? { apiKey: config.apiKey, clientKey: config.clientKey } : null,
      extraHeaders: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
        "Accept-Language": "de-DE,de;q=0.9",
      },
      onProgress: ({ done, total, found, keyword }) => {
        if (done % 10 === 0 || done === total) console.log(`  ${done}/${total} Suchbegriffe (${keyword}) · ${found} Angebote`);
      },
    });
  } catch (e) {
    fetchError = e.message;
  }
}

let added = 0;
if (fetchResult) {
  const r = mergeOffers(products, fetchResult.offers);
  added = r.added;
  log.push(`✔ ${fetchResult.offers.length} Angebote geladen, ${added} neue Produkte (Schlüssel: ${fetchResult.keySource})`);
  if (fetchResult.errors.length) log.push(`⚠ ${fetchResult.errors.length} Suchbegriffe mit Fehler, z. B. ${fetchResult.errors[0]}`);
}
if (fetchError) log.push(`✖ Abruf fehlgeschlagen: ${fetchError}`);

// Nur Code geändert (push) und nichts importiert -> nichts speichern
if (process.env.SKIP_FETCH === "1" && log.length === 0) {
  console.log("Kein Abruf (nur Veröffentlichung), keine Importe.");
  process.exit(0);
}

// ---- 3) speichern
const list = [...products.values()].sort((a, b) => a.id.localeCompare(b.id));
fs.mkdirSync(path.dirname(DATA), { recursive: true });
fs.writeFileSync(DATA, JSON.stringify({ products: list }));
const now = new Date().toISOString();
fs.writeFileSync(META, JSON.stringify({
  ...meta,
  zip: config.zip,
  repo: process.env.GITHUB_REPOSITORY || meta.repo || null,
  stores: config.stores,
  lastRun: now,
  lastUpdate: fetchResult ? now : meta.lastUpdate || null,
  lastOfferCount: fetchResult ? fetchResult.offers.length : meta.lastOfferCount ?? null,
  lastError: fetchError,
  log,
  productCount: list.length,
  seenAdvertisers: fetchResult
    ? Object.entries(fetchResult.seenAdvertisers).sort((a, b) => b[1] - a[1]).slice(0, 60).map(([k, n]) => `${k}: ${n}`)
    : meta.seenAdvertisers || [],
}, null, 2));

console.log(log.join("\n"));
console.log(`Produkte: ${before} → ${list.length}`);
// Ein Fehler wird in meta.json vermerkt; der Workflow zeigt ihn am Ende als rotes X an.
