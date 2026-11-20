// ALDI Nord: die Angebotsseite aldi-nord.de/angebote.html enthält alle Angebote
// der Woche als JSON (Next.js-Daten, "__NEXT_DATA__" → apiData → OFFER_GET).
// ALDI-Nord-Angebote gelten bundesweit gleich.

const URL = "https://www.aldi-nord.de/angebote.html";

// Aktionsgruppen ohne Lebensmittel/Drogerie – werden übersprungen
const SKIP_GROUPS = /mode|schlafzimmer|wohnzimmer|deko|möbel|garten|werkzeug|baumarkt|elektro|multimedia|spielzeug|sport|freizeit|heimwerk|küchenhelfer|textil|schuhe|pflanzen/i;

// eindeutige Gruppen -> Kategorie-Hinweis
function groupHint(title) {
  if (/obst|gemüse/i.test(title)) return "Obst Gemüse";
  if (/getränke/i.test(title)) return "Getränke";
  if (/snacks|süßes/i.test(title)) return "Snacks";
  return "";
}

/** Liest die Angebote aus dem HTML der ALDI-Angebotsseite. */
export function parseAldiHtml(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("ALDI: Angebotsdaten auf der Seite nicht gefunden (Seitenaufbau geändert?)");
  const next = JSON.parse(m[1]);
  let api = next?.props?.pageProps?.apiData;
  if (typeof api === "string") api = JSON.parse(api);
  const entries = Array.isArray(api) ? api : Object.entries(api || {});
  const offerGet = entries.find((e) => e[0] === "OFFER_GET")?.[1];
  const res = offerGet?.res;
  if (!res?.algoliaDataMap) throw new Error("ALDI: keine Angebotsliste (OFFER_GET) gefunden");

  // Produkt-ID -> Aktionsgruppe
  const groupOf = {};
  for (const aktion of res.categories || []) {
    for (const g of aktion.content || []) {
      for (const id of g.productIds || []) groupOf[id] = { title: g.title || "", start: aktion.startDate, end: aktion.endDate };
    }
  }

  const offers = [];
  let skipped = 0;
  for (const [id, it] of Object.entries(res.algoliaDataMap)) {
    const group = groupOf[id] || groupOf[it.objectID] || { title: "" };
    if (SKIP_GROUPS.test(group.title)) { skipped++; continue; }
    const promo = (it.promotionPrices || [])[0] || {};
    const price = promo.priceValue ?? it.currentPrice?.priceValue ?? null;
    if (price == null || !it.name) continue;
    const from = promo.validFromLocalDate || group.start || null;
    const to = promo.validUntilLocalDate || group.end || null;
    const brand = (it.brandName || "").trim();
    const name = brand && !it.name.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${it.name}` : it.name;
    const img = (it.assets || []).find((a) => a.type === "primary")?.url || (it.assets || [])[0]?.url || null;
    offers.push({
      mgId: `aldi-${it.objectID || id}`,
      image: img ? `${img}?wid=240` : null,
      imageLarge: img ? `${img}?wid=640` : null,
      store: "aldi",
      name: name.replace(/\s+/g, " ").trim(),
      brand,
      description: [it.shortDescription, it.salesUnit].filter(Boolean).join(" · "),
      categoryText: groupHint(group.title),
      price,
      oldPrice: null, // ALDI nennt keine Streichpreise
      referencePrice: it.currentPrice?.basePrice?.[0]?.basePriceValue ?? null,
      unit: it.salesUnit || "",
      // lokale Daten -> Mittag UTC, damit die Woche sicher stimmt
      from: from ? `${from}T12:00:00Z` : null,
      to: to ? `${to}T12:00:00Z` : null,
    });
  }
  return { offers, skipped };
}

export async function fetchAldi(headers = {}) {
  const res = await fetch(URL, { headers: { ...headers, Accept: "text/html" } });
  if (!res.ok) throw new Error(`ALDI: HTTP ${res.status}`);
  return parseAldiHtml(await res.text());
}
