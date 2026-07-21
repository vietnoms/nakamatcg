// Pure filter-state <-> URL-params serialization; unit-tested in node (no DOM needed).
import type { DealTier } from './types.js';

export interface FilterState {
  tiers: DealTier[];
  min_price?: number;
  max_price?: number;
  min_discount?: number;
  grader?: string;
  min_grade?: number;
  listing: 'all' | 'auction' | 'bin';
  marketplace?: string;
  ends_within_h?: number;
  source: 'all' | 'ebay' | 'wallet';
  sort: 'discount' | 'ends_at' | 'price';
}

export const DEFAULT_FILTERS: FilterState = {
  tiers: [],
  listing: 'all',
  source: 'all',
  sort: 'discount',
};

const num = (v: string | null): number | undefined => {
  if (v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export function paramsToFilters(sp: URLSearchParams): FilterState {
  const tiersRaw = sp.get('tiers');
  const listing = sp.get('listing');
  const source = sp.get('source');
  const sort = sp.get('sort');
  const f: FilterState = {
    ...DEFAULT_FILTERS,
    tiers: tiersRaw
      ? (tiersRaw.split(',').filter((t): t is DealTier =>
          ['steal', 'great-deal', 'good-deal', 'fair'].includes(t),
        ))
      : [],
    listing: listing === 'auction' || listing === 'bin' ? listing : 'all',
    source: source === 'ebay' || source === 'wallet' ? source : 'all',
    sort: sort === 'ends_at' || sort === 'price' ? sort : 'discount',
  };
  const minPrice = num(sp.get('min_price'));
  if (minPrice !== undefined) f.min_price = minPrice;
  const maxPrice = num(sp.get('max_price'));
  if (maxPrice !== undefined) f.max_price = maxPrice;
  const minDiscount = num(sp.get('min_discount'));
  if (minDiscount !== undefined) f.min_discount = minDiscount;
  const grader = sp.get('grader');
  if (grader) f.grader = grader;
  const minGrade = num(sp.get('min_grade'));
  if (minGrade !== undefined) f.min_grade = minGrade;
  const marketplace = sp.get('marketplace');
  if (marketplace) f.marketplace = marketplace;
  const endsWithin = num(sp.get('ends_within_h'));
  if (endsWithin !== undefined) f.ends_within_h = endsWithin;
  return f;
}

export function filtersToParams(f: FilterState): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.tiers.length > 0) sp.set('tiers', f.tiers.join(','));
  if (f.min_price !== undefined) sp.set('min_price', String(f.min_price));
  if (f.max_price !== undefined) sp.set('max_price', String(f.max_price));
  if (f.min_discount !== undefined) sp.set('min_discount', String(f.min_discount));
  if (f.grader) sp.set('grader', f.grader);
  if (f.min_grade !== undefined) sp.set('min_grade', String(f.min_grade));
  if (f.listing !== 'all') sp.set('listing', f.listing);
  if (f.marketplace) sp.set('marketplace', f.marketplace);
  if (f.ends_within_h !== undefined) sp.set('ends_within_h', String(f.ends_within_h));
  if (f.source !== 'all') sp.set('source', f.source);
  if (f.sort !== 'discount') sp.set('sort', f.sort);
  return sp;
}

/** Query string for GET /api/deals (server vocabulary). */
export function filtersToApiQuery(f: FilterState): string {
  const sp = new URLSearchParams();
  if (f.tiers.length > 0) sp.set('tiers', f.tiers.join(','));
  if (f.min_price !== undefined) sp.set('min_price', String(f.min_price));
  if (f.max_price !== undefined) sp.set('max_price', String(f.max_price));
  if (f.min_discount !== undefined) sp.set('min_discount', String(f.min_discount));
  if (f.grader) sp.set('grader', f.grader);
  if (f.min_grade !== undefined) sp.set('min_grade', String(f.min_grade));
  if (f.listing === 'auction') sp.set('auction_only', 'true');
  if (f.listing === 'bin') sp.set('bin_only', 'true');
  if (f.marketplace) sp.set('marketplace', f.marketplace);
  if (f.ends_within_h !== undefined) sp.set('ends_within_h', String(f.ends_within_h));
  if (f.source !== 'all') sp.set('source', f.source);
  sp.set('sort', f.sort);
  sp.set('limit', '200');
  return sp.toString();
}

/** Filters → RuleCriteria JSON for "save current filters as rule". */
export function filtersToRuleCriteria(f: FilterState): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  if (f.source !== 'all') c.source = f.source;
  if (f.tiers.length > 0) c.tiers = f.tiers;
  if (f.min_discount !== undefined) c.min_discount_pct = f.min_discount;
  if (f.min_price !== undefined) c.min_price = f.min_price;
  if (f.max_price !== undefined) c.max_price = f.max_price;
  if (f.grader) c.grader = f.grader;
  if (f.min_grade !== undefined) c.min_grade = f.min_grade;
  if (f.listing === 'auction') c.auction_only = true;
  if (f.listing === 'bin') c.bin_only = true;
  if (f.marketplace) c.marketplace = f.marketplace;
  if (f.ends_within_h !== undefined) c.ends_within_h = f.ends_within_h;
  return c;
}
