/**
 * Collectr portfolio CSV -> import rows. Pure. Columns are found by name (aliases below; the real
 * 2026-10-08 export header is pinned in fixtures/collectr/sample.csv) and the import page lets the
 * user correct the mapping before anything is written. Collectr dates its price column
 * ("Market Price (As of 2026-10-08)"), so multi-word aliases also match as a prefix.
 */
import Papa from "papaparse";
import { parseDollars } from "@/lib/money";

export const FIELDS = [
  "name",
  "set",
  "number",
  "quantity",
  "market",
  "marketTotal",
  "priceOverride",
  "cost",
  "condition",
  "grader",
  "grade",
  "cert",
  "rarity",
  "variant",
  "category",
  "portfolio",
  "language",
  "notes",
] as const;
export type Field = (typeof FIELDS)[number];
export type Mapping = Record<Field, number | null>;

export const FIELD_LABELS: Record<Field, string> = {
  name: "Card / product name",
  set: "Set",
  number: "Card number",
  quantity: "Quantity",
  market: "Market price (each)",
  marketTotal: "Market value (total)",
  priceOverride: "Your own price (overrides market)",
  cost: "Cost paid (each)",
  condition: "Condition",
  grader: "Grading company",
  grade: "Grade",
  cert: "Cert number",
  rarity: "Rarity",
  variant: "Variant / printing",
  category: "Game / category",
  portfolio: "Portfolio",
  language: "Language",
  notes: "Notes",
};

/** Normalized header names per field, most specific first. */
const ALIASES: Record<Field, string[]> = {
  name: ["product name", "card name", "name", "item name", "item", "card", "title", "product"],
  set: ["set name", "set", "expansion", "group name", "group", "series"],
  number: ["card number", "number", "card #", "card no", "collector number", "no", "#"],
  quantity: ["quantity", "qty", "count", "copies", "amount"],
  market: [
    "market price",
    "tcg market price",
    "tcgplayer market price",
    "current price",
    "price each",
    "market value each",
    "price",
    "market",
    "value",
    "price estimate",
  ],
  marketTotal: ["total market value", "total value", "market value", "total price", "total"],
  priceOverride: ["price override", "custom price", "override price", "override"],
  cost: ["average cost paid", "avg cost paid", "average cost", "avg cost", "cost paid", "my cost", "purchase price", "price paid", "cost"],
  condition: ["condition", "card condition"],
  grader: ["grading company", "grade company", "grade issuer", "grader", "grading service", "graded by"],
  grade: ["grade", "graded"],
  cert: ["cert number", "certification number", "cert #", "cert"],
  rarity: ["rarity"],
  variant: ["variance", "variant", "printing", "finish", "edition", "variety", "foil"],
  category: ["category", "game", "tcg", "product type", "type"],
  portfolio: ["portfolio name", "portfolio", "collection", "folder", "list"],
  language: ["language", "lang"],
  notes: ["notes", "my notes", "note", "comments"],
};

