import { describe, expect, it } from 'vitest';
import { dealFromPayload } from '../server/mcp/palletTrade.js';
import { fixtureDeals, makeWorld, seedFixtureDeals } from './helpers.js';

describe('deals repo upsert', () => {
  it('reports insert vs update and keeps first_seen_at stable', () => {
    const w = makeWorld();
    const payload = fixtureDeals()[0] as Record<string, unknown>;
    const deal = dealFromPayload(payload)!;

    expect(w.deals.upsert(deal)).toBe(true); // NEW
    const first = w.deals.getById(deal.id)!;

    const updated = { ...deal, price_total: 999, current_bid: 999 };
    expect(w.deals.upsert(updated)).toBe(false); // existing
    const second = w.deals.getById(deal.id)!;

    expect(second.price_total).toBe(999);
    expect(second.first_seen_at).toBe(first.first_seen_at);
    expect(second.title).toBe(first.title);
  });
});

describe('deals repo query filters', () => {
  it('filters by tier, price, listing type and joins latest analysis', () => {
    const w = makeWorld();
    seedFixtureDeals(w);

    expect(w.deals.query({}).deals).toHaveLength(2);
    const steals = w.deals.query({ tiers: ['steal'] });
    expect(steals.deals).toHaveLength(1);
    expect(steals.deals[0]!.deal.deal_tier).toBe('steal');

    expect(w.deals.query({ max_price: 250 }).deals).toHaveLength(1);
    expect(w.deals.query({ auction_only: true }).deals).toHaveLength(1);
    expect(w.deals.query({ bin_only: true }).deals).toHaveLength(1);
    expect(w.deals.query({ min_discount: 30 }).deals).toHaveLength(1);
    expect(w.deals.query({ grader: 'psa' }).deals).toHaveLength(1); // case-insensitive

    // no analyses yet
    expect(w.deals.query({}).deals.every((d) => d.latest_analysis === null)).toBe(true);

    // latest analysis joined after insert
    const id = w.deals.query({ tiers: ['steal'] }).deals[0]!.deal.id;
    w.analyses.insertManual(id, 'claude-sonnet-5', 'medium');
    const withAnalysis = w.deals.query({ tiers: ['steal'] }).deals[0]!;
    expect(withAnalysis.latest_analysis?.status).toBe('queued');
  });

  it('active_only hides ended auctions', () => {
    const w = makeWorld();
    const payload = fixtureDeals()[0] as Record<string, unknown>;
    const deal = dealFromPayload(payload)!;
    deal.ends_at = '2020-01-01T00:00:00Z'; // already ended
    w.deals.upsert(deal);

    expect(w.deals.query({}).deals).toHaveLength(0); // active_only defaults on
    expect(w.deals.query({ active_only: false }).deals).toHaveLength(1);
  });
});
