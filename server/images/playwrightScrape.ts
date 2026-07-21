import type { Browser } from 'playwright';
import type { DealRow } from '../../shared/types.js';
import { cdnUrl, extractHashesFromHtml, filterGalleryHashes } from './hash.js';
import type { ImageUrlSource } from './types.js';

const IDLE_CLOSE_MS = 5 * 60_000;

/**
 * Tier 2: scrape the listing page with a real browser. On the user's Windows box this
 * launches installed Chrome (`channel: 'chrome'`) — a genuine Chrome TLS fingerprint is
 * what gets past eBay's TLS-fingerprint block (curl/PowerShell get 403). The bundled
 * chromium fallback exists for structural tests in CI/containers only.
 */
export class PlaywrightScrapeSource implements ImageUrlSource {
  readonly name = 'playwright' as const;
  private browser: Browser | null = null;
  private idleTimer: NodeJS.Timeout | null = null;

  available(): boolean {
    return true;
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    const { chromium } = await import('playwright');
    try {
      this.browser = await chromium.launch({ channel: 'chrome', headless: true });
    } catch {
      // No installed Chrome (e.g. CI container) — bundled chromium. Note: this will
      // NOT beat eBay's TLS fingerprinting; real scraping requires real Chrome.
      this.browser = await chromium.launch({ headless: true });
    }
    return this.browser;
  }

  private scheduleIdleClose(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      void this.close();
    }, IDLE_CLOSE_MS);
    this.idleTimer.unref?.();
  }

  async fetchImageUrls(deal: DealRow): Promise<{ urls: string[] }> {
    if (!deal.primary_image_hash) {
      throw new Error('no primary image hash in deal URL — cannot filter scraped gallery');
    }
    const html = await this.fetchListingHtml(deal.url);
    const candidates = extractHashesFromHtml(html);
    const gallery = filterGalleryHashes(candidates, deal.primary_image_hash);
    return { urls: gallery.map((h) => cdnUrl(h, 's-l1600')) };
  }

  /** Exposed for smoke scripts; separated so hash filtering stays pure/testable. */
  async fetchListingHtml(url: string): Promise<string> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      return await page.content();
    } finally {
      await page.close().catch(() => {});
      this.scheduleIdleClose();
    }
  }

  async close(): Promise<void> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    const b = this.browser;
    this.browser = null;
    await b?.close().catch(() => {});
  }
}
