import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAldiHtml } from "../scripts/sources/aldi.mjs";
import { parseFamilaBookConfig, findLeaflets } from "../scripts/sources/famila.mjs";

test("ALDI-Angebotsseite lesen", () => {
  const api = [["OFFER_GET", { req: {}, res: {
    categories: [{ startDate: "2026-11-16", endDate: "2026-11-21", content: [
      { title: "Haltbare Produkte", productIds: ["1"] }, { title: "Damenmode", productIds: ["2"] }] }],
    algoliaDataMap: {
      1: { objectID: "1", name: "Kritharaki", brandName: "LYTTOS", salesUnit: "500-g-Beutel", currentPrice: { priceValue: 0.89 },
           promotionPrices: [{ priceValue: 0.89, validFromLocalDate: "2026-11-16", validUntilLocalDate: "2026-11-21" }] },
      2: { objectID: "2", name: "Lammfellboots", currentPrice: { priceValue: 24.99 }, promotionPrices: [] },
    } } }]];
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { apiData: JSON.stringify(api) } } })}</script>`;
  const { offers, skipped } = parseAldiHtml(html);
  assert.equal(offers.length, 1);
  assert.equal(skipped, 1);
  assert.equal(offers[0].name, "LYTTOS Kritharaki");
  assert.equal(offers[0].price, 0.89);
  assert.equal(offers[0].from, "2026-11-16T12:00:00Z");
});

test("famila-Prospekttext lesen (nur bestätigte Preise)", () => {
  const page = [
    "Neu Wulmstorf | Gültig ab Mo., 16.11. bis Sa., 21.11.26 | KW47",
    "KoRo", "Medjool Datteln", "mit Stein, 1-kg-Packung", "3.99* spar 25%", "2.", "99",
    "Biofrusan", "geröstete", "Bio-Erdnüsse", "in der Schale", "250-g-Beutel", "4.49* spar 11%", "3.", "99",
    "Falsch", "Produkt", "5.99* spar 50%", "1.", "00",
  ].join("\r\n");
  const js = `var textForPages =${JSON.stringify([page])};`;
  const { offers, validity } = parseFamilaBookConfig(js);
  assert.deepEqual(offers.map((o) => [o.name, o.price, o.oldPrice]), [
    ["KoRo Medjool Datteln", 2.99, 3.99], ["Biofrusan geröstete Bio-Erdnüsse", 3.99, 4.49]]);
  assert.equal(validity.from, "2026-11-16T12:00:00Z");
  assert.deepEqual(findLeaflets('<a href="/handzettel/famila_kw47_DJWWW/index.html?x">'), ["famila_kw47_DJWWW"]);
});
