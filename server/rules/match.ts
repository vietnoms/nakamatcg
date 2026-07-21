import type { DealRow, RuleCriteria } from '../../shared/types.js';
import type { GetDealsFilters } from '../mcp/palletTrade.js';

/** Pure predicate: does a cached deal satisfy a rule's criteria? */
export function matchesRule(criteria: RuleCriteria, deal: DealRow, now: Date = new Date()): boolean {
  if (criteria.source && criteria.source !== 'all' && deal.source !== criteria.source) return false;
  if (criteria.tiers && criteria.tiers.length > 0) {
    if (!deal.deal_tier || !(criteria.tiers as string[]).includes(deal.deal_tier)) return false;
  }
  if (criteria.min_discount_pct !== undefined) {
    if (deal.percent_below_market == null || deal.percent_below_market < criteria.min_discount_pct)
      return false;
  }
  if (criteria.min_price !== undefined && deal.price_total < criteria.min_price) return false;
  if (criteria.max_price !== undefined && deal.price_total > criteria.max_price) return false;
  if (criteria.grader) {
    if (!deal.grader || deal.grader.toUpperCase() !== criteria.grader.toUpperCase()) return false;
  }
  if (criteria.min_grade !== undefined) {
    if (deal.grade == null || deal.grade < criteria.min_grade) return false;
  }
  if (criteria.auction_only && deal.listing_type !== 'auction') return false;
  if (criteria.bin_only && deal.listing_type !== 'fixed_price') return false;
  if (criteria.marketplace && deal.marketplace !== criteria.marketplace) return false;
  if (criteria.ends_within_h !== undefined) {
    if (!deal.ends_at) return false;
    const msLeft = new Date(deal.ends_at).getTime() - now.getTime();
    if (Number.isNaN(msLeft) || msLeft < 0 || msLeft > criteria.ends_within_h * 3_600_000)
      return false;
  }
  if (criteria.title_includes && criteria.title_includes.length > 0) {
    const t = deal.title.toLowerCase();
    if (!criteria.title_includes.some((s) => t.includes(s.toLowerCase()))) return false;
  }
  return true;
}

/**
 * Server-side projection of a rule for the per-rule get_deals call — ensures rules
 * targeting slices outside the broad top-100-by-discount fetch are still covered.
 * (title_includes has no server-side equivalent; it is client-side only.)
 */
export function ruleToGetDealsFilters(criteria: RuleCriteria): GetDealsFilters {
  const f: GetDealsFilters = { limit: 100 };
  if (criteria.source && criteria.source !== 'all') f.source = criteria.source;
  if (criteria.tiers && criteria.tiers.length === 1) f.tier = criteria.tiers[0];
  if (criteria.min_discount_pct !== undefined) f.min_discount_pct = criteria.min_discount_pct;
  if (criteria.min_price !== undefined) f.min_price = criteria.min_price;
  if (criteria.max_price !== undefined) f.max_price = criteria.max_price;
  if (criteria.grader) f.grader = criteria.grader;
  if (criteria.min_grade !== undefined) f.min_grade = criteria.min_grade;
  if (criteria.auction_only) f.auction_only = true;
  if (criteria.bin_only) f.bin_only = true;
  if (criteria.marketplace) f.marketplace = criteria.marketplace;
  if (criteria.ends_within_h !== undefined) f.ends_within = criteria.ends_within_h;
  return f;
}

/** Priority for p-queue (higher runs first): manual > soon-ending auctions > the rest. */
export function analysisPriority(trig: 'manual' | 'auto', endsAt: string | null, now: Date = new Date()): number {
  if (trig === 'manual') return 1000;
  if (endsAt) {
    const hLeft = (new Date(endsAt).getTime() - now.getTime()) / 3_600_000;
    if (!Number.isNaN(hLeft) && hLeft >= 0) {
      if (hLeft < 2) return 900;
      if (hLeft < 6) return 800;
      if (hLeft < 24) return 700;
    }
  }
  return 500;
}
