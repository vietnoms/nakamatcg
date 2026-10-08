/**
 * Matching what was read off a card (by CardSight or Claude) to TCGplayer catalog entries.
 * Pure. The collector number is the strongest signal; the name and set break ties.
 */

export type Game = "pokemon" | "one_piece";

/** What a scan read off the card. Empty strings where nothing was readable. */
export type CardRead = {
  game: Game;
  name: string;
  setName: string;
  setCode: string;
  number: string;
  finish: string;
  graded: { company: string; grade: string; cert: string } | null;
};

export type CatalogCandidate = {
  productId: number;
  game: string;
  setName: string;
  name: string;
  cleanName: string;
  number: string;
  rarity: string;
  imageUrl: string;
  /** every printing of this product with its market price */
  printings: { subType: string; marketCents: number | null }[];
};

/** "025/165" -> "25", "TG05/TG30" -> "TG5", "OP01-003" -> "OP01-003", "SWSH284" -> "SWSH284". */
export function normalizeNumber(n: string): string {
  const s = n.toUpperCase().replace(/\s+/g, "").replace(/^#/, "");
  const head = s.split("/")[0] ?? "";
  // leading zeros of the trailing digits: TG05 -> TG5, 025 -> 25; keep One Piece's OP01-003 intact
  if (/^[A-Z]{2}\d{2}-\d{3}$/.test(head)) return head;
  return head.replace(/^([A-Z]*)0+(\d)/, "$1$2");
}

/** The printed total after the slash, if any: "223/197" -> "197". */
export function numberTotal(n: string): string {
  const parts = n.toUpperCase().replace(/\s+/g, "").split("/");
  return parts.length > 1 ? (parts[1] ?? "").replace(/^([A-Z]*)0+(\d)/, "$1$2") : "";
}

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 0);

/** Share of the read's words found in the candidate's (0..1). */
function overlap(read: string, cand: string): number {
  const a = words(read);
  if (a.length === 0) return 0;
  const b = new Set(words(cand));
  return a.filter((w) => b.has(w)).length / a.length;
}

export function scoreCandidate(read: CardRead, c: CatalogCandidate): number {
  let score = 0;
  if (read.number) {
    const rk = normalizeNumber(read.number);
    const ck = normalizeNumber(c.number);
    if (rk && rk === ck) {
      score += 35;
      const rt = numberTotal(read.number);
      const ct = numberTotal(c.number);
      // 223/197 and 223/198 are different cards: a printed total that disagrees counts against
      if (rt && ct) score += rt === ct ? 25 : -15;
    }
  }
  score += 30 * overlap(read.name, c.cleanName || c.name);
  score += 10 * Math.max(overlap(read.setName, c.setName), read.setCode ? overlap(read.setCode, c.setName) : 0);
  return score;
}

/** Best first; drops candidates that share nothing with the read. */
export function rankCandidates(read: CardRead, cands: CatalogCandidate[], limit = 6): (CatalogCandidate & { score: number })[] {
  return cands
    .map((c) => ({ ...c, score: scoreCandidate(read, c) }))
    .filter((c) => c.score >= 15)
    .sort((a, b) => b.score - a.score || (b.printings[0]?.marketCents ?? 0) - (a.printings[0]?.marketCents ?? 0))
    .slice(0, limit);
}

/** The printing that best fits what the scan saw ("reverse holo" -> Reverse Holofoil), else the first. */
export function pickPrinting(finish: string, printings: CatalogCandidate["printings"]): string | null {
  if (printings.length === 0) return null;
  const f = finish.toLowerCase();
  const want = /reverse/.test(f) ? /reverse/i : /1st|first/.test(f) ? /1st/i : /holo|foil/.test(f) ? /^holofoil$|^foil$/i : /normal|non/.test(f) ? /^normal$/i : null;
  const hit = want ? printings.find((p) => want.test(p.subType)) : undefined;
  return (hit ?? printings[0]!).subType;
}

/** Median of sale prices (dollars) in cents; null when there are none. */
export function medianCents(prices: number[]): number | null {
  const xs = prices.filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  const m = xs.length % 2 ? xs[mid]! : (xs[mid - 1]! + xs[mid]!) / 2;
  return Math.round(m * 100);
}

/** "Charizard ex - 223/197" -> "Charizard ex"; "SV03: Obsidian Flames" -> "Obsidian Flames". */
export function tidyName(name: string, number: string): string {
  return number ? name.replace(new RegExp(`\\s+-\\s+${number.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}$`), "") : name;
}
export function tidySet(set: string): string {
  return set.replace(/^[A-Z0-9-]{2,8}:\s+/, "");
}
