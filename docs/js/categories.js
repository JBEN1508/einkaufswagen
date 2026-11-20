// Kategorien + Zuordnung von Angebotstexten zu Kategorien
// (gleiche Kategorien wie in deiner alten Website, ergänzt um Haushalt/Sonstiges)

export const CATEGORIES = [
  "Obst&Gemüse", "Molkerei&Käse", "Grundnahrung", "Tiefkühl",
  "Fisch&Meeresfrüchte", "Fleisch&Wurst", "Getränke", "Knabbern & Naschen",
  "Drogerie", "Haushalt", "Sonstiges"
];

// Reihenfolge ist wichtig: der erste Treffer gewinnt.
const RULES = [
  ["Tiefkühl",            /tiefk[üu]hl|tk-|\btk\b|gefrier|pizza|eiscreme|\beis\b|pommes|kroketten|fischst[äa]bchen|rahmspinat/i],
  ["Fisch&Meeresfrüchte", /fisch|lachs|thunfisch|hering|forelle|garnele|shrimp|scampi|kabeljau|seelachs|makrele|matjes|meeresfr[üu]chte|muschel|backfisch/i],
  ["Fleisch&Wurst",       /fleisch|wurst|schinken|salami|h[äa]hnchen|h[üu]hn|pute|rind|schwein|hack|steak|schnitzel|bratwurst|wiener|aufschnitt|speck|kotelett|gulasch|filet|braten|leberwurst|mett|gefl[üu]gel|lamm|frikadelle|nacken/i],
  ["Molkerei&Käse",       /k[äa]se|milch|joghurt|jogurt|quark|butter|sahne|schmand|mozzarella|gouda|camembert|feta|frischk[äa]se|skyr|pudding|kefir|margarine|molkerei|\bei(er)?\b|eier/i],
  ["Obst&Gemüse",         /obst|gem[üu]se|apfel|[äa]pfel|banane|birne|orange|mandarine|clementine|zitrone|traube|beere|erdbeer|heidelbeer|himbeer|kiwi|ananas|mango|melone|tomate|gurke|paprika|salat|zwiebel|kartoffel|m[öo]hre|karotte|brokkoli|blumenkohl|zucchini|aubergine|pilz|champignon|avocado|kohl|spargel|lauch|kr[äa]uter|nektarine|pfirsich|pflaume/i],
  ["Getränke",            /getr[äa]nk|bier|pils|wein|sekt|prosecco|saft|wasser|cola|limo|limonade|kaffee|espresso|tee\b|energy|schorle|spirituose|whisky|wodka|vodka|rum\b|gin\b|likör|eistee|smoothie|kakao|radler/i],
  ["Knabbern & Naschen",  /schoko|chips|s[üu][ßs]|bonbon|gummi|keks|kekse|praline|riegel|snack|knabber|nuss|n[üu]sse|erdn[üu]ss|lakritz|waffel|kuchen|torte|cracker|flips|popcorn|nougat|marzipan|lebkuchen|spekulatius|stollen|naschen/i],
  ["Drogerie",            /drogerie|shampoo|duschgel|deo|zahnpasta|zahnb[üu]rste|creme|lotion|windel|pampers|rasier|kosmetik|seife|toilettenpapier|taschent[üu]cher|k[öo]rperpflege|haarspray|make-?up|tampon|binde|nivea|hygiene/i],
  ["Haushalt",            /wasch|sp[üu]lmittel|reiniger|putz|m[üu]llbeutel|k[üu]chenrolle|alufolie|frischhalte|geschirr|tabs\b|weichsp[üu]l|haushalt|batterie|kerze|katzen|hunde|tiernahrung|futter/i],
  ["Grundnahrung",        /nudel|pasta|spaghetti|reis\b|mehl|zucker|[öo]l\b|olivenöl|essig|brot|br[öo]tchen|toast|m[üu]sli|cornflakes|haferflocken|konserve|dose|tomatenmark|sauce|so[ßs]e|ketchup|senf|mayo|gew[üu]rz|salz|pfeffer|suppe|marmelade|konfit[üu]re|honig|nutella|aufstrich|backmischung|hefe|linsen|bohnen|erbsen|mais|fertiggericht|grundnahrung|nahrungsmittel|lebensmittel/i],
];

/** Ordnet einen Angebotstext (Titel, Marke, Marktguru-Kategorien) einer Kategorie zu. */
// Die Texte werden der Reihe nach geprüft (zuerst die marktguru-Kategorie,
// dann der Produktname, dann die Beschreibung) – der erste Treffer gewinnt.
export function guessCategory(...texts) {
  for (const s of texts.filter(Boolean)) {
    for (const [cat, re] of RULES) if (re.test(s)) return cat;
  }
  return "Sonstiges";
}

/** Gleiche Normalisierung wie in deiner alten Website: "Obst & Gemüse" -> "Obst&Gemüse" */
export function normalizeCategory(cat) {
  if (!cat) return "";
  const n = cat.replace(/\s*&\s*/g, "&").trim();
  if (n === "Knabbern&Naschen") return "Knabbern & Naschen";
  return CATEGORIES.includes(n) ? n : (n || "");
}

// Suchbegriffe für den Abruf. Marktguru bietet nur eine Textsuche – deshalb
// fragen wir viele breite Begriffe ab und führen die Treffer zusammen.
// In den Einstellungen der App kann diese Liste erweitert werden.
export const DEFAULT_KEYWORDS = [
  // Obst & Gemüse
  "Obst", "Gemüse", "Äpfel", "Bananen", "Tomaten", "Paprika", "Gurke", "Salat", "Kartoffeln",
  "Zwiebeln", "Möhren", "Trauben", "Beeren", "Zitrusfrüchte", "Pilze", "Avocado",
  // Molkerei
  "Milch", "Käse", "Joghurt", "Quark", "Butter", "Sahne", "Eier", "Mozzarella", "Frischkäse", "Pudding", "Margarine",
  // Fleisch / Fisch
  "Fleisch", "Wurst", "Hähnchen", "Hackfleisch", "Schwein", "Rind", "Schinken", "Salami", "Bratwurst", "Aufschnitt", "Pute",
  "Fisch", "Lachs", "Thunfisch", "Garnelen",
  // Tiefkühl
  "Tiefkühl", "Pizza", "Eis", "Pommes",
  // Grundnahrung
  "Nudeln", "Reis", "Mehl", "Zucker", "Öl", "Brot", "Toast", "Müsli", "Kaffee", "Tee", "Konserven",
  "Sauce", "Ketchup", "Gewürze", "Suppe", "Marmelade", "Honig", "Aufstrich", "Fertiggericht",
  // Getränke
  "Getränke", "Bier", "Wein", "Sekt", "Saft", "Wasser", "Cola", "Limonade", "Energy", "Spirituosen",
  // Naschen
  "Schokolade", "Chips", "Kekse", "Süßigkeiten", "Gummibärchen", "Nüsse", "Riegel", "Pralinen",
  // Drogerie / Haushalt
  "Duschgel", "Shampoo", "Zahnpasta", "Deo", "Windeln", "Toilettenpapier", "Waschmittel",
  "Spülmittel", "Reiniger", "Küchenrolle", "Katzenfutter", "Hundefutter",
];
