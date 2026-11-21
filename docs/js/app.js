// Einkaufswagen – Web-App (GitHub-Pages-Version)
//
// Die Angebote lädt GitHub jeden Montag automatisch (scripts/update.mjs) und legt
// sie in data/products.json ab. Diese Seite liest nur diese Datei.
// Konten, „Meine Produkte“, Einkaufsliste und Essensplan werden auf dem Gerät gespeichert (localStorage).
import { STORES, storeById } from "./marktguru.js";
import { CATEGORIES } from "./categories.js";
import { currentWeekIndex, formatWeek, isoWeekOfIndex, mondayOfIndex } from "./predict.js";
import { describe } from "./data.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => (n == null ? "—" : n.toLocaleString("de-DE", { style: "currency", currency: "EUR" }));
const pctFmt = (p) => (p == null ? "" : `−${Math.round(p)} %`);
const dayFmt = (iso) => (iso ? new Date(iso).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" }) : "");
const dateTimeFmt = (iso) => new Date(iso).toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- lokaler Speicher (nur dieses Gerät)
const local = {
  get(key, fallback) { try { const v = localStorage.getItem("ew_" + key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem("ew_" + key, JSON.stringify(value)); } catch { /* egal */ } },
};

// ---------------------------------------------------------------- Konten (jedes Konto: eigene Produkte, Liste, Essensplan)
const accounts = {
  list: local.get("accounts", null),
  current: local.get("currentAccount", null),
};
(function initAccounts() {
  if (!Array.isArray(accounts.list) || !accounts.list.length) {
    // erstes Konto anlegen und bisherige Daten übernehmen
    accounts.list = [{ id: "a1", name: "Mein Konto" }];
    for (const k of ["favorites", "categories", "shopping", "meals"]) {
      const v = local.get(k, undefined);
      if (v !== undefined) local.set(`a1_${k}`, v);
    }
    local.set("accounts", accounts.list);
  }
  if (!accounts.list.some((a) => a.id === accounts.current)) accounts.current = accounts.list[0].id;
  local.set("currentAccount", accounts.current);
})();
const acc = {
  get: (key, fallback) => local.get(`${accounts.current}_${key}`, fallback),
  set: (key, value) => local.set(`${accounts.current}_${key}`, value),
};
const currentAccount = () => accounts.list.find((a) => a.id === accounts.current) || accounts.list[0];

// ---------------------------------------------------------------- Zustand
const state = {
  products: new Map(),
  meta: {},
  view: "all",
  offerTab: "week",
  store: "all",
  category: "",
  sort: "name",
  search: "",
  limit: 150,
  favorites: new Set(acc.get("favorites", [])),
  categoryOverrides: acc.get("categories", {}),
  token: local.get("token", ""),
  busy: false,
};

function repo() {
  if (state.meta.repo) return state.meta.repo;
  // Fallback: aus der Adresse ableiten (https://NAME.github.io/REPO/)
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  const r = location.pathname.split("/").filter(Boolean)[0];
  return m && r ? `${m[1]}/${r}` : null;
}

// ---------------------------------------------------------------- Daten laden
async function loadData() {
  const bust = `?t=${Date.now()}`;
  const [data, meta] = await Promise.all([
    fetch(`data/products.json${bust}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : { products: [] })).catch(() => ({ products: [] })),
    fetch(`data/meta.json${bust}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
  ]);
  state.meta = meta || {};
  state.products = new Map((data.products || []).map((p) => {
    p.origCategory = p.category;
    p.favorite = state.favorites.has(p.id);
    if (state.categoryOverrides[p.id]) p.category = state.categoryOverrides[p.id];
    return [p.id, p];
  }));
}

async function init() {
  buildStaticUI();
  await loadData();
  render();
}

// ---------------------------------------------------------------- Aktualisieren
async function refresh() {
  if (state.busy) return;
  state.busy = true;
  $("btn-refresh").classList.add("loading");
  try {
    if (!state.token || !repo()) {
      // ohne Token: nur den neuesten Stand vom Server holen
      const before = state.meta.lastUpdate;
      await loadData();
      render();
      toast(state.meta.lastUpdate && state.meta.lastUpdate !== before
        ? "Neue Angebote geladen"
        : "Du hast schon den neuesten Stand. Die Angebote werden jeden Montag automatisch geladen. Für einen Sofort-Abruf unter ⚙ → Einstellungen den Token eintragen.", false, 8000);
      return;
    }
    await runWorkflow();
  } catch (e) {
    toast(e.message, true, 10000);
  } finally {
    state.busy = false;
    $("btn-refresh").classList.remove("loading");
    $("progress").hidden = true;
  }
}

async function gh(path, opts = {}) {
  const res = await fetch(`https://api.github.com/repos/${repo()}${path}`, {
    ...opts,
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${state.token}`, "X-GitHub-Api-Version": "2022-11-28", ...(opts.headers || {}) },
  });
  if (res.status === 401) throw new Error("Der GitHub-Token ist ungültig oder abgelaufen. Bitte unter ⚙ → Einstellungen einen neuen eintragen.");
  if (res.status === 403 || res.status === 404) throw new Error("Der GitHub-Token hat keine Berechtigung. Er braucht für dieses Repository „Actions: Read and write“.");
  if (!res.ok) throw new Error(`GitHub meldet Fehler ${res.status}`);
  return res.status === 204 ? null : res.json();
}

async function runWorkflow() {
  $("progress").hidden = false;
  $("progress-title").textContent = "Angebote werden geladen …";
  setProgress(0.03, "Starte den Abruf bei GitHub …");
  const started = Date.now();
  await gh("/actions/workflows/update.yml/dispatches", { method: "POST", body: JSON.stringify({ ref: "main" }) });

  // auf den neuen Lauf warten
  let run = null;
  for (let i = 0; i < 300; i++) {
    await sleep(i < 5 ? 3000 : 5000);
    const sec = Math.round((Date.now() - started) / 1000);
    const runs = await gh("/actions/runs?event=workflow_dispatch&per_page=1");
    const r = runs.workflow_runs?.[0];
    if (r && new Date(r.created_at).getTime() >= started - 60000) run = r;
    // typische Dauer: 1–3 Minuten
    const frac = Math.min(0.95, 0.05 + sec / 180);
    setProgress(frac, run
      ? `GitHub lädt die Angebote von EDEKA, ALDI, Lidl, REWE und famila …<br>${sec} Sekunden (dauert meist 1–3 Minuten)`
      : `Warte auf GitHub … ${sec} s`);
    if (run && run.status === "completed") break;
    if ($("progress").hidden) return; // Nutzer hat "im Hintergrund" gewählt
  }
  if (!run || run.status !== "completed") throw new Error("Der Abruf dauert ungewöhnlich lange. Schau später noch einmal rein.");

  setProgress(1, "Fertig – lade die neuen Daten …");
  await sleep(2000);
  await loadData();
  render();
  if (state.meta.lastError) toast(`Abruf mit Problem: ${state.meta.lastError}`, true, 12000);
  else toast(`${state.meta.lastOfferCount ?? "?"} Angebote geladen · ${state.products.size} Produkte in der Datenbank`);
}

function setProgress(frac, html) {
  $("progress-bar").style.width = `${Math.round(frac * 100)}%`;
  $("progress-text").innerHTML = html;
}

// ---------------------------------------------------------------- Statische UI
function buildStaticUI() {
  $("filter-category").innerHTML = `<option value="">Alle Kategorien</option>` + CATEGORIES.map((c) => `<option>${esc(c)}</option>`).join("");

  $("btn-refresh").addEventListener("click", refresh);
  $("btn-cancel").addEventListener("click", () => { $("progress").hidden = true; toast("Der Abruf läuft bei GitHub weiter. Später einfach nochmal auf „Aktualisieren“ tippen."); });
  $("search").addEventListener("input", (e) => { state.search = e.target.value; state.limit = 150; render(); });
  $("filter-category").addEventListener("change", (e) => { state.category = e.target.value; render(); });
  $("sort").addEventListener("change", (e) => { state.sort = e.target.value; render(); });
  $("btn-more").addEventListener("click", () => { state.limit += 150; render(); });

  $("bottom-nav").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-view]");
    if (!b) return;
    state.view = b.dataset.view;
    state.limit = 150;
    window.scrollTo({ top: 0 });
    render();
  });
  // Zahnrad-Menü oben rechts (Konto wechseln, Einstellungen)
  $("btn-menu").addEventListener("click", (e) => { e.stopPropagation(); $("menu").hidden = !$("menu").hidden; });
  document.addEventListener("click", (e) => { if (!e.target.closest(".menu-wrap")) $("menu").hidden = true; });
  $("menu").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-view]");
    if (!b) return;
    $("menu").hidden = true;
    state.view = b.dataset.view;
    state.limit = 150;
    window.scrollTo({ top: 0 });
    render();
  });
  $("store-chips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-store]");
    if (b) { state.store = b.dataset.store; render(); }
  });
  $("list").addEventListener("click", (e) => {
    const star = e.target.closest(".star");
    const card = e.target.closest(".card");
    if (star && card) { e.stopPropagation(); toggleFav(card.dataset.id); return; }
    if (e.target.closest("[data-action=refresh]")) return refresh();
    if (card) openDetail(card.dataset.id);
  });
  $("detail").addEventListener("click", (e) => {
    if (e.target === $("detail") || e.target.closest("[data-close]")) $("detail").hidden = true;
  });

  buildZettelUI();
  buildAccountUI();
  $("offer-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (!b) return;
    state.offerTab = b.dataset.tab;
    state.limit = 150;
    window.scrollTo({ top: 0 });
    render();
  });
  $("set-token").value = state.token;
  $("btn-token-save").addEventListener("click", () => {
    state.token = $("set-token").value.trim();
    local.set("token", state.token);
    toast(state.token ? "Token gespeichert – der Knopf „Aktualisieren“ startet jetzt einen echten Abruf." : "Token entfernt");
  });
}

// ---------------------------------------------------------------- Rendering
const entryAt = (p, w) => p.history.find((h) => h.week === w) || null;

/**
 * Teilt ein Produkt für eine bestimmte Woche W ein:
 *  "angekündigt" – Prospekt für W ist da, und es ist ein NEUES Angebot
 *                  (nicht nur eine Aktion, die aus der Vorwoche weiterläuft)
 *  "voraussichtlich" – Vorhersage trifft genau W
 *  "möglich" – W liegt im wahrscheinlichen Zeitraum der Vorhersage
 */
function classifyForWeek(p, d, W) {
  const pr = d.pred;
  if (entryAt(p, W)) return entryAt(p, W - 1) ? null : "angekündigt";
  // läuft gerade (oder ist schon angekündigt) -> keine Vorhersage für die Wochen direkt danach
  for (let w = currentWeekIndex(); w < W; w++) if (entryAt(p, w)) return null;
  if (pr.nextIdx == null || pr.status === "overdue") return null;
  if (pr.nextIdx === W) return "voraussichtlich";
  if (pr.rangeLo <= W && W <= pr.rangeHi) return "möglich";
  return null;
}

/** Für "Meine Produkte": ist das Produkt diese oder nächste Woche im Angebot? */
function favStatus(p, d, nowIdx) {
  if (d.current) return { rank: 0, cls: "hl-now", text: `🔥 Diese Woche im Angebot${d.current.to ? ` – bis ${dayFmt(d.current.to)}` : ""}` };
  const next = classifyForWeek(p, d, nowIdx + 1);
  if (next === "angekündigt") return { rank: 1, cls: "hl-next", text: "⏭ Nächste Woche im Angebot" };
  if (next === "voraussichtlich") return { rank: 2, cls: "hl-next", text: "⏭ Nächste Woche voraussichtlich im Angebot" };
  return { rank: 9, cls: "", text: "" };
}

function render() {
  const nowIdx = currentWeekIndex();
  const isSettings = state.view === "settings";
  const isZettel = state.view === "zettel";
  const isOffers = state.view === "offers";
  for (const b of $("bottom-nav").querySelectorAll("button")) b.classList.toggle("active", b.dataset.view === state.view);
  for (const b of $("menu").querySelectorAll("button[data-view]")) b.classList.toggle("active", b.dataset.view === state.view);
  $("btn-menu").classList.toggle("active", isSettings);
  for (const id of ["list", "list-info", "toolbar", "store-chips"]) $(id).hidden = isSettings || isZettel;
  $("settings").hidden = !isSettings;
  $("zettel").hidden = !isZettel;
  $("offer-tabs").hidden = !isOffers;
  for (const b of $("offer-tabs").querySelectorAll("button")) b.classList.toggle("active", b.dataset.tab === state.offerTab);
  renderAccountUI();

  const { week, year } = isoWeekOfIndex(nowIdx);
  $("subtitle").textContent = state.meta.lastUpdate
    ? `👤 ${currentAccount().name} · KW ${week}/${year} · Stand ${dateTimeFmt(state.meta.lastUpdate)}`
    : `👤 ${currentAccount().name} · KW ${week}/${year} · noch keine Angebote geladen`;

  if (isSettings) { renderSettings(); $("btn-more").hidden = true; return; }
  if (isZettel) { renderZettel(); $("btn-more").hidden = true; return; }

  const enabled = state.meta.stores || STORES.map((s) => s.id);
  const withInfo = [...state.products.values()].filter((p) => enabled.includes(p.store)).map((p) => ({ p, d: describe(p, nowIdx) }));
  const W = isOffers ? nowIdx + ({ week: 0, next: 1, next2: 2 }[state.offerTab] ?? 0) : nowIdx;
  let base;
  if (isOffers && state.offerTab === "week") {
    base = withInfo.filter(({ d }) => d.current).map((x) => ({ ...x, week: nowIdx }));
  } else if (isOffers) {
    base = [];
    for (const x of withInfo) {
      const g = classifyForWeek(x.p, x.d, W);
      if (g) base.push({ ...x, group: { voraussichtlich: 1, möglich: 2, angekündigt: 3 }[g], week: W });
    }
  } else if (state.view === "fav") {
    base = withInfo.filter(({ p }) => p.favorite).map((x) => ({ ...x, fav: favStatus(x.p, x.d, nowIdx) }));
  } else base = withInfo;

  renderChips(base, enabled);

  const q = state.search.trim().toLowerCase();
  const items = base.filter(({ p }) =>
    (state.store === "all" || p.store === state.store) &&
    (!state.category || p.category === state.category) &&
    (!q || p.name.toLowerCase().includes(q) || (p.brand || "").toLowerCase().includes(q)));

  const coll = new Intl.Collator("de-DE", { sensitivity: "base", numeric: true });
  const shownEntry = (x) => (x.week != null ? entryAt(x.p, x.week) : null) || x.d.current || x.d.upcoming || x.d.latest;
  const sorters = {
    name: (a, b) => coll.compare(a.p.name, b.p.name),
    category: (a, b) => coll.compare(a.p.category, b.p.category) || coll.compare(a.p.name, b.p.name),
    discount: (a, b) => (shownEntry(b)?.savedPercent ?? -1) - (shownEntry(a)?.savedPercent ?? -1),
    next: (a, b) => (a.d.pred.nextIdx ?? 1e9) - (b.d.pred.nextIdx ?? 1e9) || coll.compare(a.p.name, b.p.name),
  };
  items.sort(sorters[state.sort] || sorters.name);
  if (isOffers && state.offerTab !== "week") items.sort((a, b) => a.group - b.group); // Abschnitte zusammenhalten
  if (state.view === "fav") items.sort((a, b) => a.fav.rank - b.fav.rank);         // Angebote nach oben

  const viewNames = {
    all: "Alle bekannten Produkte",
    fav: "Meine Produkte",
    offers: { week: "Diese Woche im Angebot", next: "Nächste Woche", next2: "Übernächste Woche" }[state.offerTab] + ` · ${formatWeek(W)}`,
  };
  $("list-info").textContent = `${viewNames[state.view]} · ${items.length} Produkt${items.length === 1 ? "" : "e"}`;

  if (!state.products.size) {
    $("list").innerHTML = `<div class="empty"><h2>Noch keine Angebote in der Datenbank</h2>
      <p>GitHub lädt die Angebote jeden Montag automatisch.</p>
      <button class="btn" data-action="refresh" type="button">Neu laden</button></div>`;
    $("btn-more").hidden = true;
    return;
  }
  if (!items.length) {
    const noPred = "Eine Vorhersage braucht mindestens zwei bisherige Angebotswochen eines Produkts. Die Datenbank wächst jeden Montag – nach ein paar Wochen füllt sich diese Liste.";
    const msg = state.view === "fav"
      ? "Noch keine Produkte markiert. Tippe unter „Alle Produkte“ oder bei den Angeboten auf ☆ bei allem, was du gut findest oder sonst immer kaufst. Sobald eins davon im Angebot ist, steht es hier ganz oben."
      : isOffers && state.offerTab !== "week" ? `Für diese Woche gibt es noch keine Angebote oder Vorhersagen. ${noPred}`
      : "Keine Treffer.";
    $("list").innerHTML = `<div class="empty"><p>${msg}</p></div>`;
    $("btn-more").hidden = true;
    return;
  }

  const shown = items.slice(0, state.limit);
  let html = "";
  if (isOffers && state.offerTab !== "week") {
    const titles = {
      1: "Voraussichtlich im Angebot (Vorhersage)",
      2: "Möglich (Vorhersage ± 1 Woche)",
      3: "Neu im Prospekt (schon angekündigt)",
    };
    for (const g of [1, 2, 3]) {
      const part = shown.filter((x) => x.group === g);
      const total = items.filter((x) => x.group === g).length;
      if (part.length) html += `<div class="section-title">${titles[g]} · ${total}</div>` + part.map(cardHTML).join("");
    }
  } else if (state.view === "fav") {
    const onOffer = shown.filter((x) => x.fav.rank < 9);
    const rest = shown.filter((x) => x.fav.rank === 9);
    if (onOffer.length) html += `<div class="section-title">Im Angebot · ${onOffer.length}</div>` + onOffer.map(cardHTML).join("");
    if (rest.length) html += `<div class="section-title">Gerade nicht im Angebot · ${rest.length}</div>` + rest.map(cardHTML).join("");
  } else html = shown.map(cardHTML).join("");
  $("list").innerHTML = html;
  $("btn-more").hidden = items.length <= state.limit;
}

function renderChips(base, enabled) {
  const counts = { all: 0 };
  for (const { p } of base) {
    if (state.category && p.category !== state.category) continue;
    counts.all++; counts[p.store] = (counts[p.store] || 0) + 1;
  }
  const chips = [{ id: "all", label: "Alle", color: "#888" }, ...STORES.filter((s) => enabled.includes(s.id))];
  $("store-chips").innerHTML = chips.map((s) =>
    `<button type="button" class="chip ${state.store === s.id ? "active" : ""}" data-store="${s.id}" style="--c:${s.color}">` +
    `${s.id !== "all" ? '<span class="dot"></span>' : ""}${esc(s.label)}<span class="n">${counts[s.id] || 0}</span></button>`).join("");
}

function predLine(pred) {
  if (pred.nextIdx == null) return pred.occurrences === 1 ? `<span>Erst 1× gesehen – Vorhersage ab dem 2. Angebot</span>` : "";
  const when = pred.status === "overdue"
    ? `<span class="overdue">Überfällig – erwartet war ${formatWeek(pred.nextIdx, false)}</span>`
    : `<span>Nächstes Mal: <b>${formatWeek(pred.nextIdx)}</b></span>`;
  const inWeeks = pred.status !== "overdue" && pred.weeksUntil > 0 ? `<span>· in ${pred.weeksUntil} Wo.</span>` : "";
  return `${when}${inWeeks}<span>· alle ~${pred.interval} Wo.</span><span class="conf ${pred.confidence}">${pred.confidence}</span>`;
}

const CAT_ICON = {
  "Obst&Gemüse": "🥦", "Molkerei&Käse": "🧀", "Grundnahrung": "🍝", "Tiefkühl": "🧊", "Fisch&Meeresfrüchte": "🐟",
  "Fleisch&Wurst": "🥩", "Getränke": "🥤", "Knabbern & Naschen": "🍫", "Drogerie": "🧴", "Haushalt": "🧽", "Sonstiges": "🛍",
};
function thumbHTML(p) {
  const icon = CAT_ICON[p.category] || "🛍";
  if (!p.image) return `<div class="thumb ph" aria-hidden="true">${icon}</div>`;
  // Falls das Bild nicht lädt: Symbol der Kategorie anzeigen
  return `<img class="thumb" src="${esc(p.image)}" alt="" loading="lazy" decoding="async"
    onerror="this.outerHTML='<div class=&quot;thumb ph&quot;>${icon}</div>'" />`;
}

function cardHTML({ p, d, week, fav, group }) {
  const s = storeById[p.store];
  const nowIdx = currentWeekIndex();
  const atWeek = week != null ? entryAt(p, week) : null;
  const e = atWeek || d.current || d.upcoming || d.latest;
  let tag = "";
  if (atWeek && week === nowIdx) tag = `<span class="tag now">jetzt</span>`;
  else if (atWeek) tag = `<span class="tag next">${formatWeek(week, false)}</span>`;
  else if (group === 1 || group === 2) tag = `<span class="tag pred">Vorhersage</span>`;
  else if (d.current) tag = `<span class="tag now">jetzt</span>`;
  else if (d.upcoming) tag = `<span class="tag next">ab ${formatWeek(d.upcoming.week, false)}</span>`;
  let validTxt = "";
  if (e?.to && (atWeek || e === d.current)) validTxt = `${e.from ? `${dayFmt(e.from)} – ` : ""}${dayFmt(e.to)}`;
  else if (e && !atWeek) validTxt = `zuletzt im Angebot: ${formatWeek(e.week, false)}`;
  const banner = fav?.text ? `<div class="fav-banner">${esc(fav.text)}</div>` : "";
  return `<div class="card ${fav?.cls || ""}" data-id="${esc(p.id)}">
    ${banner}
    <div class="card-top"><span class="store-badge" style="--c:${s.color}">${esc(s.label)}</span><span class="cat">${esc(p.category)}</span>${tag}
      <button class="star ${p.favorite ? "on" : ""}" type="button" aria-label="Zu Meine Produkte">${p.favorite ? "★" : "☆"}</button></div>
    <div class="card-body">
      ${thumbHTML(p)}
      <div class="card-main">
        <div class="name">${esc(p.name)}</div>
        <div class="price-row">
          <span class="price">${money(e?.price)}</span>
          ${e?.oldPrice ? `<span class="old">${money(e.oldPrice)}</span>` : ""}
          ${e?.savedPercent ? `<span class="pct">${pctFmt(e.savedPercent)}</span>` : ""}
        </div>
        <div class="valid">${esc(validTxt)}</div>
      </div>
    </div>
    <div class="pred">${predLine(d.pred)}</div>
  </div>`;
}

function renderSettings() {
  const per = {};
  let entries = 0;
  for (const p of state.products.values()) { per[p.store] = (per[p.store] || 0) + 1; entries += p.history.length; }
  $("stats").innerHTML = `${state.products.size} Produkte · ${entries} gespeicherte Angebotswochen<br>` +
    STORES.map((s) => `${esc(s.label)}: ${per[s.id] || 0}`).join(" · ") +
    (state.meta.lastRun ? `<br>Letzter Abruf: ${dateTimeFmt(state.meta.lastRun)}` : "");
  $("run-log").textContent = (state.meta.log || []).join("\n");
  const r = repo();
  const gh = r ? `https://github.com/${r}` : "https://github.com";
  $("link-actions").href = `${gh}/actions`;
  $("link-upload").href = r ? `${gh}/upload/main/import` : gh;
  $("link-config").href = r ? `${gh}/edit/main/config.json` : gh;
  $("link-token").href = "https://github.com/settings/personal-access-tokens/new";
}

// ---------------------------------------------------------------- Details
function openDetail(id) {
  const p = state.products.get(id);
  if (!p) return;
  const nowIdx = currentWeekIndex();
  const d = describe(p, nowIdx);
  const s = storeById[p.store];
  const pr = d.pred;

  let predHTML;
  if (pr.nextIdx == null) {
    predHTML = `Bisher ${pr.occurrences === 1 ? "erst ein Angebot" : "keine Angebote"} bekannt. Ab dem zweiten Angebot berechnet die App den Rhythmus.`;
  } else {
    const range = pr.rangeLo !== pr.rangeHi ? `<br>Wahrscheinlicher Zeitraum: ${formatWeek(pr.rangeLo, false)} bis ${formatWeek(pr.rangeHi, false)}` : "";
    predHTML = `<div class="big">${pr.status === "overdue" ? "Überfällig · " : ""}${formatWeek(pr.nextIdx)}</div>
      Rhythmus: etwa alle <b>${pr.interval} Wochen</b> (aus ${pr.occurrences} Aktionen, Abstände: ${pr.intervals.join(", ")} Wo.)${range}
      <br>Sicherheit: <span class="conf ${pr.confidence}">${pr.confidence}</span>`;
  }
  const rows = [...p.history].reverse().map((h) => `<tr class="${h.week === nowIdx ? "now" : ""}">
      <td>${formatWeek(h.week, false)}<br><small>${isoWeekOfIndex(h.week).year}</small></td>
      <td>${money(h.price)}</td><td>${h.oldPrice ? money(h.oldPrice) : "—"}</td>
      <td>${h.savedPercent ? pctFmt(h.savedPercent) : "—"}</td>
      <td><small>${h.from ? `${dayFmt(h.from)}–${dayFmt(h.to)}` : esc(h.source || "")}</small></td></tr>`).join("");

  $("detail-body").innerHTML = `
    <h2>${esc(p.name)}</h2>
    ${p.imageLarge || p.image ? `<img class="detail-img" src="${esc(p.imageLarge || p.image)}" alt="" onerror="this.remove()" />` : ""}
    <div class="meta"><span class="store-badge" style="--c:${s.color}">${esc(s.label)}</span>
      ${d.bestPrice != null ? `<span class="hint">Bester bekannter Preis: <b>${money(d.bestPrice)}</b></span>` : ""}</div>
    <div class="pred-box">${predHTML}</div>
    <table class="hist"><thead><tr><th>Woche</th><th>Preis</th><th>statt</th><th>Rabatt</th><th>Gültig</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="detail-actions">
      <label class="field"><span>Kategorie</span><select id="detail-cat">${CATEGORIES.map((c) => `<option ${c === p.category ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
    </div>
    <div class="detail-actions">
      <button id="detail-fav" class="btn btn-secondary" type="button">${p.favorite ? "★ Aus „Meine Produkte“ entfernen" : "☆ Zu „Meine Produkte“ hinzufügen"}</button>
    </div>`;
  $("detail-cat").addEventListener("change", (e) => {
    p.category = e.target.value;
    state.categoryOverrides[p.id] = p.category;
    acc.set("categories", state.categoryOverrides);
    render();
  });
  $("detail-fav").addEventListener("click", () => { toggleFav(p.id); openDetail(p.id); });
  $("detail").hidden = false;
}

function toggleFav(id) {
  const p = state.products.get(id);
  if (!p) return;
  p.favorite = !p.favorite;
  if (p.favorite) state.favorites.add(id); else state.favorites.delete(id);
  acc.set("favorites", [...state.favorites]);
  render();
}

// ---------------------------------------------------------------- Einkaufszettel
const zettel = {
  tab: "liste",
  items: acc.get("shopping", []),            // [{ id, text }]
  meals: acc.get("meals", {}),               // { "2026-W48": { "0": "Spaghetti", … } }
  weekIdx: currentWeekIndex(),
};
const saveItems = () => acc.set("shopping", zettel.items);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function addShoppingItem(text) {
  text = String(text || "").trim();
  if (!text) return;
  zettel.items.push({ id: uid(), text });
  saveItems();
}

function weekKey(idx) {
  const { year, week } = isoWeekOfIndex(idx);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function renderZettel() {
  for (const b of $("zettel-tabs").querySelectorAll("button")) b.classList.toggle("active", b.dataset.tab === zettel.tab);
  $("tab-liste").hidden = zettel.tab !== "liste";
  $("tab-essen").hidden = zettel.tab !== "essen";
  if (zettel.tab === "liste") renderListe(); else renderEssen();
}

function renderListe() {
  zettel.items = zettel.items.filter((i) => !i.done); // alte, abgehakte Einträge aufräumen
  $("liste").innerHTML = zettel.items.map((i) => `<li data-id="${esc(i.id)}">
      <input type="checkbox" aria-label="${esc(i.text)} abhaken" />
      <div class="txt"><span>${esc(i.text)}</span></div></li>`).join("") ||
    `<li class="empty-li"><div class="txt"><small>Die Liste ist leer. Oben einen Artikel eintragen.</small></div></li>`;
  $("liste-info").textContent = zettel.items.length ? `${zettel.items.length} Artikel` : "";
}

const DAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
function renderEssen() {
  const idx = zettel.weekIdx;
  const monday = mondayOfIndex(idx);
  const sunday = new Date(monday.getTime() + 6 * 86400000);
  const f = (d) => `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.`;
  const nowIdx = currentWeekIndex();
  const rel = idx === nowIdx ? "diese Woche" : idx === nowIdx + 1 ? "nächste Woche" : idx === nowIdx - 1 ? "letzte Woche" : "";
  $("essen-week").innerHTML = `KW ${isoWeekOfIndex(idx).week} · ${f(monday)}–${f(sunday)}${rel ? `<br><small class="hint">${rel}</small>` : ""}`;
  $("essen-today").hidden = idx === nowIdx;
  const plan = zettel.meals[weekKey(idx)] || {};
  const todayStr = new Date().toDateString();
  $("essen-days").innerHTML = DAYS.map((name, i) => {
    const day = new Date(monday.getTime() + i * 86400000);
    const isToday = new Date(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()).toDateString() === todayStr;
    return `<div class="day ${isToday ? "today" : ""}">
      <label for="meal-${i}"><span>${name}${isToday ? " · heute" : ""}</span><span>${f(day)}</span></label>
      <textarea id="meal-${i}" data-day="${i}" rows="1" placeholder="Was gibt es?">${esc(plan[i] || "")}</textarea></div>`;
  }).join("");
}

function buildZettelUI() {
  $("zettel-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) { zettel.tab = b.dataset.tab; renderZettel(); }
  });
  $("liste-form").addEventListener("submit", (e) => {
    e.preventDefault();
    addShoppingItem($("liste-input").value);
    $("liste-input").value = "";
    $("liste-input").focus();
    renderListe();
  });
  // Abhaken -> Artikel verschwindet (mit "Rückgängig" im Hinweis)
  $("liste").addEventListener("change", (e) => {
    const li = e.target.closest("li[data-id]");
    const idx = li ? zettel.items.findIndex((i) => i.id === li.dataset.id) : -1;
    if (idx < 0) return;
    const [removed] = zettel.items.splice(idx, 1);
    saveItems();
    li.classList.add("leaving");
    setTimeout(renderListe, 250);
    toast(`„${removed.text}“ abgehakt`, false, 4000, "Rückgängig", () => {
      zettel.items.splice(Math.min(idx, zettel.items.length), 0, removed);
      saveItems(); renderListe();
    });
  });
  $("essen-prev").addEventListener("click", () => { zettel.weekIdx--; renderEssen(); });
  $("essen-next").addEventListener("click", () => { zettel.weekIdx++; renderEssen(); });
  $("essen-today").addEventListener("click", () => { zettel.weekIdx = currentWeekIndex(); renderEssen(); });
  $("essen-days").addEventListener("input", (e) => {
    const t = e.target.closest("textarea[data-day]");
    if (!t) return;
    const key = weekKey(zettel.weekIdx);
    const plan = zettel.meals[key] || (zettel.meals[key] = {});
    if (t.value.trim()) plan[t.dataset.day] = t.value; else delete plan[t.dataset.day];
    if (!Object.keys(plan).length) delete zettel.meals[key];
    acc.set("meals", zettel.meals);
  });
}

// ---------------------------------------------------------------- Konten: Oberfläche
function switchAccount(id) {
  if (!accounts.list.some((a) => a.id === id)) return;
  accounts.current = id;
  local.set("currentAccount", id);
  state.favorites = new Set(acc.get("favorites", []));
  state.categoryOverrides = acc.get("categories", {});
  zettel.items = acc.get("shopping", []);
  zettel.meals = acc.get("meals", {});
  for (const p of state.products.values()) {
    p.favorite = state.favorites.has(p.id);
    p.category = state.categoryOverrides[p.id] || p.origCategory;
  }
  render();
  toast(`Konto „${currentAccount().name}“ ist jetzt aktiv`);
}

function renderAccountUI() {
  $("menu-accounts").innerHTML = accounts.list.map((a) =>
    `<button type="button" data-account="${esc(a.id)}">👤 ${esc(a.name)}${a.id === accounts.current ? '<span class="check">✓</span>' : ""}</button>`).join("");
  $("account-list").innerHTML = accounts.list.map((a) => `<li class="${a.id === accounts.current ? "active" : ""}" data-id="${esc(a.id)}">
      <span class="acc-name">👤 ${esc(a.name)}${a.id === accounts.current ? "<small>aktiv</small>" : ""}</span>
      ${a.id !== accounts.current ? '<button type="button" data-act="use">Wechseln</button>' : ""}
      <button type="button" data-act="rename" aria-label="Umbenennen">✎</button>
      ${accounts.list.length > 1 ? '<button type="button" data-act="delete" aria-label="Löschen">🗑</button>' : ""}
    </li>`).join("");
}

function buildAccountUI() {
  $("menu-accounts").addEventListener("click", (e) => {
    const b = e.target.closest("[data-account]");
    if (!b) return;
    $("menu").hidden = true;
    if (b.dataset.account !== accounts.current) switchAccount(b.dataset.account);
  });
  $("account-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("account-name").value.trim();
    if (!name) return;
    const id = "a" + Date.now().toString(36);
    accounts.list.push({ id, name });
    local.set("accounts", accounts.list);
    $("account-name").value = "";
    switchAccount(id);
  });
  $("account-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const id = b.closest("li").dataset.id;
    const a = accounts.list.find((x) => x.id === id);
    if (b.dataset.act === "use") switchAccount(id);
    if (b.dataset.act === "rename") {
      const name = prompt("Neuer Name für das Konto:", a.name);
      if (name && name.trim()) { a.name = name.trim().slice(0, 30); local.set("accounts", accounts.list); render(); }
    }
    if (b.dataset.act === "delete") {
      if (!confirm(`Konto „${a.name}“ mit seinen Produkten, seiner Einkaufsliste und seinem Essensplan löschen?`)) return;
      accounts.list = accounts.list.filter((x) => x.id !== id);
      local.set("accounts", accounts.list);
      for (const k of ["favorites", "categories", "shopping", "meals"]) { try { localStorage.removeItem(`ew_${id}_${k}`); } catch { /* egal */ } }
      if (accounts.current === id) switchAccount(accounts.list[0].id); else render();
    }
  });
}

// ---------------------------------------------------------------- Hinweis
let toastTimer;
function toast(msg, isError = false, ms = 5000, actionLabel = null, onAction = null) {
  const el = $("toast");
  el.textContent = msg;
  if (actionLabel) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "toast-action"; b.textContent = actionLabel;
    b.addEventListener("click", () => { el.hidden = true; onAction?.(); });
    el.append(" ", b);
  }
  el.classList.toggle("error", isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

init().catch((e) => toast("Fehler beim Start: " + e.message, true, 10000));
