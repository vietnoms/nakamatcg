import { describe, expect, it, vi } from 'vitest';
import { buildEmbed, computeUrgency, DiscordNotifier } from '../server/notify/discord.js';
import { dealFromPayload } from '../server/mcp/palletTrade.js';
import { VerdictSchema } from '../shared/verdict.js';
import { fixtureDeals } from './helpers.js';
import type { AnalysisRow, DealRow } from '../shared/types.js';

const NOW = new Date('2030-06-01T00:00:00Z');

function deal(overrides: Partial<DealRow> = {}): DealRow {
  const base = dealFromPayload(fixtureDeals()[0])! as unknown as DealRow;
  return { ...base, first_seen_at: '', last_seen_at: '', ...overrides };
}

const analysis = {
  id: 123,
  deal_id: 'pt_lst_v1|335559990001|0',
  trig: 'auto',
  rule_id: 1,
  status: 'done',
  image_source: 'ebay_api',
  image_count: 8,
  model: 'claude-sonnet-5',
  effort: 'medium',
  verdict_json: null,
  assessed_condition: 'LP',
  claim_match: 'WORSE',
  recommendation: 'BUY',
  confidence: 'HIGH',
  input_tokens: 18000,
  output_tokens: 1000,
  cost_usd: 0.069,
  attempts: 0,
  error: null,
  created_at: '',
  started_at: null,
  completed_at: '2030-06-01T00:00:00Z',
} as AnalysisRow;

const verdict = VerdictSchema.parse({
  assessed_condition: 'NM',
  condition_rationale: 'sharp corners all around',
  claim_match: 'MATCHES',
  flaws: [
    { type: 'whitening', severity: 'moderate', location: 'back bottom edge', photo_index: 4, description: 'x' },
    { type: 'scratch', severity: 'minor', location: 'front surface', photo_index: 2, description: 'y' },
  ],
  red_flags: ['seller has stock-photo history'],
  recommendation: 'BUY',
  confidence: 'HIGH',
  confidence_reason: 'full gallery',
  summary: 'Solid buy at 37% below market.',
});

describe('computeUrgency', () => {
  it('flags auctions ending within 2h', () => {
    const soon = new Date(NOW.getTime() + 30 * 60_000).toISOString();
    expect(computeUrgency(deal({ ends_at: soon }), NOW)).toBe('ending_soon');
  });
  it('normal for far-out auctions and BIN', () => {
    expect(computeUrgency(deal(), NOW)).toBe('normal'); // ends in 12h
    expect(computeUrgency(deal({ listing_type: 'fixed_price', ends_at: null }), NOW)).toBe('normal');
  });
});

describe('buildEmbed', () => {
  it('builds a BUY embed with the expected fields', () => {
    const { embeds, content } = buildEmbed(deal(), analysis, verdict, 'normal', NOW);
    const e = embeds[0]!;
    expect(e.title).toMatch(/^BUY — /);
    expect(e.title).toContain('Umbreon VMAX');
    expect(e.color).toBe(0x57f287);
    expect(e.url).toContain('ebay.com/itm/335559990001');
    expect(e.thumbnail?.url).toContain('qWkAAOSwAbc12def/s-l500.jpg');
    const names = e.fields.map((f) => f.name);
    expect(names).toEqual(
      expect.arrayContaining(['Price', 'Discount', 'Verdict', 'Condition', 'Top flaws', 'Auction', 'Red flags']),
    );
    expect(e.fields.find((f) => f.name === 'Auction')!.value).toMatch(/<t:\d+:R>/);
    expect(e.fields.find((f) => f.name === 'Top flaws')!.value).toContain('photo 4');
    expect(e.footer.text).toContain('analysis #123');
    expect(content).toBeUndefined();
  });

  it('urgent BUY goes red with [ENDING SOON] and a content line', () => {
    const soon = new Date(NOW.getTime() + 45 * 60_000).toISOString();
    const { embeds, content } = buildEmbed(deal({ ends_at: soon }), analysis, verdict, 'ending_soon', NOW);
    expect(embeds[0]!.color).toBe(0xed4245);
    expect(embeds[0]!.title).toMatch(/^\[ENDING SOON\] /);
    expect(content).toMatch(/Auction ends soon/);
  });
});

describe('DiscordNotifier 429 handling', () => {
  it('honors retry_after then succeeds', async () => {
    const calls: number[] = [];
    const fakeFetch = vi.fn(async () => {
      calls.push(Date.now());
      if (calls.length === 1) {
        return new Response(JSON.stringify({ retry_after: 0.02 }), { status: 429 });
      }
      return new Response(null, { status: 204 });
    });
    const notifier = new DiscordNotifier('https://discord.test/webhook', fakeFetch as unknown as typeof fetch);
    await notifier.send({ embeds: [] });
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  it('throws on non-429 4xx', async () => {
    const fakeFetch = vi.fn(async () => new Response('bad webhook', { status: 404 }));
    const notifier = new DiscordNotifier('https://discord.test/webhook', fakeFetch as unknown as typeof fetch);
    await expect(notifier.send({ embeds: [] })).rejects.toThrow(/HTTP 404/);
  });
});
