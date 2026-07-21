// Live check: the full 3-tier image chain against one real deal.
// Writes normalized JPEGs to ./tmp for eyeballing. To force tier 2 (Playwright),
// temporarily unset EBAY_CLIENT_ID in .env and re-run — this is the real test of
// beating eBay's TLS block with installed Chrome.
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadEnv } from '../server/env.js';
import { acquireImages } from '../server/images/chain.js';
import { EbayBrowseSource } from '../server/images/ebayApi.js';
import { PlaywrightScrapeSource } from '../server/images/playwrightScrape.js';
import { PrimaryOnlySource } from '../server/images/primaryOnly.js';
import { PalletTradeClient, dealFromPayload } from '../server/mcp/palletTrade.js';
import type { DealRow } from '../shared/types.js';

const env = loadEnv();
if (!env.PALLET_TRADE_TOKEN) {
  console.error('FAIL: PALLET_TRADE_TOKEN missing');
  process.exit(1);
}

const mcp = new PalletTradeClient({ url: env.PALLET_TRADE_MCP_URL, token: env.PALLET_TRADE_TOKEN });
const rows = await mcp.getDeals({ source: 'ebay', limit: 5 });
await mcp.close();
const deal = rows.map((r) => dealFromPayload(r)).find((d) => d?.ebay_item_id) as DealRow | undefined;
if (!deal) {
  console.error('FAIL: no eBay deal in the live feed to test with');
  process.exit(1);
}
console.log(`Deal: ${deal.title}`);
console.log(`URL:  ${deal.url}`);

const playwright = new PlaywrightScrapeSource();
const sources = [
  new EbayBrowseSource({ clientId: env.EBAY_CLIENT_ID, clientSecret: env.EBAY_CLIENT_SECRET }),
  playwright,
  new PrimaryOnlySource(),
];

try {
  const result = await acquireImages(deal, sources, {
    maxImages: 12,
    log: { info: console.log, warn: console.warn },
  });
  console.log(`OK: tier=${result.source} images=${result.images.length} degraded=${result.degraded}`);
  mkdirSync('tmp', { recursive: true });
  result.images.forEach((img, i) => {
    const p = `tmp/smoke-image-${i + 1}.jpg`;
    writeFileSync(p, img.buffer);
    console.log(`  wrote ${p} (${img.width}x${img.height}, ${Math.round(img.bytes / 1024)}KB)`);
  });
  console.log('PASS — inspect ./tmp visually');
} catch (err) {
  console.error('FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  await playwright.close();
}
