// Datenquelle: marktguru.de
//
// Warum marktguru und nicht direkt edeka.de, rewe.de, lidl.de ...?
// Die Supermarkt-Seiten sind durch Bot-Schutz (Cloudflare/Akamai) abgesichert
// und ändern ihr Layout ständig. marktguru sammelt die Prospekt-Angebote aller
// fünf Ketten (EDEKA, ALDI Nord, Lidl, REWE, famila) für eine Postleitzahl an
// einer Stelle – das ist deutlich stabiler.
//
// marktguru hat keine offizielle API. Die App nutzt dieselben Aufrufe wie die
// Website im Browser: Sie liest die öffentlichen Schlüssel von der Startseite
// und ruft damit die Angebotssuche auf. Falls marktguru das ändert, kannst du
// die Schlüssel in den Einstellungen von Hand eintragen.
//
// Diese Datei läuft in der GitHub-Version NICHT im Browser, sondern im
// GitHub-Server (scripts/update.mjs mit Node.js). Dort gibt es keine CORS-Sperre.

export const STORES = [
  { id: "edeka",  label: "EDEKA",     color: "#ffd400", match: /edeka/i },
  { id: "aldi",   label: "ALDI Nord", color: "#4fa3ff", match: /aldi(?![\s-]*s(ü|ue|u)d)/i },
  { id: "lidl",   label: "Lidl",      color: "#ffcc00", match: /lidl/i },
  { id: "rewe",   label: "REWE",      color: "#ff4b4b", match: /rewe/i },
  { id: "famila", label: "famila",    color: "#3fd17a", match: /famila/i },
];
export const storeById = Object.fromEntries(STORES.map((s) => [s.id, s]));

const API = "https://api.marktguru.de/api/v1";
const HOME = "https://www.marktguru.de/";

// Zuletzt öffentlich bekannte Web-Schlüssel – nur als Notlösung, falls das
// Auslesen der Startseite scheitert. Können veraltet sein.
const FALLBACK_KEYS = {
  apiKey: "8Kk+pmbf7TgJ9nVj2cXeA7P5zBGv8iuutVVMRfOfvNE=",
  clientKey: "WU/RH+PMGDi+gkZer3WbMelt6zcYHSTytNB7VpTia90=",
};

/** Sucht apiKey/clientKey im HTML der marktguru-Startseite. */
export function extractKeys(html) {
  const pick = (patterns) => {
    for (const re of patterns) { const m = html.match(re); if (m) return m[1]; }
    return null;
  };
  const apiKey = pick([
    /"apiKey"\s*:\s*"([^"]+)"/i, /"x_apikey"\s*:\s*"([^"]+)"/i, /"x-apikey"\s*:\s*"([^"]+)"/i,
    /apiKey\s*[:=]\s*['"]([^'"]+)['"]/i,
  ]);
  const clientKey = pick([
    /"clientKey"\s*:\s*"([^"]+)"/i, /"x_clientkey"\s*:\s*"([^"]+)"/i, /"x-clientkey"\s*:\s*"([^"]+)"/i,
    /clientKey\s*[:=]\s*['"]([^'"]+)['"]/i,
  ]);
  return apiKey && clientKey ? { apiKey, clientKey } : null;
}

/** Holt die Schlüssel: manuell eingetragen > von der Startseite > Notlösung. */
export async function getKeys({ manual, extraHeaders = {} } = {}) {
  if (manual?.apiKey && manual?.clientKey) return { ...manual, source: "manuell" };
  try {
    const res = await fetch(HOME, { headers: { ...extraHeaders, Accept: "text/html" } });
    if (res.ok) {
      const keys = extractKeys(await res.text());
      if (keys) return { ...keys, source: "marktguru.de" };
    }
  } catch (e) { /* weiter mit Notlösung */ }
  return { ...FALLBACK_KEYS, source: "eingebaut" };
}

/** Ermittelt aus den "advertisers" eines Angebots den Markt (oder null). */
export function storeOfOffer(offer, enabled = STORES.map((s) => s.id)) {
  const names = (offer.advertisers || []).map((a) => `${a.uniqueName || ""} ${a.name || ""}`).join(" ");
  for (const s of STORES) if (enabled.includes(s.id) && s.match.test(names)) return s.id;
  return null;
}

