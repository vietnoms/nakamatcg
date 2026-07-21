import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { acquireImages, downloadAndNormalize, NoImagesError } from '../server/images/chain.js';
import type { ImageUrlSource } from '../server/images/types.js';
import { dealFromPayload } from '../server/mcp/palletTrade.js';
import { fixtureDeals } from './helpers.js';
import type { DealRow } from '../shared/types.js';

let bigJpeg: Buffer; // 1800×1200 — must be downscaled to ≤1568 long edge

beforeAll(async () => {
  // noise stripes make the JPEG large enough to clear the min-size validation
  const raw = Buffer.alloc(1800 * 1200 * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 7919) % 251;
  bigJpeg = await sharp(raw, { raw: { width: 1800, height: 1200, channels: 3 } })
    .jpeg({ quality: 90 })
    .toBuffer();
});

function deal(): DealRow {
  return dealFromPayload(fixtureDeals()[0])! as unknown as DealRow;
}

function imageResponse(buf: Buffer): Response {
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: { 'content-type': 'image/jpeg' },
  });
}

describe('downloadAndNormalize', () => {
  it('downscales to ≤1568px long edge and re-encodes JPEG', async () => {
    const fakeFetch = (async () => imageResponse(bigJpeg)) as typeof fetch;
    const img = await downloadAndNormalize('https://i.ebayimg.test/a.jpg', fakeFetch);
    expect(img).not.toBeNull();
    expect(Math.max(img!.width, img!.height)).toBeLessThanOrEqual(1568);
    expect(img!.bytes).toBeLessThanOrEqual(900_000);
  });

  it('rejects non-image content types', async () => {
    const fakeFetch = (async () =>
      new Response('<html>blocked</html>', { status: 200, headers: { 'content-type': 'text/html' } })) as typeof fetch;
    expect(await downloadAndNormalize('https://x.test/a.jpg', fakeFetch)).toBeNull();
  });

  it('rejects tiny payloads (tracking pixels, error stubs)', async () => {
    const fakeFetch = (async () => imageResponse(Buffer.alloc(100))) as typeof fetch;
    expect(await downloadAndNormalize('https://x.test/a.jpg', fakeFetch)).toBeNull();
  });

  it('rejects undecodable bytes', async () => {
    const junk = Buffer.alloc(10_000, 0x41);
    const fakeFetch = (async () => imageResponse(junk)) as typeof fetch;
    expect(await downloadAndNormalize('https://x.test/a.jpg', fakeFetch)).toBeNull();
  });
});

function source(name: 'ebay_api' | 'playwright' | 'primary_only', urls: string[] | Error, available = true): ImageUrlSource {
  return {
    name,
    available: () => available,
    fetchImageUrls: async () => {
      if (urls instanceof Error) throw urls;
      return { urls };
    },
  };
}

describe('acquireImages tier fallback', () => {
  it('uses the first tier that yields validated images', async () => {
    const fakeFetch = (async () => imageResponse(bigJpeg)) as typeof fetch;
    const result = await acquireImages(
      deal(),
      [source('ebay_api', ['https://i.test/1.jpg', 'https://i.test/2.jpg']), source('playwright', new Error('nope'))],
      { maxImages: 12, fetchFn: fakeFetch },
    );
    expect(result.source).toBe('ebay_api');
    expect(result.images).toHaveLength(2);
    expect(result.degraded).toBe(false);
  });

  it('falls through failing/unconfigured tiers to primary_only and flags degraded', async () => {
    const fakeFetch = (async () => imageResponse(bigJpeg)) as typeof fetch;
    const result = await acquireImages(
      deal(),
      [
        source('ebay_api', [], false), // not configured
        source('playwright', new Error('chrome missing')),
        source('primary_only', ['https://i.test/primary.jpg']),
      ],
      { maxImages: 12, fetchFn: fakeFetch },
    );
    expect(result.source).toBe('primary_only');
    expect(result.degraded).toBe(true);
    expect(result.images).toHaveLength(1);
  });

  it('a tier whose downloads all fail validation falls through', async () => {
    const htmlFetch = (async (url: Parameters<typeof fetch>[0]) => {
      if (String(url).includes('tier1')) {
        return new Response('nope', { status: 200, headers: { 'content-type': 'text/html' } });
      }
      return imageResponse(bigJpeg);
    }) as typeof fetch;
    const result = await acquireImages(
      deal(),
      [source('ebay_api', ['https://i.test/tier1/a.jpg']), source('primary_only', ['https://i.test/ok.jpg'])],
      { maxImages: 12, fetchFn: htmlFetch },
    );
    expect(result.source).toBe('primary_only');
  });

  it('caps images at maxImages', async () => {
    const fakeFetch = (async () => imageResponse(bigJpeg)) as typeof fetch;
    const urls = Array.from({ length: 20 }, (_, i) => `https://i.test/${i}.jpg`);
    const result = await acquireImages(deal(), [source('ebay_api', urls)], {
      maxImages: 12,
      fetchFn: fakeFetch,
    });
    expect(result.images).toHaveLength(12);
  });

  it('throws NoImagesError with per-tier reasons when everything fails', async () => {
    const fakeFetch = (async () => new Response('x', { status: 404 })) as typeof fetch;
    await expect(
      acquireImages(deal(), [source('ebay_api', new Error('quota')), source('primary_only', ['https://i.test/p.jpg'])], {
        maxImages: 12,
        fetchFn: fakeFetch,
      }),
    ).rejects.toThrow(NoImagesError);
  });
});
