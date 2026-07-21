import { describe, expect, it, vi } from 'vitest';
import { EbayBrowseSource, normalizeToFullRes } from '../server/images/ebayApi.js';
import { dealFromPayload } from '../server/mcp/palletTrade.js';
import { fixtureDeals, loadFixture } from './helpers.js';
import type { DealRow } from '../shared/types.js';

function deal(): DealRow {
  return dealFromPayload(fixtureDeals()[0])! as unknown as DealRow;
}

describe('normalizeToFullRes', () => {
  it('rewrites any s-l size to s-l1600', () => {
    expect(normalizeToFullRes('https://i.ebayimg.com/images/g/abc/s-l500.jpg')).toBe(
      'https://i.ebayimg.com/images/g/abc/s-l1600.jpg',
    );
    expect(normalizeToFullRes('https://i.ebayimg.com/images/g/abc/s-l64.png')).toBe(
      'https://i.ebayimg.com/images/g/abc/s-l1600.png',
    );
  });
});

describe('EbayBrowseSource', () => {
  it('is unavailable without creds', () => {
    expect(new EbayBrowseSource({}).available()).toBe(false);
  });

  it('fetches OAuth token once, then the item, and normalizes image URLs', async () => {
    const fakeFetch = vi.fn(async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const u = String(url);
      if (u.includes('identity/v1/oauth2/token')) {
        expect(String(init?.headers && (init.headers as Record<string, string>).Authorization)).toMatch(/^Basic /);
        return new Response(JSON.stringify({ access_token: 'tok123', expires_in: 7200 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      expect(u).toContain('get_item_by_legacy_id?legacy_item_id=335559990001');
      expect((init?.headers as Record<string, string>)['X-EBAY-C-MARKETPLACE-ID']).toBe('EBAY_US');
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok123');
      return new Response(loadFixture('browse-item.json'), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const src = new EbayBrowseSource({ clientId: 'id', clientSecret: 'sec' }, fakeFetch as unknown as typeof fetch);
    const { urls, context } = await src.fetchImageUrls(deal());
    expect(urls).toEqual([
      'https://i.ebayimg.com/images/g/qWkAAOSwAbc12def/s-l1600.jpg',
      'https://i.ebayimg.com/images/g/AbCAAOSwXyZ12dew/s-l1600.jpg',
      'https://i.ebayimg.com/images/g/PqRAAOSwLmN12deq/s-l1600.jpg',
    ]);
    expect(context?.condition).toBe('Used');
    expect(context?.item_specifics?.Grade).toBe('9');

    // token is cached — a second call must not hit the token endpoint again
    await src.fetchImageUrls(deal());
    const tokenCalls = fakeFetch.mock.calls.filter(([u]) => String(u).includes('oauth2/token'));
    expect(tokenCalls).toHaveLength(1);
  });
});
