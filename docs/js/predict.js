// Wochen-Rechnung und Vorhersage, wann ein Angebot wiederkommt.
//
// Statt nur "KW 1–53" (wie in der alten Website) rechnen wir mit einem
// fortlaufenden Wochen-Index. Dadurch klappt die Rechnung auch über den
// Jahreswechsel (KW 50 -> KW 3 = 6 Wochen Abstand).

const WEEK_MS = 7 * 24 * 3600 * 1000;
const EPOCH_MONDAY = Date.UTC(1970, 0, 5); // 05.01.1970 war ein Montag

/** Montag (UTC, 00:00) der Woche, in der `date` liegt. */
function mondayUTC(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d.getTime();
}

/** Fortlaufender Wochen-Index (0 = Woche ab 05.01.1970). */
export function weekIndexOf(date) {
  if (!(date instanceof Date)) date = new Date(date);
  return Math.round((mondayUTC(date) - EPOCH_MONDAY) / WEEK_MS);
}

/**
 * Wochen-Index eines Zeitpunkts aus marktguru (UTC, z. B. "2026-11-15T23:00:00Z"),
 * gerechnet in deutscher Zeit. Ein Start am Sonntag zählt zur folgenden Woche
 * (sonntags sind die Märkte zu – das Angebot gilt ab Montag).
 */
export function berlinWeekIndex(iso) {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (date.getDay() === 0) date.setDate(date.getDate() + 1);
  return weekIndexOf(date);
}

export function mondayOfIndex(idx) {
  return new Date(EPOCH_MONDAY + idx * WEEK_MS);
}

/** ISO-Kalenderwoche + ISO-Jahr für einen Wochen-Index. */
export function isoWeekOfIndex(idx) {
  const thursday = new Date(EPOCH_MONDAY + idx * WEEK_MS + 3 * 86400000);
  const year = thursday.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.floor((thursday.getTime() - jan1) / WEEK_MS) + 1;
  return { year, week };
}

/** Wochen-Index aus ISO-Jahr + KW. */
export function indexFromIsoWeek(year, week) {
  // Die Woche, in der der 4. Januar liegt, ist immer KW 1.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const mondayW1 = Date.UTC(year, 0, 4 - (day - 1));
  return Math.round((mondayW1 - EPOCH_MONDAY) / WEEK_MS) + (week - 1);
}

export function currentWeekIndex(now = new Date()) {
  return weekIndexOf(now);
}

const fmtDay = (d) => `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.`;

/** "KW 49 (01.12.–07.12.)" */
export function formatWeek(idx, withDates = true) {
  const { week } = isoWeekOfIndex(idx);
  if (!withDates) return `KW ${week}`;
  const mo = mondayOfIndex(idx);
  const sa = new Date(mo.getTime() + 5 * 86400000);
  return `KW ${week} (${fmtDay(mo)}–${fmtDay(sa)})`;
}

/**
 * Fasst aufeinanderfolgende Angebotswochen zu einer "Aktion" zusammen.
 * Beispiel: [10, 11, 17, 23, 24] -> Starts [10, 17, 23]
 * (Ein Angebot, das 2 Wochen läuft, soll den Rhythmus nicht verfälschen.)
 */
export function actionStarts(weekIdxs) {
  const w = [...new Set(weekIdxs)].sort((a, b) => a - b);
  const starts = [];
  for (let i = 0; i < w.length; i++) {
    if (i === 0 || w[i] - w[i - 1] > 1) starts.push(w[i]);
  }
  return starts;
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Vorhersage für ein Produkt.
 * @param {number[]} weekIdxs  Wochen, in denen das Produkt im Angebot war
 * @param {number}   nowIdx    aktuelle Woche
 * @returns {{
 *   status: "none"|"active"|"ok"|"overdue",
 *   nextIdx: number|null, rangeLo: number|null, rangeHi: number|null,
 *   interval: number|null, intervals: number[], occurrences: number,
 *   confidence: "niedrig"|"mittel"|"hoch"|null, weeksUntil: number|null
 * }}
 */
export function predictNext(weekIdxs, nowIdx = currentWeekIndex()) {
  const starts = actionStarts(weekIdxs);
  const all = [...new Set(weekIdxs)];
  const isActive = all.includes(nowIdx);
  const base = {
    status: "none", nextIdx: null, rangeLo: null, rangeHi: null, interval: null,
    intervals: [], occurrences: starts.length, confidence: null, weeksUntil: null, isActive,
  };
  if (starts.length < 2) return { ...base, status: isActive ? "active" : "none" };

  const intervals = starts.slice(1).map((s, i) => s - starts[i]);
  // Median ist robuster als der Durchschnitt (ein Ausreißer verzieht ihn kaum).
  const interval = Math.round(median(intervals));
  // Für die Vorhersage zählt der Beginn der letzten Aktion.
  const last = starts[starts.length - 1];

  let nextIdx = last + interval;
  // Läuft die letzte Aktion gerade (oder liegt sie in der Zukunft), ist die
  // nächste Aktion die danach.
  const spread = intervals.length >= 2
    ? Math.max(1, Math.round((Math.max(...intervals) - Math.min(...intervals)) / 2))
    : 1;

  let confidence = "niedrig";
  if (intervals.length >= 3 && spread <= 1) confidence = "hoch";
  else if (intervals.length >= 2 && spread <= 2) confidence = "mittel";

  let status = "ok";
  if (isActive) status = "active";
  else if (nextIdx + spread < nowIdx) status = "overdue";

  return {
    ...base,
    status,
    nextIdx,
    rangeLo: nextIdx - spread,
    rangeHi: nextIdx + spread,
    interval,
    intervals,
    confidence,
    weeksUntil: nextIdx - nowIdx,
  };
}

/**
 * Wandelt die KW-Zahlen aus der alten Website (ohne Jahr) in Wochen-Indizes um.
 * Annahme: die letzte KW liegt in der Vergangenheit (bzw. ist die aktuelle);
 * davor liegende KWs werden rückwärts eingeordnet (Jahreswechsel wird erkannt).
 * @param {(number|null)[]} kws  [KW1, KW2, KW3] in zeitlicher Reihenfolge
 */
export function legacyWeeksToIndexes(kws, nowIdx = currentWeekIndex()) {
  const list = kws.filter((k) => Number.isFinite(k) && k >= 1 && k <= 53);
  if (!list.length) return [];
  const now = isoWeekOfIndex(nowIdx);
  const out = [];
  // jüngste KW zuerst einordnen
  let year = list[list.length - 1] <= now.week ? now.year : now.year - 1;
  let nextIdx = Infinity;
  for (let i = list.length - 1; i >= 0; i--) {
    let idx = indexFromIsoWeek(year, list[i]);
    while (idx >= nextIdx) { year -= 1; idx = indexFromIsoWeek(year, list[i]); }
    out.unshift(idx);
    nextIdx = idx;
  }
  return out;
}
