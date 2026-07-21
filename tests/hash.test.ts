import { describe, expect, it } from 'vitest';
import {
  cdnUrl,
  extractEbayItemId,
  extractHashFromDealUrl,
  extractHashesFromHtml,
  filterGalleryHashes,
  hashSuffixMatches,
} from '../server/images/hash.js';
import { loadFixture } from './helpers.js';

const PRIMARY = 'qWkAAOSwAbc12def';

describe('extractHashFromDealUrl', () => {
  it('pulls the :g:<HASH> segment', () => {
    expect(
      extractHashFromDealUrl('https://www.ebay.com/itm/335559990001?hash=item4e1c2f3a4b:g:qWkAAOSwAbc12def'),
    ).toBe(PRIMARY);
  });
  it('returns null when absent', () => {
    expect(extractHashFromDealUrl('https://www.ebay.com/itm/123')).toBeNull();
  });
});

describe('hashSuffixMatches ([-5:-1] rule)', () => {
  it('matches own-gallery hashes', () => {
    expect(hashSuffixMatches('AbCAAOSwXyZ12dew', PRIMARY)).toBe(true);
    expect(hashSuffixMatches('TuVAAOSwGhI12dez', PRIMARY)).toBe(true);
  });
  it('rejects similar-items junk', () => {
    expect(hashSuffixMatches('zzzAAOSwJunk99ab', PRIMARY)).toBe(false);
    expect(hashSuffixMatches('yyxAAOSwOthr55cd', PRIMARY)).toBe(false);
  });
  it('rejects too-short hashes', () => {
    expect(hashSuffixMatches('abc', PRIMARY)).toBe(false);
  });
});

describe('gallery extraction end-to-end against listing.html fixture', () => {
  it('keeps own gallery, drops junk, primary first', () => {
    const html = loadFixture('listing.html');
    const candidates = extractHashesFromHtml(html);
    expect(candidates).toContain('zzzAAOSwJunk99ab'); // junk present pre-filter
    const gallery = filterGalleryHashes(candidates, PRIMARY);
    expect(gallery[0]).toBe(PRIMARY);
    expect(gallery).toContain('AbCAAOSwXyZ12dew');
    expect(gallery).toContain('PqRAAOSwLmN12deq');
    expect(gallery).toContain('TuVAAOSwGhI12dez');
    expect(gallery).not.toContain('zzzAAOSwJunk99ab');
    expect(gallery).not.toContain('yyxAAOSwOthr55cd');
    expect(gallery).not.toContain('wwwAAOSwSpam31ef');
    expect(new Set(gallery).size).toBe(gallery.length); // deduped
  });
});

describe('cdnUrl / extractEbayItemId', () => {
  it('builds full-res CDN URLs', () => {
    expect(cdnUrl(PRIMARY)).toBe(`https://i.ebayimg.com/images/g/${PRIMARY}/s-l1600.jpg`);
  });
  it('extracts the legacy id from the deal id', () => {
    expect(extractEbayItemId('pt_lst_v1|335559990001|0')).toBe('335559990001');
  });
  it('falls back to the /itm/ URL', () => {
    expect(extractEbayItemId('weird', 'https://www.ebay.com/itm/145220334455?x=1')).toBe('145220334455');
    expect(extractEbayItemId('weird', 'https://www.ebay.com/itm/some-title/145220334455')).toBe('145220334455');
  });
});
