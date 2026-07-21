// Live check: eBay OAuth + Browse getItemByLegacyId. Requires EBAY_CLIENT_ID/SECRET.
// Usage: npm run smoke:ebay [-- <ebayItemId>]  (defaults to a deal from the live feed)
import { loadEnv } from '../server/env.js';
import { EbayBrowseSource } from '../server/images/ebayApi.js';
import { PalletTradeClient, dealFromPayload } from '../server/mcp/palletTrade.js';
import type { DealRow } from '../shared/types.js';

const env = loadEnv();
if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) {
  console.error('FAIL: EBAY_CLIENT_ID / EBAY_CLIENT_SECRET missing in .env');
  process.exit(1);
}

let deal: DealRow | null = null;
const argId = process.argv[2];
if (argId) {
  deal = {
    id: `pt_lst_v1|${argId}|0`,
    ebay_item_id: argId,
    marketplace: 'ebay',
    url: `https://www.ebay.com/itm/${argId}`,
  } as DealRow;
} else {
  if (!env.PALLET_TRADE_TOKEN) {
    console.error('FAIL: pass an eBay item id or set PALLET_TRADE_TOKEN to sample the live feed');
    process.exit(1);
  }
  const mcp = new PalletTradeClient({ url: env.PALLET_TRADE_MCP_URL, token: env.PALLET_TRADE_TOKEN });
  const rows = await mcp.getDeals({ source: 'ebay', limit: 5 });
  await mcp.close();
  for (const row of rows) {
    const d = dealFromPayload(row);
    if (d?.ebay_item_id) {
      deal = d as unknown as DealRow;
      break;
    }
  }
}
if (!deal) {
  console.error('FAIL: no deal with an eBay item id available');
  process.exit(1);
}

console.log(`Looking up legacy item ${deal.ebay_item_id} (${deal.url})`);
const src = new EbayBrowseSource({ clientId: env.EBAY_CLIENT_ID, clientSecret: env.EBAY_CLIENT_SECRET });
try {
  const { urls, context } = await src.fetchImageUrls(deal);
  console.log(`OK: ${urls.length} image URLs`);
  urls.forEach((u) => console.log(`  ${u}`));
  if (context?.condition) console.log(`condition: ${context.condition}`);
  if (context?.item_specifics) console.log('specifics:', context.item_specifics);
  console.log('PASS');
} catch (err) {
  console.error('FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
}