const num = (v) => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/** Baut aus einem marktguru-Angebot einen sauberen Datensatz. */
export function normalizeOffer(o, store) {
  const brand = (o.brand?.name || "").trim();
  let name = (o.product?.name || "").trim();
  if (!name) name = String(o.description || "").split(/\n|\. /)[0].slice(0, 80).trim();
  if (brand && !name.toLowerCase().includes(brand.toLowerCase())) name = `${brand} ${name}`;
  const price = num(o.price);
  const oldPrice = num(o.oldPrice);
  const vd = (o.validityDates || [])[0] || {};
  return {
    mgId: o.id,
    store,
    name: name.replace(/\s+/g, " "),
    brand,
    description: o.description || "",
    categoryText: (o.categories || []).map((c) => c.name).join(" "),
    price,
    oldPrice: oldPrice && price != null && oldPrice > price ? oldPrice : null,
    referencePrice: num(o.referencePrice),
    unit: o.unit?.shortName || o.unit?.name || "",
    // Produktbild vom marktguru-CDN (Muster am 20.11.2026 geprüft)
    image: o.images?.count > 0 && o.id != null ? `https://mg2de.b-cdn.net/api/v1/offers/${o.id}/images/default/0/small.webp` : null,
    imageLarge: o.images?.count > 0 && o.id != null ? `https://mg2de.b-cdn.net/api/v1/offers/${o.id}/images/default/0/medium.webp` : null,
    from: vd.from || null,
    to: vd.to || null,
  };
}

async function searchOnce(q, { zip, keys, limit, offset, signal, extraHeaders = {} }) {
  const url = `${API}/offers/search?as=web&limit=${limit}&offset=${offset}&q=${encodeURIComponent(q)}&zipCode=${encodeURIComponent(zip)}`;
  const res = await fetch(url, {
    signal,
    headers: { ...extraHeaders, "x-apikey": keys.apiKey, "x-clientkey": keys.clientKey, Accept: "application/json" },
  });
  if (res.status === 401 || res.status === 403) {
    const err = new Error(`marktguru lehnt die Schlüssel ab (HTTP ${res.status})`);
    err.auth = true;
    throw err;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} bei „${q}“`);
  const data = await res.json();
  return Array.isArray(data?.results) ? data.results : [];
}

/**
 * Ruft alle Angebote der gewählten Märkte für eine PLZ ab.
 * @param {object} opts
 * @param {string} opts.zip
 * @param {string[]} opts.stores        z. B. ["edeka","aldi"]
 * @param {string[]} opts.keywords      Suchbegriffe
 * @param {{apiKey,clientKey}} [opts.manualKeys]
 * @param {(p:{done:number,total:number,found:number,keyword:string})=>void} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]
 */
export async function fetchAllOffers({ zip, stores, keywords, manualKeys, onProgress, signal, concurrency = 4, extraHeaders = {} }) {
  let keys = await getKeys({ manual: manualKeys, extraHeaders });
  const byId = new Map();
  const seenAdvertisers = {}; // zur Kontrolle: welche Ketten liefert marktguru für die PLZ?
  const errors = [];
  let done = 0;
  let authFailed = false;
  const queue = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))];
  const total = queue.length;
  const LIMIT = 250;

  async function runKeyword(q) {
    for (let offset = 0; offset < 1500; offset += LIMIT) {
      let results;
      try {
        results = await searchOnce(q, { zip, keys, limit: LIMIT, offset, signal, extraHeaders });
      } catch (e) {
        if (e.name === "AbortError") throw e;
        if (e.auth && keys.source !== "eingebaut" && !manualKeys) {
          // Schlüssel evtl. veraltet -> einmal Notlösung probieren
          keys = { ...FALLBACK_KEYS, source: "eingebaut" };
          results = await searchOnce(q, { zip, keys, limit: LIMIT, offset, signal, extraHeaders }).catch((e2) => { throw e2; });
        } else throw e;
      }
      for (const o of results) {
        for (const a of o.advertisers || []) {
          const k = `${a.name} [${a.uniqueName}]`;
          seenAdvertisers[k] = (seenAdvertisers[k] || 0) + 1;
        }
        const store = storeOfOffer(o, stores);
        if (!store || o.id == null) continue;
        if (!byId.has(o.id)) byId.set(o.id, normalizeOffer(o, store));
      }
      if (results.length < LIMIT) break;
    }
  }

  async function worker() {
    while (queue.length && !authFailed) {
      if (signal?.aborted) throw new DOMException("Abgebrochen", "AbortError");
      const q = queue.shift();
      try {
        await runKeyword(q);
      } catch (e) {
        if (e.name === "AbortError") throw e;
        if (e.auth) authFailed = true;
        errors.push(`${q}: ${e.message}`);
      }
      done++;
      onProgress?.({ done, total, found: byId.size, keyword: q });
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));
  if (authFailed && byId.size === 0) {
    throw new Error("marktguru hat den Zugriff abgelehnt. Bitte aktuelle Schlüssel in config.json eintragen (siehe Anleitung).");
  }
  if (byId.size === 0 && errors.length) {
    throw new Error(`Keine Angebote geladen. Erster Fehler: ${errors[0]}`);
  }
  return { offers: [...byId.values()], errors, keySource: keys.source, seenAdvertisers };
}
