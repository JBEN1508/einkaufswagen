import { test } from "node:test";
import assert from "node:assert/strict";
import {
  weekIndexOf, isoWeekOfIndex, indexFromIsoWeek, actionStarts, predictNext, legacyWeeksToIndexes, formatWeek,
} from "../docs/js/predict.js";
import { extractKeys, storeOfOffer, normalizeOffer } from "../docs/js/marktguru.js";
import { mergeOffers, parseLegacyCSV, describe, guessStoreFromFilename } from "../docs/js/data.js";
import { guessCategory } from "../docs/js/categories.js";

test("ISO-Kalenderwochen", () => {
  assert.deepEqual(isoWeekOfIndex(weekIndexOf(new Date(2026, 10, 20))), { year: 2026, week: 47 });
  assert.deepEqual(isoWeekOfIndex(weekIndexOf(new Date(2026, 11, 31))), { year: 2026, week: 53 });
  assert.deepEqual(isoWeekOfIndex(weekIndexOf(new Date(2027, 0, 4))), { year: 2027, week: 1 });
  assert.deepEqual(isoWeekOfIndex(weekIndexOf(new Date(2025, 11, 29))), { year: 2026, week: 1 });
  for (const [y, w] of [[2026, 1], [2026, 53], [2027, 1], [2025, 52], [2024, 1]]) {
    assert.deepEqual(isoWeekOfIndex(indexFromIsoWeek(y, w)), { year: y, week: w });
  }
  assert.equal(formatWeek(indexFromIsoWeek(2026, 49)), "KW 49 (30.11.–05.12.)");
});

test("Aufeinanderfolgende Wochen zählen als eine Aktion", () => {
  assert.deepEqual(actionStarts([10, 11, 17, 23, 24]), [10, 17, 23]);
});

test("Vorhersage mit regelmäßigem Rhythmus", () => {
  const now = 100;
  const r = predictNext([82, 88, 94, 100 - 2], now); // Abstände 6, 6, 4
  assert.equal(r.interval, 6);
  assert.equal(r.nextIdx, 104);
  assert.equal(r.weeksUntil, 4);
  const r2 = predictNext([70, 76, 82, 88, 94], 97);
  assert.equal(r2.confidence, "hoch");
  assert.equal(r2.nextIdx, 100);
  assert.equal(r2.status, "ok");
});

test("Vorhersage: zu wenig Daten, aktiv, überfällig", () => {
  assert.equal(predictNext([90], 95).nextIdx, null);
  assert.equal(predictNext([90, 95], 95).status, "active");
  assert.equal(predictNext([80, 84], 95).status, "overdue");
});

test("Alte KW-Zahlen über den Jahreswechsel", () => {
  const now = indexFromIsoWeek(2027, 10);
  const idx = legacyWeeksToIndexes([50, 2, 7], now);
  assert.deepEqual(idx.map(isoWeekOfIndex), [{ year: 2026, week: 50 }, { year: 2027, week: 2 }, { year: 2027, week: 7 }]);
  assert.equal(idx[1] - idx[0], 5); // 2026 hat 53 Wochen
  // letzte KW liegt nach der aktuellen -> Vorjahr
  const idx2 = legacyWeeksToIndexes([40, 45, null], indexFromIsoWeek(2026, 47));
  assert.deepEqual(idx2.map((i) => isoWeekOfIndex(i).year), [2026, 2026]);
  const idx3 = legacyWeeksToIndexes([30], indexFromIsoWeek(2026, 10));
  assert.equal(isoWeekOfIndex(idx3[0]).year, 2025);
});

test("Schlüssel aus marktguru-HTML lesen", () => {
  const html = `<script type="application/json">{"config":{"apiKey":"AAA+1=","clientKey":"BBB/2="}}</script>`;
  assert.deepEqual(extractKeys(html), { apiKey: "AAA+1=", clientKey: "BBB/2=" });
  const old = `<script>window.x={"x_apikey":"K1","x_clientkey":"K2"}</script>`;
  assert.deepEqual(extractKeys(old), { apiKey: "K1", clientKey: "K2" });
  assert.equal(extractKeys("<html></html>"), null);
});

