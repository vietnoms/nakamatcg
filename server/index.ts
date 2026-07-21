import { loadEnv, envCapabilities } from './env.js';
import { openDb } from './db/db.js';
import { createDealsRepo } from './db/repos/deals.js';
import { createAnalysesRepo } from './db/repos/analyses.js';
import { createRulesRepo } from './db/repos/rules.js';
import { createNotificationsRepo } from './db/repos/notifications.js';
import { createSettingsRepo } from './db/repos/settings.js';
import { createPollsRepo } from './db/repos/polls.js';
import { PalletTradeClient } from './mcp/palletTrade.js';
import { EbayBrowseSource } from './images/ebayApi.js';
import { PlaywrightScrapeSource } from './images/playwrightScrape.js';
import { PrimaryOnlySource } from './images/primaryOnly.js';
import { Analyzer } from './analysis/analyzer.js';
import { DiscordNotifier } from './notify/discord.js';
import { AnalysisQueue } from './queue/analysisQueue.js';
import { Poller } from './poller.js';
import { buildApp } from './app.js';
import type { AppCtx } from './context.js';

const VERSION = '0.1.0';

const log = {
  info: (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`),
  warn: (msg: string) => console.warn(`[${new Date().toISOString()}] WARN ${msg}`),
  error: (msg: string) => console.error(`[${new Date().toISOString()}] ERROR ${msg}`),
};

async function main(): Promise<void> {
  const env = loadEnv();
  const caps = envCapabilities(env);
  log.info(`pallet sniper v${VERSION} starting`);
  log.info(
    `capabilities: pallet_trade=${caps.pallet_trade} anthropic=${caps.anthropic} ebay_api=${caps.ebay_api} discord=${caps.discord}`,
  );
  if (!caps.pallet_trade) log.warn('PALLET_TRADE_TOKEN missing — deal polling disabled');
  if (!caps.anthropic) log.warn('ANTHROPIC_API_KEY missing — analysis disabled');
  if (!caps.ebay_api) log.warn('eBay API creds missing — image tier 1 disabled (Playwright/CDN fallback)');
  if (!caps.discord) log.warn('DISCORD_WEBHOOK_URL missing — notifications disabled');

  const db = openDb(env.DB_PATH);
  const deals = createDealsRepo(db);
  const analyses = createAnalysesRepo(db);
  const rules = createRulesRepo(db);
  const notifications = createNotificationsRepo(db);
  const settings = createSettingsRepo(db);
  const polls = createPollsRepo(db);

  const playwrightSource = new PlaywrightScrapeSource();
  const imageSources = [
    new EbayBrowseSource({ clientId: env.EBAY_CLIENT_ID, clientSecret: env.EBAY_CLIENT_SECRET }),
    playwrightSource,
    new PrimaryOnlySource(),
  ];

  const notifier = new DiscordNotifier(env.DISCORD_WEBHOOK_URL);
  const analyzer = env.ANTHROPIC_API_KEY ? new Analyzer({ apiKey: env.ANTHROPIC_API_KEY }) : null;

  const queue = new AnalysisQueue({
    deals,
    analyses,
    rules,
    notifications,
    settings,
    imageSources,
    analyzer,
    notifier,
    log,
  });

  const mcp = env.PALLET_TRADE_TOKEN
    ? new PalletTradeClient({ url: env.PALLET_TRADE_MCP_URL, token: env.PALLET_TRADE_TOKEN })
    : null;
  const poller = mcp
    ? new Poller({ mcp, deals, analyses, rules, polls, settings, queue, log })
    : null;

  const ctx: AppCtx = {
    env,
    db,
    deals,
    analyses,
    rules,
    notifications,
    settings,
    polls,
    mcp,
    queue,
    poller,
    notifier,
    startedAt: Date.now(),
    version: VERSION,
  };

  const app = await buildApp(ctx, { serveStatic: true });
  await app.listen({ port: env.PORT, host: '127.0.0.1' });
  log.info(`listening on http://127.0.0.1:${env.PORT}`);

  const resumed = queue.resume();
  if (resumed > 0) log.info(`resumed ${resumed} analyses from previous run`);
  poller?.start();

  const shutdown = async (signal: string) => {
    log.info(`${signal} received — shutting down`);
    poller?.stop();
    await playwrightSource.close();
    await mcp?.close();
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
