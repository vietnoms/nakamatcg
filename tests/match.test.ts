import { describe, expect, it } from 'vitest';
import { analysisPriority, matchesRule, ruleToGetDealsFilters } from '../server/rules/match.js';
import { dealFromPayload } from '../server/mcp/palletTrade.js';
import { fixtureDeals } from './helpers.js';
import type { DealRow } from '../shared/types.js';

const NOW = new Date('2030-06-01T00:00:00Z'); // fixture auction ends 12h later

function deal(overrides: Partial<DealRow> = {}): DealRow {
  const base = dealFromPayload(fixtureDeals()[0])! as unknown as DealRow;
  return { ...base, first_seen_at: '', last_seen_at: '', ...overrides };
}

describe('matchesRule truth table', () => {
  it('empty criteria matches everything', () => {
    expect(matchesRule({}, deal(), NOW)).toBe(true);
  });
  it('tier filter', () => {
    expect(matchesRule({ tiers: ['steal'] }, deal(), NOW)).toBe(true);
    expect(matchesRule({ tiers: ['fair'] }, deal(), NOW)).toBe(false);
  });
  it('discount / price bounds', () => {
    expect(matchesRule({ min_discount_pct: 35 }, deal(), NOW)).toBe(true);
    expect(matchesRule({ min_discount_pct: 50 }, deal(), NOW)).toBe(false);
    expect(matchesRule({ max_price: 300 }, deal(), NOW)).toBe(false); // price 385.50
    expect(matchesRule({ max_price: 400, min_price: 300 }, deal(), NOW)).toBe(true);
  });
  it('grader + grade', () => {
    expect(matchesRule({ grader: 'psa', min_grade: 9 }, deal(), NOW)).toBe(true);
    expect(matchesRule({ grader: 'BGS' }, deal(), NOW)).toBe(false);
    expect(matchesRule({ min_grade: 10 }, deal(), NOW)).toBe(false);
    expect(matchesRule({ min_grade: 9 }, deal({ grade: null }), NOW)).toBe(false);
  });
  it('listing type', () => {
    expect(matchesRule({ auction_only: true }, deal(), NOW)).toBe(true);
    expect(matchesRule({ bin_only: true }, deal(), NOW)).toBe(false);
  });
  it('ends_within_h', () => {
    expect(matchesRule({ ends_within_h: 24 }, deal(), NOW)).toBe(true);
    expect(matchesRule({ ends_within_h: 6 }, deal(), NOW)).toBe(false); // ends in 12h
    expect(matchesRule({ ends_within_h: 24 }, deal({ ends_at: null }), NOW)).toBe(false);
  });
  it('title_includes is any-of, case-insensitive', () => {
    expect(matchesRule({ title_includes: ['umbreon', 'charizard'] }, deal(), NOW)).toBe(true);
    expect(matchesRule({ title_includes: ['pikachu'] }, deal(), NOW)).toBe(false);
  });
});

describe('analysisPriority', () => {
  it('manual always wins', () => {
    expect(analysisPriority('manual', null, NOW)).toBe(1000);
  });
  it('auction urgency ladder', () => {
    const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();
    expect(analysisPriority('auto', at(1), NOW)).toBe(900);
    expect(analysisPriority('auto', at(3), NOW)).toBe(800);
    expect(analysisPriority('auto', at(12), NOW)).toBe(700);
    expect(analysisPriority('auto', at(48), NOW)).toBe(500);
    expect(analysisPriority('auto', null, NOW)).toBe(500); // BIN
  });
});

describe('ruleToGetDealsFilters', () => {
  it('projects criteria onto get_deals vocabulary', () => {
    expect(
      ruleToGetDealsFilters({
        source: 'ebay',
        tiers: ['steal'],
        min_discount_pct: 35,
        max_price: 300,
        auction_only: true,
        ends_within_h: 24,
      }),
    ).toEqual({
      limit: 100,
      source: 'ebay',
      tier: 'steal',
      min_discount_pct: 35,
      max_price: 300,
      auction_only: true,
      ends_within: 24,
    });
  });
  it('multi-tier rules stay broad server-side (client re-check narrows)', () => {
    const f = ruleToGetDealsFilters({ tiers: ['steal', 'great-deal'] });
    expect(f.tier).toBeUndefined();
  });
});