test("Markt-Erkennung", () => {
  const mk = (uniqueName, name) => ({ advertisers: [{ uniqueName, name }] });
  assert.equal(storeOfOffer(mk("aldi-nord", "ALDI Nord")), "aldi");
  assert.equal(storeOfOffer(mk("aldi-sued", "ALDI SÜD")), null);
  assert.equal(storeOfOffer(mk("famila-nordost", "famila Nordost")), "famila");
  assert.equal(storeOfOffer(mk("rewe", "REWE")), "rewe");
  assert.equal(storeOfOffer(mk("penny", "Penny")), null);
  assert.equal(storeOfOffer(mk("lidl", "Lidl"), ["edeka"]), null);
});

test("Angebote zusammenführen und Historie aufbauen", () => {
  const products = new Map();
  const raw = (id, from, price) => normalizeOffer({
    id, price, oldPrice: 1.99, brand: { name: "Milka" }, product: { name: "Alpenmilch Schokolade" },
    categories: [{ name: "Süßwaren" }], validityDates: [{ from, to: from }], advertisers: [{ uniqueName: "edeka" }],
  }, "edeka");
  mergeOffers(products, [raw(1, "2026-10-05T00:00:00Z", 0.99)], new Date("2026-10-06"));
  mergeOffers(products, [raw(2, "2026-10-19T00:00:00Z", 1.09)], new Date("2026-10-20"));
  const r = mergeOffers(products, [raw(3, "2026-11-02T00:00:00Z", 0.99), raw(4, "2026-11-02T00:00:00Z", 0.89)], new Date("2026-11-03"));
  assert.equal(products.size, 1);
  const p = [...products.values()][0];
  assert.equal(p.name, "Milka Alpenmilch Schokolade");
  assert.equal(p.category, "Knabbern & Naschen");
  assert.equal(p.history.length, 3);
  assert.equal(p.history[2].price, 0.89); // günstigere Variante gewinnt
  assert.equal(p.history[0].savedPercent, 50.3);
  assert.equal(r.added, 0);
  const d = describe(p, weekIndexOf(new Date("2026-11-20")));
  assert.equal(d.pred.interval, 2);
  assert.equal(isoWeekOfIndex(d.pred.nextIdx).week, 47);
});

test("CSV der alten Website importieren", () => {
  const csv = [
    '"Produkt","Kategorie","Normaler Preis (€)","Angebots Preis (€)","Gespart (%)","1. Vorkommen (KW)","2. Vorkommen (KW)","3. Vorkommen (KW)","Abstand (Ø KW)"',
    '"Barilla Fusilli","Grundnahrung","1.98","1.29","35","38","42","46","4"',
    '"Gouda","Molkerei&Käse","","2.49","","45","",""," "',
  ].join("\r\n");
  const now = indexFromIsoWeek(2026, 47);
  const rows = parseLegacyCSV(csv, "edeka", now);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, "edeka|barilla fusilli");
  assert.equal(rows[0].history.length, 3);
  assert.equal(rows[0].history[2].price, 1.29);
  const d = describe(rows[0], now);
  assert.equal(isoWeekOfIndex(d.pred.nextIdx).week, 50);
  assert.equal(rows[1].history.length, 1);
  assert.equal(guessStoreFromFilename("aldi_angebote_2026-11-01.csv"), "aldi");
});

test("Kategorien raten", () => {
  assert.equal(guessCategory("Gouda jung"), "Molkerei&Käse");
  assert.equal(guessCategory("Hähnchenbrustfilet"), "Fleisch&Wurst");
  assert.equal(guessCategory("Krombacher Pils"), "Getränke");
  assert.equal(guessCategory("Bananen"), "Obst&Gemüse");
  assert.equal(guessCategory("Ariel Waschmittel"), "Haushalt");
});
