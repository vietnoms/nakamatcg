// Live check: PalletTrade MCP handshake + get_deals. Requires PALLET_TRADE_TOKEN in .env.
import { loadEnv } from '../server/env.js';
import { PalletTradeClient, dealFromPayload } from '../server/mcp/palletTrade.js';

const env = loadEnv();
if (!env.PALLET_TRADE_TOKEN) {
  console.error('FAIL: PALLET_TRADE_TOKEN missing in .env');
  process.exit(1);
}

const mcp = new PalletTradeClient({ url: env.PALLET_TRADE_MCP_URL, token: env.PALLET_TRADE_TOKEN });
try {
  const rows = await mcp.getDeals({ limit: 10 });
  console.log(`OK: get_deals returned ${rows.length} deals`);
  for (const row of rows.slice(0, 5)) {
    const d = dealFromPayload(row);
    if (!d) {
      console.log('  (unparseable payload)', JSON.stringify(row).slice(0, 200));
      continue;
    }
    console.log(
      `  ${d.deal_tier ?? '?'}  ${d.percent_below_market ?? '?'}% off  $${d.price_total}  ${d.listing_type}  ${d.title.slice(0, 70)}`,
    );
    console.log(`    id=${d.id} ebay=${d.ebay_item_id} hash=${d.primary_image_hash ?? 'NONE'}`);
  }
  if (rows.length > 0 && rows.every((r) => dealFromPayload(r) === null)) {
    console.error('WARN: no payload parsed — deal shape may have drifted; check raw output above');
    process.exit(2);
  }
  console.log('PASS');
} catch (err) {
  console.error('FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  await mcp.close();
}
