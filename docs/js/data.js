// Datenlogik ohne Oberfläche: Angebote zusammenführen, alte CSV importieren, Backup.
import { guessCategory, normalizeCategory } from "./categories.js";
import { currentWeekIndex, legacyWeeksToIndexes, predictNext, berlinWeekIndex } from "./predict.js";

/** Vergleichsschlüssel für Produktnamen ("Milka  Alpenmilch-Schokolade" == "milka alpenmilch schokolade") */
export function nameKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9äöü%]+/g, " ")
    .trim();
}

export const productId = (store, name) => `${store}|${nameKey(name)}`;

export function savedPercent(price, oldPrice) {
  if (!(price >= 0) || !(oldPrice > price)) return null;
  return Math.round((1 - price / oldPrice) * 1000) / 10;
}

/**
 * Führt frisch geladene Angebote in den Produktbestand ein.
 * @param {Map<string,object>} products  Bestand (wird verändert)
 * @param {object[]} offers              normalisierte Angebote (marktguru.js)
 * @returns {{ changed: object[], added: number, updated: number }}
 */
export function mergeOffers(products, offers, now = new Date()) {
  const nowIdx = currentWeekIndex(now);
  const changed = new Map();
  let added = 0, updated = 0;

  for (const o of offers) {
    if (!o.name) continue;
    const id = productId(o.store, o.name);
    let p = products.get(id);
    if (!p) {
      p = {
        id, store: o.store, name: o.name, brand: o.brand || "",
        category: guessCategory(o.categoryText, o.name, o.description),
        favorite: false, history: [], lastSeen: null,
      };
      products.set(id, p);
      added++;
    } else if (!changed.has(id)) {
      updated++;
    }
    // Ein Angebot kann mehrere Wochen gelten -> jede Woche eintragen (max. 6)
    const first = o.from ? berlinWeekIndex(o.from) : nowIdx;
    const last = o.to ? Math.max(first, berlinWeekIndex(o.to)) : first;
    for (let week = first; week <= Math.min(last, first + 5); week++) {
      const entry = {
        week, price: o.price, oldPrice: o.oldPrice,
        savedPercent: savedPercent(o.price, o.oldPrice),
        from: o.from, to: o.to, unit: o.unit || "", referencePrice: o.referencePrice ?? null,
        source: "marktguru",
      };
      const i = p.history.findIndex((h) => h.week === week);
      if (i === -1) p.history.push(entry);
      else if (entry.price != null && (p.history[i].price == null || p.history[i].source !== "marktguru" || entry.price < p.history[i].price)) p.history[i] = entry;
    }
    p.history.sort((a, b) => a.week - b.week);
    p.lastSeen = new Date(now).toISOString();
    changed.set(id, p);
  }
  return { changed: [...changed.values()], added, updated };
}

/** Kennzahlen eines Produkts für die Anzeige (letztes Angebot, Vorhersage ...) */
export function describe(p, nowIdx = currentWeekIndex()) {
  const weeks = p.history.map((h) => h.week);
  const pred = predictNext(weeks, nowIdx);
  const latest = p.history[p.history.length - 1] || null;
  const current = p.history.find((h) => h.week === nowIdx) || null;
  const upcoming = p.history.find((h) => h.week > nowIdx) || null;
  const prices = p.history.map((h) => h.price).filter((x) => x != null);
  return {
    pred, latest, current, upcoming,
    bestPrice: prices.length ? Math.min(...prices) : null,
  };
}

/* ------------------------------------------------------------------ */
/* Import der CSV-Exporte deiner alten Website (edeka.html / aldi.html) */
/* ------------------------------------------------------------------ */

