// Live end-to-end: poll once → rule match → auto-analysis → Discord embed.
// Uses a throwaway on-disk DB (tmp/smoke-e2e.sqlite) so your real cache is untouched.
// Requires all four integrations configured. Costs one analysis (~$0.03–0.10).
import { rmSync } from 'node:fs';
import { loadEnv } from '../server/env.js';
import { openDb } from '../server/db/db.js';
import { createDealsRepo } from '../server/db/repos/deals.js';
import { createAnalysesRepo } from '../server/db/repos/analyses.js';
import { createRulesRepo } from '../server/db/repos/rules.js';
import { createNotificationsRepo } from '../server/db/repos/notifications.js';
import { createSettingsRepo } from '../server/db/repos/settings.js';
import { createPollsRepo } from '../server/db/repos/polls.js';
import { PalletTradeClient } from '../server/mcp/palletTrade.js';
import { EbayBrowseSource } from '../server/images/ebayApi.js';
import { PlaywrightScrapeSource } from '../server/images/playwrightScrape.js';
import { PrimaryOnlySource } from '../server/images/primaryOnly.js';
import { Analyzer } from '../server/analysis/analyzer.js';
import { DiscordNotifier } from '../server/notify/discord.js';
import { AnalysisQueue } from '../server/queue/analysisQueue.js';
import { Poller } from '../server/poller.js';

const env = loadEnv();
for (const [k, v] of Object.entries({
  PALLET_TRADE_TOKEN: env.PALLET_TRADE_TOKEN,
  ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
  DISCORD_WEBHOOK_URL: env.DISCORD_WEBHOOK_URL,
})) {
  if (!v) {
    console.error(`FAIL: ${k} missing in .env`);
    process.exit(1);
  }
}

const log = { info: console.log, warn: console.warn, error: console.error };
rmSync('tmp/smoke-e2e.sqlite', { force: true });
const db = openDb('tmp/smoke-e2e.sqlite');
const deals = createDealsRepo(db);
const analyses = createAnalysesRepo(db);
const rules = createRulesRepo(db);
const notifications = createNotificationsRepo(db);
const settings = createSettingsRepo(db);
const polls = createPollsRepo(db);

// Notify on every verdict for this smoke run so the embed always fires.
settings.put({ notify_verdicts: ['BUY', 'MAYBE', 'PASS'], max_auto_per_hour: 1, max_auto_per_day: 1 });
// A rule loose enough to match something in the live feed right now.
rules.create('smoke-e2e: any eBay deal ≥20% off', { source: 'ebay', min_discount_pct: 20 }, true, true);

const playwright = new PlaywrightScrapeSource();
const queue = new AnalysisQueue({
  deals,
  analyses,
  rules,
  notifications,
  settings,
  imageSources: [
    new EbayBrowseSource({ clientId: env.EBAY_CLIENT_ID, clientSecret: env.EBAY_CLIENT_SECRET }),
    playwright,
    new PrimaryOnlySource(),
  ],
  analyzer: new Analyzer({ apiKey: env.ANTHROPIC_API_KEY! }),
  notifier: new DiscordNotifier(env.DISCORD_WEBHOOK_URL),
  log,
});
const mcp = new PalletTradeClient({ url: env.PALLET_TRADE_MCP_URL, token: env.PALLET_TRADE_TOKEN! });
const poller = new Poller({ mcp, deals, analyses, rules, polls, settings, queue, log });

console.log('Polling once…');
await poller.pollNow();
const poll = polls.latest();
console.log(`poll: fetched=${poll?.deals_fetched} new=${poll?.new_deals} enqueued=${poll?.enqueued}`);
if (!poll?.enqueued) {
  console.error(
    'NOTE: nothing enqueued (every matching deal was already seen, or none matched). Re-run later or loosen the rule.',
  );
  await mcp.close();
  await playwright.close();
  db.close();
  process.exit(2);
}

console.log('Waiting for the analysis to finish…');
await queue.onIdle();
// notification send happens inside the job; give the throttle a beat
await new Promise((r) => setTimeout(r, 3000));

const rows = notifications.list(5);
const done = db.prepare("SELECT id, status, recommendation, confidence, cost_usd, error FROM analyses").all();
console.log('analyses:', done);
console.log('notifications:', rows.map((r) => ({ analysis: r.analysis_id, status: r.status, urgency: r.urgency })));
const sent = rows.some((r) => r.status === 'sent');
console.log(sent ? 'PASS — check Discord for the embed' : 'PARTIAL — analysis ran but no notification was sent (check verdict/notify settings above)');

await mcp.close();
await playwright.close();
db.close();
process.exit(sent ? 0 : 2);
