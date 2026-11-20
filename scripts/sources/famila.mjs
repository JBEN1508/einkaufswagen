// famila Nordost: Der Markt Neu Wulmstorf verlinkt seinen Wochen-Handzettel
// (z. B. /handzettel/famila_kw47_DJWWW/). Dessen Suchindex
// files/search/book_config.js enthält den Text aller Prospektseiten.
//
// Der Prospekttext ist nicht sauber strukturiert (Preise stehen z. B. als "2." und
// "99" in getrennten Zeilen, die Reihenfolge folgt dem Layout). Deshalb übernimmt
// die App nur Angebote, die sich selbst bestätigen: Streichpreis + "spar NN%" +
// Angebotspreis müssen rechnerisch zusammenpassen. Das sind nicht alle Angebote,
// aber die übernommenen sind verlässlich.

const BASE = "https://www.famila-nordost.de";

const NOISE = new RegExp([
  "€", "\\(1 ", "=", "\\d+\\s*%", "packung", "beutel", "flasche", "glas\\b", "dose", "becher", "schale", "kiste",
  "\\bje\\b", "-g-", "-ml-", "\\bkg\\b", "liter", "stück", "solange", "vorrat", "verschiedene", "sorten",
  "kl\\. i", "günstigster", "preis", "spar", "uvp", "angebot", "mit app", "\\bapp\\b", "pfand", "^aus ", "tierwohl",
  "haltungsform", "gültig", "^bio$", "^\\d", "handzettel", "\\*", "teilnahme", "gewinn", "telefon", "macht den",
  "!", ":$", "\\.$", "^(deutschland|spanien|italien|frankreich|griechenland|niederlande|österreich|polen|marokko|türkei|chile|peru|südafrika|neuseeland|costa rica)\\b",
].join("|"), "i");

function isNameLine(l) {
  if (!l || l.length < 2 || l.length > 45) return false;
  if (NOISE.test(l)) return false;
  // Überschriften in GROSSBUCHSTABEN mit mehreren Wörtern überspringen
  const letters = l.replace(/[^A-Za-zÄÖÜäöüß]/g, "");
  if (letters.length > 3 && letters === letters.toUpperCase() && !/^[A-ZÄÖÜ&\- ]{1,6}$/.test(l)) return false;
  if (/^(MEHR|NEU|TOP|SUPER|BESTE)$/i.test(l)) return false;
  return /[A-Za-zÄÖÜäöü]/.test(l);
}

function nameFromSegment(lines) {
  const out = [];
  for (const raw of lines) {
    const l = raw.trim();
    if (!isNameLine(l)) { if (out.length) break; continue; }
    if (out.length >= 2 && /^[a-zäöü]/.test(l)) break;
    if (!out.length && /^(oder|und|eine?|mit|für|von|zum|zur)\b/i.test(l)) continue;
    out.push(l);
    if (out.length === 3) break;
  }
  const name = out.join(" ")
    .replace(/([a-zäöüß])oder\b/g, "$1 oder") // "Classicoder" -> "Classic oder"
    .replace(/\s+/g, " ").replace(/[\s,]+(oder|und)?$/i, "").trim();
  return name.length >= 3 ? name.slice(0, 70) : null;
}

/** Gültigkeit aus dem Prospekttext: "Gültig ab Mo., 16.11. bis Sa., 21.11.26" */
export function parseValidity(text, fallbackYear) {
  const m = text.match(/Gültig ab \S+\s*(\d{1,2})\.(\d{1,2})\.\s*bis \S+\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4})?/i);
  if (!m) return null;
  let year = m[5] ? Number(m[5]) : fallbackYear;
  if (year < 100) year += 2000;
  const fromYear = Number(m[2]) > Number(m[4]) ? year - 1 : year; // Jahreswechsel
  const iso = (y, mo, d) => `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}T12:00:00Z`;
  return { from: iso(fromYear, m[2], m[1]), to: iso(year, m[4], m[3]) };
}

/** Liest bestätigte Angebote aus dem Inhalt von book_config.js */
export function parseFamilaBookConfig(js, { now = new Date() } = {}) {
  const start = js.indexOf("[");
  const end = js.lastIndexOf("]");
  if (start < 0 || end < 0) throw new Error("famila: Prospekttext nicht gefunden");
  const pages = JSON.parse(js.slice(start, end + 1));
  const validity = parseValidity(pages.join("\n"), now.getFullYear());

  const offers = new Map();
  for (const page of pages) {
    const lines = String(page).replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
    let segStart = 0;
    for (let i = 0; i < lines.length - 2; i++) {
      // "3.99* spar 25%" bzw. "1.89/1.99* spar 47/50%"
      const old = lines[i].match(/^(\d+\.\d{2})(?:\/\d+\.\d{2})?\*\s*spar\s*(\d+)(?:\/\d+)?\s*%$/i);
      if (!old) continue;
      const euros = lines[i + 1].match(/^(\d+)\.$/);
      const cents = lines[i + 2].match(/^(\d{2})\b/);
      if (!euros || !cents) { continue; }
      const oldPrice = Number(old[1]);
      const pct = Number(old[2]);
      const price = Number(`${euros[1]}.${cents[1]}`);
      // Selbstprüfung: passt der Rabatt zu den beiden Preisen? (Rundung erlaubt)
      const expected = oldPrice * (1 - pct / 100);
      const ok = price < oldPrice && Math.abs(expected - price) <= Math.max(0.03, oldPrice * 0.01);
      const name = nameFromSegment(lines.slice(segStart, i));
      segStart = i + 3;
      if (!ok || !name) continue;
      const key = name.toLowerCase();
      if (!offers.has(key) || offers.get(key).price > price) {
        offers.set(key, {
          mgId: `famila-${key}`,
          store: "famila",
          name, brand: "", description: "", categoryText: "",
          price, oldPrice, referencePrice: null, unit: "",
          from: validity?.from || null, to: validity?.to || null,
        });
      }
    }
  }
  return { offers: [...offers.values()], pages: pages.length, validity };
}

/** Findet die aktuellen Handzettel eines famila-Markts (z. B. "neu-wulmstorf"). */
export function findLeaflets(marketHtml) {
  return [...new Set([...marketHtml.matchAll(/\/handzettel\/([A-Za-z0-9_\-]+)\//g)].map((m) => m[1]))];
}

export async function fetchFamila(market = "neu-wulmstorf", headers = {}) {
  const res = await fetch(`${BASE}/markt/${market}/`, { headers: { ...headers, Accept: "text/html" } });
  if (!res.ok) throw new Error(`famila: Marktseite HTTP ${res.status}`);
  const slugs = findLeaflets(await res.text());
  if (!slugs.length) throw new Error("famila: kein Handzettel auf der Marktseite gefunden");
  const all = [];
  for (const slug of slugs) {
    const r = await fetch(`${BASE}/handzettel/${slug}/files/search/book_config.js`, { headers });
    if (!r.ok) continue;
    const { offers } = parseFamilaBookConfig(await r.text());
    all.push(...offers);
  }
  return { offers: all, leaflets: slugs };
}
