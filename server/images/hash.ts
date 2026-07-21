// Pure functions around eBay image hashes. Kept dependency-free for easy testing.

/** Extract the primary photo hash from a PalletTrade deal URL (`...:g:<HASH>` segment). */
export function extractHashFromDealUrl(url: string): string | null {
  const m = /:g:([A-Za-z0-9~_-]+)/.exec(url);
  return m?.[1] ?? null;
}

/** Extract all candidate gallery hashes from raw listing HTML. */
export function extractHashesFromHtml(html: string): string[] {
  const out = new Set<string>();
  const re = /\/images\/g\/([A-Za-z0-9~_-]+)\//g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[1]) out.add(m[1]);
  }
  return [...out];
}

/**
 * A listing's own gallery photos share the hash suffix characters at [-5:-1]
 * with the listing's primary hash; "similar items" junk images embedded in the
 * page HTML do not. (Verified empirically in a prior session.)
 */
export function hashSuffixMatches(candidate: string, primary: string): boolean {
  if (candidate.length < 5 || primary.length < 5) return false;
  return candidate.slice(-5, -1) === primary.slice(-5, -1);
}

/** Keep only own-gallery hashes; the primary is always included and listed first. */
export function filterGalleryHashes(candidates: string[], primary: string): string[] {
  const kept = candidates.filter((c) => c !== primary && hashSuffixMatches(c, primary));
  return [primary, ...kept];
}

export function cdnUrl(hash: string, size: 's-l1600' | 's-l500' | 's-l225' | 's-l140' = 's-l1600'): string {
  return `https://i.ebayimg.com/images/g/${hash}/${size}.jpg`;
}

/** Extract the eBay legacy item id from a PalletTrade deal id ("pt_lst_v1|<id>|0") or listing URL. */
export function extractEbayItemId(dealId: string, url?: string): string | null {
  const parts = dealId.split('|');
  if (parts.length >= 2 && /^\d+$/.test(parts[1] ?? '')) return parts[1] ?? null;
  if (url) {
    const m = /\/itm\/(?:[^/]+\/)?(\d+)/.exec(url);
    if (m?.[1]) return m[1];
  }
  return null;
}
