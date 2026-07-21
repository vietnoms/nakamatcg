import type { DealRow, ImageSourceName } from '../../shared/types.js';

export interface AcquiredImage {
  url: string;
  buffer: Buffer;
  width: number;
  height: number;
  bytes: number;
}

/** Extra listing context tier 1 (eBay Browse API) can contribute to the analysis prompt. */
export interface EbayItemContext {
  condition?: string;
  item_specifics?: Record<string, string>;
}

export interface ImageFetchResult {
  source: ImageSourceName;
  images: AcquiredImage[];
  degraded: boolean; // true only for primary_only → analyzer caps confidence at LOW
  context?: EbayItemContext;
}

export interface ImageUrlSource {
  name: ImageSourceName;
  available(): boolean;
  /** Return full-res image URLs (i.ebayimg.com), primary first when known. */
  fetchImageUrls(deal: DealRow): Promise<{ urls: string[]; context?: EbayItemContext }>;
}