function splitCSVLine(line, delimiter) {
  const out = []; let cur = ""; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ;
    } else if (ch === delimiter && !inQ) { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseNumber(raw) {
  if (raw == null) return NaN;
  let s = String(raw).trim().replace(/\s+/g, "").replace(/[%€]/g, "");
  if (!s) return NaN;
  if (s.includes(",") && s.includes(".")) {
    s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (s.includes(",")) s = s.replace(",", ".");
  return Number(s);
}

/** Errät den Markt aus dem Dateinamen (edeka_angebote_....csv) */
export function guessStoreFromFilename(name) {
  const n = String(name || "").toLowerCase();
  for (const id of ["edeka", "aldi", "lidl", "rewe", "famila"]) if (n.includes(id)) return id;
  return null;
}

/**
 * Liest den CSV-Export der alten Website und gibt Produkte im neuen Format zurück.
 * Erwartete Spalten: Produkt, Kategorie, Normaler Preis (€), Angebots Preis (€),
 * Gespart (%), 1./2./3. Vorkommen (KW)
 */
export function parseLegacyCSV(text, store, nowIdx = currentWeekIndex()) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!lines.length) throw new Error("Datei ist leer");
  const first = lines[0];
  const delimiter = splitCSVLine(first, ";").length > splitCSVLine(first, ",").length ? ";" : ",";
  const header = splitCSVLine(first, delimiter).map((h) => h.trim().toLowerCase());
  const col = (...aliases) => header.findIndex((h) => aliases.some((a) => h === a || h.startsWith(a)));
  const map = {
    product: col("produkt"),
    category: col("kategorie"),
    offer: col("angebots preis", "angebotspreis", "preis"),
    saved: col("gespart", "rabatt"),
    normal: col("normaler preis"),
    kw1: col("1. vorkommen", "kw1", "kw 1"),
    kw2: col("2. vorkommen", "kw2", "kw 2"),
    kw3: col("3. vorkommen", "kw3", "kw 3"),
  };
  if (map.product < 0) throw new Error('Spalte "Produkt" nicht gefunden – ist das ein Export der alten Website?');

  const result = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i], delimiter);
    const get = (idx) => (idx >= 0 && idx < cols.length ? cols[idx].trim() : "");
    const name = get(map.product);
    if (!name) continue;
    const kws = [get(map.kw1), get(map.kw2), get(map.kw3)].map((v) => (v === "" ? null : Math.floor(Number(v))));
    const weeks = legacyWeeksToIndexes(kws, nowIdx);
    const price = parseNumber(get(map.offer));
    const saved = parseNumber(get(map.saved));
    let normal = parseNumber(get(map.normal));
    if (Number.isFinite(price) && Number.isFinite(saved) && saved < 100) normal = (100 * price) / (100 - saved);
    const cat = normalizeCategory(get(map.category)) || guessCategory(name);

    const history = weeks.map((week, j) => {
      const isLast = j === weeks.length - 1;
      return {
        week,
        price: isLast && Number.isFinite(price) ? price : null,
        oldPrice: isLast && Number.isFinite(normal) ? Math.round(normal * 100) / 100 : null,
        savedPercent: isLast && Number.isFinite(saved) ? saved : null,
        from: null, to: null, unit: "", referencePrice: null, source: "alte Website",
      };
    });
    result.push({
      id: productId(store, name), store, name, brand: "", category: cat,
      favorite: false, history, lastSeen: null,
    });
  }
  return result;
}

/** Fügt importierte Produkte (CSV oder Backup) in den Bestand ein – Historien werden vereinigt. */
export function mergeProducts(products, incoming) {
  const changed = [];
  for (const inc of incoming) {
    const p = products.get(inc.id);
    if (!p) { products.set(inc.id, inc); changed.push(inc); continue; }
    for (const h of inc.history) {
      const i = p.history.findIndex((x) => x.week === h.week);
      if (i === -1) p.history.push(h);
      else if (p.history[i].price == null && h.price != null) p.history[i] = h;
    }
    p.history.sort((a, b) => a.week - b.week);
    if (!p.category || p.category === "Sonstiges") p.category = inc.category || p.category;
    p.favorite = p.favorite || !!inc.favorite;
    changed.push(p);
  }
  return changed;
}

export function makeBackup(productsArr) {
  return JSON.stringify({ app: "einkaufswagen", version: 1, exportedAt: new Date().toISOString(), products: productsArr });
}

export function readBackup(text) {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.products)) throw new Error("Keine gültige Sicherungsdatei");
  return data.products.filter((p) => p && p.id && p.store && Array.isArray(p.history));
}
