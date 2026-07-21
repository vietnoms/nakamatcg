import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTERS,
  filtersToApiQuery,
  filtersToParams,
  filtersToRuleCriteria,
  paramsToFilters,
  type FilterState,
} from '../shared/filterParams.js';

describe('filter <-> URL params round trip', () => {
  it('defaults serialize to empty params', () => {
    expect(filtersToParams(DEFAULT_FILTERS).toString()).toBe('');
    expect(paramsToFilters(new URLSearchParams())).toEqual(DEFAULT_FILTERS);
  });

  it('round-trips a fully-loaded filter state', () => {
    const f: FilterState = {
      tiers: ['steal', 'great-deal'],
      min_price: 50,
      max_price: 300,
      min_discount: 35,
      grader: 'PSA',
      min_grade: 9,
      listing: 'auction',
      marketplace: 'ebay',
      ends_within_h: 24,
      source: 'ebay',
      sort: 'ends_at',
    };
    expect(paramsToFilters(filtersToParams(f))).toEqual(f);
  });

  it('ignores junk param values', () => {
    const sp = new URLSearchParams('tiers=bogus,steal&listing=nope&min_price=abc&sort=hax');
    const f = paramsToFilters(sp);
    expect(f.tiers).toEqual(['steal']);
    expect(f.listing).toBe('all');
    expect(f.min_price).toBeUndefined();
    expect(f.sort).toBe('discount');
  });
});

describe('filtersToApiQuery', () => {
  it('maps listing to auction_only/bin_only and always sets limit', () => {
    const qs = filtersToApiQuery({ ...DEFAULT_FILTERS, listing: 'auction', min_discount: 35 });
    const sp = new URLSearchParams(qs);
    expect(sp.get('auction_only')).toBe('true');
    expect(sp.get('min_discount')).toBe('35');
    expect(sp.get('limit')).toBe('200');
  });
});

describe('filtersToRuleCriteria', () => {
  it('maps to the rule vocabulary', () => {
    expect(
      filtersToRuleCriteria({ ...DEFAULT_FILTERS, tiers: ['steal'], min_discount: 35, max_price: 300, listing: 'auction' }),
    ).toEqual({ tiers: ['steal'], min_discount_pct: 35, max_price: 300, auction_only: true });
  });
});
