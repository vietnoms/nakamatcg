import type { Env } from './env.js';
import type { DB } from './db/db.js';
import type { DealsRepo } from './db/repos/deals.js';
import type { AnalysesRepo } from './db/repos/analyses.js';
import type { RulesRepo } from './db/repos/rules.js';
import type { NotificationsRepo } from './db/repos/notifications.js';
import type { SettingsRepo } from './db/repos/settings.js';
import type { PollsRepo } from './db/repos/polls.js';
import type { PalletTradeClient } from './mcp/palletTrade.js';
import type { AnalysisQueue } from './queue/analysisQueue.js';
import type { Poller } from './poller.js';
import type { DiscordNotifier } from './notify/discord.js';

export interface AppCtx {
  env: Env;
  db: DB;
  deals: DealsRepo;
  analyses: AnalysesRepo;
  rules: RulesRepo;
  notifications: NotificationsRepo;
  settings: SettingsRepo;
  polls: PollsRepo;
  mcp: PalletTradeClient | null;
  queue: AnalysisQueue;
  poller: Poller | null;
  notifier: DiscordNotifier;
  startedAt: number;
  version: string;
}
