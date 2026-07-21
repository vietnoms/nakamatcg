import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb, type DB } from '../server/db/db.js';
import { createDealsRepo, type DealsRepo } from '../server/db/repos/deals.js';
import { createAnalysesRepo, type AnalysesRepo } from '../server/db/repos/analyses.js';
import { createRulesRepo, type RulesRepo } from '../server/db/repos/rules.js';
import { createNotificationsRepo, type NotificationsRepo } from '../server/db/repos/notifications.js';
import { createSettingsRepo, type SettingsRepo } from '../server/db/repos/settings.js';
import { createPollsRepo, type PollsRepo } from '../server/db/repos/polls.js';
import { AnalysisQueue } from '../server/queue/analysisQueue.js';
import { DiscordNotifier } from '../server/notify/discord.js';
import { dealFromPayload } from '../server/mcp/palletTrade.js';
import type { AppCtx } from '../server/context.js';
import type { Env } from '../server/env.js';

export function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

export function loadFixture(name: string): string {
  return readFileSync(fixturePath(name), 'utf8');
}

export function fixtureDeals(): unknown[] {
  return JSON.parse(loadFixture('deals.json')) as unknown[];
}

export interface TestWorld {
  db: DB;
  deals: DealsRepo;
  analyses: AnalysesRepo;
  rules: RulesRepo;
  notifications: NotificationsRepo;
  settings: SettingsRepo;
  polls: PollsRepo;
  queue: AnalysisQueue;
  ctx: AppCtx;
}

export function makeWorld(overrides: Partial<AppCtx> = {}): TestWorld {
  const db = openDb(':memory:');
  const deals = createDealsRepo(db);
  const analyses = createAnalysesRepo(db);
  const rules = createRulesRepo(db);
  const notifications = createNotificationsRepo(db);
  const settings = createSettingsRepo(db);
  const polls = createPollsRepo(db);
  const notifier = new DiscordNotifier(undefined);
  const queue = new AnalysisQueue({
    deals,
    analyses,
    rules,
    notifications,
    settings,
    imageSources: [],
    analyzer: null,
    notifier,
  });
  const env = {
    PORT: 0,
    DB_PATH: ':memory:',
    PALLET_TRADE_MCP_URL: 'https://pallet.trade/mcp',
  } as Env;
  const ctx: AppCtx = {
    env,
    db,
    deals,
    analyses,
    rules,
    notifications,
    settings,
    polls,
    mcp: null,
    queue,
    poller: null,
    notifier,
    startedAt: Date.now(),
    version: 'test',
    ...overrides,
  };
  return { db, deals, analyses, rules, notifications, settings, polls, queue, ctx };
}

/** Insert the fixture deals into the world's deals table. */
export function seedFixtureDeals(world: TestWorld): string[] {
  const ids: string[] = [];
  for (const payload of fixtureDeals()) {
    const d = dealFromPayload(payload);
    if (!d) throw new Error('fixture deal failed to parse');
    world.deals.upsert(d);
    ids.push(d.id);
  }
  return ids;
}
