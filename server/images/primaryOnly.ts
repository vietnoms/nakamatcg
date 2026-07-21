import type { DealRow } from '../../shared/types.js';
import { cdnUrl } from './hash.js';
import type { ImageUrlSource } from './types.js';

/** Tier 3 (degraded): only the primary photo, reconstructed from the deal-URL hash. */
export class PrimaryOnlySource implements ImageUrlSource {
  readonly name = 'primary_only' as const;

  available(): boolean {
    return true;
  }

  async fetchImageUrls(deal: DealRow): Promise<{ urls: string[] }> {
    if (!deal.primary_image_hash) throw new Error('no primary image hash in deal URL');
    return { urls: [cdnUrl(deal.primary_image_hash, 's-l1600')] };
  }
}