export function normHeader(h: string): string {
  return h
    .replace(/^\p{Cf}+/u, "")
    .toLowerCase()
    .replace(/[^a-z0-9#]+/g, " ")
    .trim();
}

export function detectMapping(headers: string[]): Mapping {
  const norm = headers.map(normHeader);
  const used = new Set<number>();
  const mapping = Object.fromEntries(FIELDS.map((f) => [f, null])) as Mapping;
  const pass = (matches: (header: string, alias: string) => boolean) => {
    for (const field of FIELDS) {
      if (mapping[field] !== null) continue;
      for (const alias of ALIASES[field]) {
        const i = norm.findIndex((h, idx) => !used.has(idx) && matches(h, alias));
        if (i >= 0) {
          mapping[field] = i;
          used.add(i);
          break;
        }
      }
    }
  };
  // exact matches first; a fuzzy "price" match on "Price Paid" would read cost as market
  pass((h, a) => h === a);
  // then dated or annotated headers, multi-word aliases only: "market price as of 2026 10 08"
  pass((h, a) => a.includes(" ") && h.startsWith(`${a} `));
  return mapping;
}

/** Finds the header row (the first of the first 10 rows with a name-like column) and the data after it. */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const res = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
  const all = res.data;
  const nameAliases = new Set(ALIASES.name);
  const at = all.slice(0, 10).findIndex((r) => r.some((c) => nameAliases.has(normHeader(c))));
  const h = at >= 0 ? at : 0;
  return { headers: (all[h] ?? []).map((c) => c.replace(/^\p{Cf}+/u, "").trim()), rows: all.slice(h + 1) };
}

export type ProductKind = "raw" | "slab" | "sealed";

export type ImportRow = {
  /** 1-based line in the CSV data (after the header), for skip reasons */
  line: number;
  key: string;
  kind: ProductKind;
  game: string;
  name: string;
  setName: string;
  cardNumber: string;
  variant: string;
  rarity: string;
  condition: string;
  grader: string;
  grade: string;
  cert: string;
  language: string;
  portfolio: string;
  quantity: number;
  marketCents: number | null;
  costCents: number | null;
  notes: string;
};

export type Skip = { line: number; reason: string; name: string };

const BLANK = new Set(["", "-", "--", "n/a", "na", "none", "null", "ungraded", "raw", "not graded"]);
const clean = (v: string | undefined) => {
  const s = (v ?? "").trim();
  return BLANK.has(s.toLowerCase()) ? "" : s;
};

const GRADERS = ["PSA", "BGS", "BECKETT", "CGC", "SGC", "TAG", "ACE", "AGS", "ARS", "PCA", "HGA", "GMA", "MNT"];

/** Qualifiers that change a slab's price and stay in the grade; "GEM - MT", "Mint" and the like don't. */
const GRADE_QUALIFIERS: [RegExp, string][] = [
  [/pristine/i, "Pristine"],
  [/black\s*label/i, "Black Label"],
  [/perfect/i, "Perfect"],
];

/** "10.0 GEM - MT" -> "10", "10.0 Pristine" -> "10 Pristine", "9.5" -> "9.5". Anything else unchanged. */
export function shortGrade(grade: string): string {
  const m = /^(\d+(?:\.\d+)?)\b\s*(.*)$/.exec(grade.trim());
  if (!m) return grade.trim();
  const num = String(Number(m[1]));
  const q = GRADE_QUALIFIERS.find(([re]) => re.test(m[2] ?? ""))?.[1];
  return q ? `${num} ${q}` : num;
}

/** "PSA 10.0 GEM - MT" in one column -> ["PSA", "10"]; a bare "10" stays a grade. */
export function splitGrade(grader: string, grade: string): { grader: string; grade: string } {
  if (grader || !grade) return { grader: grader.toUpperCase(), grade: grade ? shortGrade(grade) : grade };
  const m = new RegExp(`^(${GRADERS.join("|")})\\s*(.*)$`, "i").exec(grade);
  if (m) return { grader: (m[1] ?? "").toUpperCase(), grade: shortGrade(m[2] ?? "") };
  return { grader: "", grade: shortGrade(grade) };
}

const CONDITIONS: [RegExp, string][] = [
  [/^(near mint|nm|nm-m|mint|m)$/i, "NM"],
  [/^(lightly played|lp|excellent|ex)$/i, "LP"],
  [/^(moderately played|mp|very good|vg)$/i, "MP"],
  [/^(heavily played|hp|good|poor)$/i, "HP"],
  [/^(damaged|dmg)$/i, "DMG"],
];

export function shortCondition(c: string): string {
  for (const [re, short] of CONDITIONS) if (re.test(c.trim())) return short;
  return c.trim();
}

const SEALED_WORDS =
  /\b(booster|elite trainer|etb|box|bundle|tin|collection|blister|pack|deck|case|display|sealed|premium|binder)\b/i;

export function productKind(r: { grader: string; grade: string; cardNumber: string; name: string; category: string }): ProductKind {
  if (r.grader || r.grade) return "slab";
  if (!r.cardNumber && (/sealed/i.test(r.category) || SEALED_WORDS.test(r.name))) return "sealed";
  return "raw";
}

const keyPart = (s: string) => s.toLowerCase().replace(/[^a-z0-9#/]+/g, " ").trim();

/**
 * The natural key that makes a re-import update a product instead of duplicating it. A slab
 * is its cert; anything else is game, set, number, name, variant, condition, grade, language.
 */
export function productKey(r: Omit<ImportRow, "key" | "line" | "quantity" | "marketCents" | "costCents" | "notes" | "portfolio" | "kind">): string {
  if (r.cert) return `cert:${keyPart(r.grader)}:${keyPart(r.cert)}`;
  return [r.game, r.setName, r.cardNumber, r.name, r.variant, r.condition, r.grader, r.grade, r.language]
    .map(keyPart)
    .join("|");
}

export function parseRows(rows: string[][], mapping: Mapping): { items: ImportRow[]; skipped: Skip[] } {
  const get = (row: string[], f: Field) => {
    const i = mapping[f];
    return i === null ? "" : clean(row[i]);
  };
  const items: ImportRow[] = [];
  const skipped: Skip[] = [];

  rows.forEach((row, idx) => {
    const line = idx + 1;
    const name = get(row, "name");
    if (!name) {
      if (row.some((c) => c.trim())) skipped.push({ line, reason: "no name", name: "" });
      return;
    }

    const qtyText = get(row, "quantity");
    const quantity = qtyText ? Number.parseInt(qtyText.replace(/,/g, ""), 10) : 1;
    if (!Number.isFinite(quantity) || quantity <= 0) {
      skipped.push({ line, reason: `quantity "${qtyText}"`, name });
      return;
    }

    let marketCents = parseDollars(get(row, "market"));
    if (marketCents === null) {
      const total = parseDollars(get(row, "marketTotal"));
      if (total !== null) marketCents = Math.round(total / quantity);
    }
    // a price you set yourself in Collectr wins over its market price (0 means none set)
    const override = parseDollars(get(row, "priceOverride"));
    if (override) marketCents = override;
    // Collectr exports a cost nobody entered as 0.0000: unknown, not free
    const cost = parseDollars(get(row, "cost"));

    const { grader, grade } = splitGrade(get(row, "grader"), get(row, "grade"));
    const base = {
      game: get(row, "category"),
      name,
      setName: get(row, "set"),
      cardNumber: get(row, "number"),
      variant: get(row, "variant"),
      rarity: get(row, "rarity"),
      condition: grader || grade ? "" : shortCondition(get(row, "condition")),
      grader,
      grade,
      cert: get(row, "cert"),
      language: get(row, "language"),
    };
    items.push({
      ...base,
      line,
      key: productKey(base),
      kind: productKind({ ...base, category: base.game }),
      portfolio: get(row, "portfolio"),
      quantity,
      marketCents,
      costCents: cost ? cost : null,
      notes: get(row, "notes"),
    });
  });

  return { items, skipped };
}

/** What a sticker shows in its badge slot. */
export function badgeFor(p: { kind: ProductKind; condition: string; grader: string; grade: string }): string {
  if (p.kind === "slab") return [p.grader, p.grade].filter(Boolean).join(" ");
  if (p.kind === "sealed") return "Sealed";
  return p.condition;
}

/** The set-and-number line on a sticker. */
export function detailFor(p: { setName: string; cardNumber: string; variant: string }): string {
  const num = p.cardNumber ? (p.cardNumber.startsWith("#") ? p.cardNumber : `#${p.cardNumber}`) : "";
  return [p.setName, num].filter(Boolean).join(" ");
}
