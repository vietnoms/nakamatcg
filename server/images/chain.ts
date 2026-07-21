import sharp from 'sharp';
import type { DealRow } from '../../shared/types.js';
import type { AcquiredImage, ImageFetchResult, ImageUrlSource } from './types.js';

const MAX_EDGE_PX = 1568; // ≤1568px long edge ≈ (w×h)/750 ≈ 1,600 tokens per image
const MAX_BYTES = 900_000; // stays far below the API's 5MB/image cap after base64 (~1.37×)
const MIN_BYTES = 5_000; // smaller than this is a tracking pixel / error page, not a photo
const DOWNLOAD_TIMEOUT_MS = 15_000;
const DOWNLOAD_CONCURRENCY = 3;

export interface ChainLogger {
  info(msg: string): void;
  warn(msg: string): void;
}

export class NoImagesError extends Error {
  constructor(public readonly tierErrors: Record<string, string>) {
    super(
      `all image tiers failed: ${Object.entries(tierErrors)
        .map(([k, v]) => `${k}: ${v}`)
        .join(' | ')}`,
    );
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function downloadAndNormalize(
  url: string,
  fetchFn: typeof fetch = fetch,
): Promise<AcquiredImage | null> {
  let res: Response;
  try {
    res = await fetchFn(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.startsWith('image/')) return null;
  const raw = Buffer.from(await res.arrayBuffer());
  if (raw.byteLength < MIN_BYTES) return null;

  try {
    let out = await sharp(raw)
      .rotate() // honor EXIF orientation
      .resize(MAX_EDGE_PX, MAX_EDGE_PX, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    if (out.byteLength > MAX_BYTES) {
      out = await sharp(raw)
        .rotate()
        .resize(MAX_EDGE_PX, MAX_EDGE_PX, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 70 })
        .toBuffer();
      if (out.byteLength > MAX_BYTES) return null;
    }
    const meta = await sharp(out).metadata();
    return {
      url,
      buffer: out,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      bytes: out.byteLength,
    };
  } catch {
    return null; // undecodable → not a usable photo
  }
}

/**
 * The 3-tier acquisition chain. Tries each source in order; the first tier that
 * yields ≥1 validated, normalized image wins. Throws NoImagesError when every
 * tier fails — an analysis never proceeds with zero images.
 */
export async function acquireImages(
  deal: DealRow,
  sources: ImageUrlSource[],
  opts: { maxImages: number; fetchFn?: typeof fetch; log?: ChainLogger },
): Promise<ImageFetchResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  const log = opts.log ?? { info: () => {}, warn: () => {} };
  const tierErrors: Record<string, string> = {};

  for (const source of sources) {
    if (!source.available()) {
      tierErrors[source.name] = 'not configured';
      continue;
    }
    try {
      const { urls, context } = await source.fetchImageUrls(deal);
      if (urls.length === 0) throw new Error('returned no image URLs');
      const capped = urls.slice(0, opts.maxImages);
      const downloaded = await mapLimit(capped, DOWNLOAD_CONCURRENCY, (u) =>
        downloadAndNormalize(u, fetchFn),
      );
      const images = downloaded.filter((i): i is AcquiredImage => i !== null);
      if (images.length === 0) throw new Error('no downloaded image passed validation');
      log.info(
        `images: tier ${source.name} → ${images.length}/${capped.length} images for ${deal.id}`,
      );
      return {
        source: source.name,
        images,
        degraded: source.name === 'primary_only',
        ...(context ? { context } : {}),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      tierErrors[source.name] = msg;
      log.warn(`images: tier ${source.name} failed for ${deal.id}: ${msg}`);
    }
  }
  throw new NoImagesError(tierErrors);
}
