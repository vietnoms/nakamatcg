import type { DealRow } from '../../shared/types.js';
import type { EbayItemContext, ImageUrlSource } from './types.js';

const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const BROWSE_BY_LEGACY = 'https://api.ebay.com/buy/browse/v1/item/get_item_by_legacy_id';

const MARKETPLACE_IDS: Record<string, string> = {
  ebay: 'EBAY_US',
  'ebay-us': 'EBAY_US',
  'ebay-uk': 'EBAY_GB',
  'ebay-de': 'EBAY_DE',
  'ebay-au': 'EBAY_AU',
  'ebay-ca': 'EBAY_CA',
};

export function normalizeToFullRes(url: string): string {
  return url.replace(/s-l\d+(\.\w+)$/, 's-l1600$1');
}

export class EbayBrowseSource implements ImageUrlSource {
  readonly name = 'ebay_api' as const;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly creds: { clientId?: string; clientSecret?: string },
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  available(): boolean {
    return Boolean(this.creds.clientId && this.creds.clientSecret);
  }

  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAt - now > 5 * 60_000) return this.token.value;
    const basic = Buffer.from(`${this.creds.clientId}:${this.creds.clientSecret}`).toString('base64');
    const res = await this.fetchFn(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'https://api.ebay.com/oauth/api_scope',
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      throw new Error(`eBay OAuth failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    }
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, expiresAt: now + body.expires_in * 1000 };
    return body.access_token;
  }

  async fetchImageUrls(deal: DealRow): Promise<{ urls: string[]; context?: EbayItemContext }> {
    if (!deal.ebay_item_id) throw new Error('deal has no eBay legacy item id');
    const token = await this.getToken();
    const marketplaceId = MARKETPLACE_IDS[deal.marketplace.toLowerCase()] ?? 'EBAY_US';
    const url = `${BROWSE_BY_LEGACY}?legacy_item_id=${encodeURIComponent(deal.ebay_item_id)}`;
    const res = await this.fetchFn(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': marketplaceId,
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401) {
      this.token = null; // force re-auth next attempt
      throw new Error('eBay Browse API: token rejected (401)');
    }
    if (!res.ok) {
      throw new Error(`eBay Browse API: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    }
    const item = (await res.json()) as {
      image?: { imageUrl?: string };
      additionalImages?: Array<{ imageUrl?: string }>;
      condition?: string;
      localizedAspects?: Array<{ name?: string; value?: string }>;
    };
    const urls: string[] = [];
    if (item.image?.imageUrl) urls.push(normalizeToFullRes(item.image.imageUrl));
    for (const img of item.additionalImages ?? []) {
      if (img.imageUrl) urls.push(normalizeToFullRes(img.imageUrl));
    }
    const specifics: Record<string, string> = {};
    for (const a of item.localizedAspects ?? []) {
      if (a.name && a.value) specifics[a.name] = a.value;
    }
    const context: EbayItemContext = {};
    if (item.condition) context.condition = item.condition;
    if (Object.keys(specifics).length > 0) context.item_specifics = specifics;
    return { urls: [...new Set(urls)], context };
  }
}
