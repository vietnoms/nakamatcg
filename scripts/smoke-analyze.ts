// Live check: one end-to-end Claude analysis (~$0.03–0.10 depending on model).
// Requires PALLET_TRADE_TOKEN + ANTHROPIC_API_KEY (+ eBay creds recommended).
import { loadEnv } from '../server/env.js';
import { acquireImages } from '../server/images/chain.js';
import { EbayBrowseSource } from '../server/images/ebayApi.js';
import { PlaywrightScrapeSource } from '../server/images/playwrightScrape.js';
import { PrimaryOnlySource } from '../server/images/primaryOnly.js';
import { Analyzer } from '../server/analysis/analyzer.js';
import { PalletTradeClient, dealFromPayload } from '../server/mcp/palletTrade.js';
import type { DealRow } from '../shared/types.js';

const env = loadEnv();
if (!env.PALLET_TRADE_TOKEN || !env.ANTHROPIC_API_KEY) {
  console.error('FAIL: PALLET_TRADE_TOKEN and ANTHROPIC_API_KEY required');
  process.exit(1);
}
const model = process.argv[2] ?? 'claude-sonnet-5';

const mcp = new PalletTradeClient({ url: env.PALLET_TRADE_MCP_URL, token: env.PALLET_TRADE_TOKEN });
const rows = await mcp.getDeals({ source: 'ebay', limit: 5 });
await mcp.close();
const deal = rows.map((r) => dealFromPayload(r)).find((d) => d?.ebay_item_id) as DealRow | undefined;
if (!deal) {
  console.error('FAIL: no eBay deal available');
  process.exit(1);
}
console.log(`Analyzing: ${deal.title} ($${deal.price_total}, ${deal.percent_below_market}% off)`);

const playwright = new PlaywrightScrapeSource();
try {
  const images = await acquireImages(
    deal,
    [
      new EbayBrowseSource({ clientId: env.EBAY_CLIENT_ID, clientSecret: env.EBAY_CLIENT_SECRET }),
      playwright,
      new PrimaryOnlySource(),
    ],
    { maxImages: 12, log: { info: console.log, warn: console.warn } },
  );
  console.log(`images: ${images.images.length} via ${images.source} (degraded=${images.degraded})`);

  const analyzer = new Analyzer({ apiKey: env.ANTHROPIC_API_KEY });
  const t0 = Date.now();
  const { verdict, usage } = await analyzer.analyze(deal, images, { model, effort: 'medium' });
  console.log(`\n=== VERDICT (${((Date.now() - t0) / 1000).toFixed(1)}s) ===`);
  console.log(JSON.stringify(verdict, null, 2));
  console.log(
    `\ntokens: ${usage.input_tokens} in / ${usage.output_tokens} out → $${usage.cost_usd} (${model})`,
  );
  console.log('PASS');
} catch (err) {
  console.error('FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  await playwright.close();
}
