import "server-only";
import type { Db } from "@/db/client";
import { pickPrinting, rankCandidates, type CardRead, type CatalogCandidate, type Game } from "@/lookup/match";
import { candidatesFor } from "./catalog";

export type Image = { bytes: ArrayBuffer; mediaType: string };
export type Confidence = "high" | "medium" | "low";
export type ProviderRead = { read: CardRead; confidence: Confidence; source: "cardsight" | "claude"; cardsightId?: string };
export type Provider = (img: Image, game: Game) => Promise<ProviderRead | null>;

export type GradedPrice = { company: string; grade: string; medianCents: number; sales: number; lastSale: string | null };
export type GradedPricer = (cardsightId: string, company: string, grade: string) => Promise<GradedPrice | null>;

export type LookupResult = {
  source: "cardsight" | "claude" | null;
  confidence: Confidence | null;
  read: CardRead | null;
  candidates: (CatalogCandidate & { score: number })[];
  /** the catalog entry and printing to preselect */
  suggested: { productId: number; subType: string } | null;
  graded: GradedPrice | null;
  notes: string[];
};

async function attempt(name: string, p: Provider | null, img: Image, game: Game, notes: string[]): Promise<ProviderRead | null> {
  if (!p) return null;
  try {
    const r = await p(img, game);
    if (!r) notes.push(`${name} could not read the card`);
    return r;
  } catch (e) {
    notes.push(`${name} failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/**
 * Identifies a customer's card from a photo and prices it. CardSight first; Claude reads the
 * card when CardSight is unsure, finds nothing, or its answer matches nothing in the TCGplayer
 * catalog. Slabs get a recent-sales price from CardSight when the card was identified there.
 */
export async function lookupCard(
  db: Db,
  img: Image,
  game: Game,
  deps: { cardsight: Provider | null; claude: Provider | null; gradedPrice: GradedPricer | null },
): Promise<LookupResult> {
  const notes: string[] = [];
  if (!deps.cardsight && !deps.claude) notes.push("No photo service is set up (CARDSIGHT_API_KEY or ANTHROPIC_API_KEY)");

  const cs = await attempt("CardSight", deps.cardsight, img, game, notes);
  let used: ProviderRead | null = cs && cs.confidence !== "low" ? cs : null;
  let ranked = used ? rankCandidates(used.read, await candidatesFor(db, used.read)) : [];

  if (!used || ranked.length === 0) {
    if (used) notes.push("CardSight's answer did not match the price catalog; asked Claude");
    const cl = await attempt("Claude", deps.claude, img, game, notes);
    if (cl) {
      const clRanked = rankCandidates(cl.read, await candidatesFor(db, cl.read));
      if (!used || clRanked.length > 0) {
        used = cl;
        ranked = clRanked;
      }
    }
  }
  // a low-confidence CardSight read beats nothing at all
  if (!used && cs) {
    used = cs;
    ranked = rankCandidates(cs.read, await candidatesFor(db, cs.read));
  }

  if (!used) return { source: null, confidence: null, read: null, candidates: [], suggested: null, graded: null, notes };

  const top = ranked[0];
  const subType = top ? pickPrinting(used.read.finish, top.printings) : null;

  let graded: GradedPrice | null = null;
  const g = used.read.graded;
  const csId = used.cardsightId ?? cs?.cardsightId;
  if (g && g.company && g.grade && csId && deps.gradedPrice) {
    try {
      graded = await deps.gradedPrice(csId, g.company, g.grade);
      if (!graded) notes.push(`No recent ${g.company} ${g.grade} sales found`);
    } catch (e) {
      notes.push(`Graded price lookup failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return {
    source: used.source,
    confidence: used.confidence,
    read: used.read,
    candidates: ranked,
    suggested: top && subType !== null ? { productId: top.productId, subType } : null,
    graded,
    notes,
  };
}
