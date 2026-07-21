import type { DealsRepo } from './db/repos/deals.js';
import type { AnalysesRepo } from './db/repos/analyses.js';
import type { PollsRepo } from './db/repos/polls.js';
import type { RulesRepo } from './db/repos/rules.js';
import type { SettingsRepo } from './db/repos/settings.js';
import { dealFromPayload, type PalletTradeClient } from './mcp/palletTrade.js';
import { analysisPriority, matchesRule, ruleToGetDealsFilters } from './rules/match.js';
import type { AnalysisQueue } from './queue/analysisQueue.js';

export interface PollerDeps {
  mcp: PalletTradeClient;
  deals: DealsRepo;
  analyses: AnalysesRepo;
  rules: RulesRepo;
  polls: PollsRepo;
  settings: SettingsRepo;
  queue: AnalysisQueue;
  log?: { info(msg: string): void; warn(msg: string): void; error(msg: string): void };
}

const noopLog = { info: () => {}, warn: () => {}, error: () => {} };

/**
 * Self-rescheduling poll loop. The next tick is scheduled only after the previous
 * one finishes, so overlap is impossible by construction; the inFlight guard covers
 * the manual POST /api/poll path.
 */
export class Poller {
  private inFlight = false;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  nextPollAt: Date | null = null;

  constructor(private readonly deps: PollerDeps) {}

  private get log() {
    return this.deps.log ?? noopLog;
  }

  start(): void {
    this.stopped = false;
    void this.tickAndReschedule();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.nextPollAt = null;
  }

  /** Manual trigger. Returns 'busy' when a poll is already running. */
  async pollNow(): Promise<'ok' | 'busy'> {
    if (this.inFlight) return 'busy';
    await this.tick();
    return 'ok';
  }

  private async tickAndReschedule(): Promise<void> {
    if (this.stopped) return;
    if (!this.inFlight) {
      await this.tick();
    } else {
      this.log.warn('poll tick skipped: previous poll still running');
    }
    if (this.stopped) return;
    const minutes = this.deps.settings.getAll().poll_interval_min;
    this.nextPollAt = new Date(Date.now() + minutes * 60_000);
    this.timer = setTimeout(() => void this.tickAndReschedule(), minutes * 60_000);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    this.inFlight = true;
    const { mcp, deals, analyses, rules, polls, settings, queue } = this.deps;
    const pollId = polls.start();
    try {
      const enabledRules = rules.listEnabled();

      // One broad call keeps the browse cache a superset; per-rule server-filtered
      // calls guarantee coverage for rules outside the top-100-by-discount slice.
      // Calls run sequentially: one MCP session, and an error on one call resets
      // the client — concurrency would cascade that reset into the other calls.
      const payloadById = new Map<string, unknown>();
      const errors: string[] = [];
      const collect = (rows: unknown[]) => {
        for (const r of rows) {
          const id = (r as { id?: unknown })?.id;
          if (typeof id === 'string') payloadById.set(id, r);
        }
      };
      try {
        collect(await mcp.getDeals({ limit: 100 }));
      } catch (e) {
        errors.push(`broad: ${e instanceof Error ? e.message : String(e)}`);
      }
      for (const rule of enabledRules) {
        try {
          collect(await mcp.getDeals(ruleToGetDealsFilters(rule.parsed)));
        } catch (e) {
          errors.push(`rule ${rule.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      if (payloadById.size === 0 && errors.length > 0) {
        throw new Error(errors.join(' | '));
      }

      const cfg = settings.getAll();
      let newCount = 0;
      let enqueued = 0;
      for (const payload of payloadById.values()) {
        const upsertable = dealFromPayload(payload);
        if (!upsertable) continue;
        const isNew = deals.upsert(upsertable);
        if (!isNew) continue;
        newCount++;

        const deal = deals.getById(upsertable.id);
        if (!deal) continue;
        const rule = enabledRules.find((r) => matchesRule(r.parsed, deal));
        if (!rule) continue;

        const analysisId = analyses.insertAutoGuarded(deal.id, rule.id, cfg.model, cfg.effort, {
          maxPerHour: cfg.max_auto_per_hour,
          maxPerDay: cfg.max_auto_per_day,
          dailySpendCapUsd: cfg.daily_spend_cap_usd,
        });
        if (analysisId !== null) {
          queue.push(analysisId, analysisPriority('auto', deal.ends_at));
          enqueued++;
          this.log.info(`auto-enqueued analysis #${analysisId} for ${deal.id} (rule "${rule.name}")`);
        } else {
          this.log.info(`skipped auto-analysis for ${deal.id}: budget cap or already analyzed`);
        }
      }

      polls.finish(pollId, {
        deals_fetched: payloadById.size,
        new_deals: newCount,
        enqueued,
      });
      if (errors.length > 0) {
        this.log.warn(`poll #${pollId} partial: ${errors.join(' | ')}`);
      } else {
        this.log.info(
          `poll #${pollId}: ${payloadById.size} deals, ${newCount} new, ${enqueued} enqueued`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      polls.fail(pollId, msg);
      this.log.error(`poll #${pollId} failed: ${msg}`);
    } finally {
      this.inFlight = false;
    }
  }
}
