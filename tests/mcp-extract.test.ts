import { describe, expect, it } from 'vitest';
import { dealFromPayload, extractDealsFromToolResult } from '../server/mcp/palletTrade.js';
import { fixtureDeals } from './helpers.js';

describe('extractDealsFromToolResult', () => {
  const deals = fixtureDeals();

  it('reads structuredContent arrays', () => {
    expect(extractDealsFromToolResult({ structuredContent: deals })).toHaveLength(2);
  });
  it('reads {deals: []} wrappers', () => {
    expect(extractDealsFromToolResult({ structuredContent: { deals } })).toHaveLength(2);
  });
  it('reads JSON text content blocks', () => {
    expect(
      extractDealsFromToolResult({ content: [{ type: 'text', text: JSON.stringify({ results: deals }) }] }),
    ).toHaveLength(2);
  });
  it('treats a single-deal object as a one-element list (get_deal)', () => {
    expect(extractDealsFromToolResult({ structuredContent: deals[0] })).toHaveLength(1);
  });
  it('returns [] for garbage', () => {
    expect(extractDealsFromToolResult({ content: [{ type: 'text', text: 'not json' }] })).toEqual([]);
  });
});

describe('dealFromPayload', () => {
  it('maps the fixture deal onto the deals table shape', () => {
    const d = dealFromPayload(fixtureDeals()[0])!;
    expect(d.id).toBe('pt_lst_v1|335559990001|0');
    expect(d.ebay_item_id).toBe('335559990001');
    expect(d.listing_type).toBe('auction');
    expect(d.card_name).toContain('Umbreon');
    expect(d.grader).toBe('PSA');
    expect(d.grade).toBe(9);
    expect(d.percent_below_market).toBe(37);
    expect(d.deal_tier).toBe('steal');
    expect(d.primary_image_hash).toBe('qWkAAOSwAbc12def');
    expect(JSON.parse(d.raw_json)).toMatchObject({ id: d.id });
  });
  it('handles string grades and missing signal', () => {
    const d = dealFromPayload({
      id: 'pt_lst_v1|1|0',
      url: 'https://www.ebay.com/itm/1',
      price_total: 10,
      match: { grade: '9.5' },
    })!;
    expect(d.grade).toBe(9.5);
    expect(d.deal_tier).toBeNull();
    expect(d.title).toBe('(untitled listing)');
  });
  it('returns null for unusable rows', () => {
    expect(dealFromPayload({ nope: true })).toBeNull();
    expect(dealFromPayload(null)).toBeNull();
  });
});
