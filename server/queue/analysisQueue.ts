import PQueue from 'p-queue';
import type { AnalysesRepo } from '../db/repos/analyses.js';
import type { DealsRepo } from '../db/repos/deals.js';
import type { NotificationsRepo } from '../db/repos/notifications.js';
import type { RulesRepo } from '../db/repos/rules.js';
import type { SettingsRepo } from '../db/repos/settings.js';
import type { Analyzer } from '../analysis/analyzer.js';
import { AnalysisError, classifySdkError } from '../analysis/analyzer.js';
import { acquireImages, NoImagesError } from '../images/chain.js';
import type { ImageUrlSource } from '../images/types.js';
import { computeUrgency, buildEmbed, type DiscordNotifier } from '../notify/discord.js';
import { analysisPriority } from '../rules/match.js';
import type { AnalysisRow, QueueState } from '../../shared/types.js';

export interface QueueDeps {
  deals: DealsRepo;
  analyses: AnalysesRepo;
  rules: RulesRepo;
  notifications: NotificationsRepo;
  settings: SettingsRepo;
  imageSources: ImageUrlSource[];
  analyzer: Analyzer | null; // null when ANTHROPIC_API_KEY is missing
  notifier: DiscordNotifier;
  log?: { info(msg: string): void; warn(msg: string): void; error(msg: string): void };
}

const noopLog = { info: () => {}, warn: () => {}, error: () => {} };

export class AnalysisQueue {
  private readonly q = new PQueue({ concurrency: 1 });
  private readonly inQueue = new Set<number>();
  paused = false;

  constructor(private readonly deps: QueueDeps) {}

  private get log() {
    return this.deps.log ?? noopLog;
  }

  /** Enqueue an existing `queued` analysis row. Idempotent per analysis id. */
  push(analysisId: number, priority: number): void {
    if (this.inQueue.has(analysisId)) return;
    this.inQueue.add(analysisId);
    void this.q
      .add(() => this.runJob(analysisId), { priority })
      .catch((err) => this.log.error(`analysis #${analysisId} job crashed: ${String(err)}`))
      .finally(() => this.inQueue.delete(analysisId));
  }

  /** Crash recovery: re-enqueue everything runnable, priority recomputed from current ends_at. */
  resume(): number {
    const rows = this.deps.analyses.resumeQueued();
    for (const row of rows) {
      const deal = this.deps.deals.getById(row.deal_id);
      this.push(row.id, analysisPriority(row.trig, deal?.ends_at ?? null));
    }
    if (rows.length > 0) this.log.info(`resumed ${rows.length} queued analyses from DB`);
    return rows.length;
  }

  snapshot(): QueueState {
    const pending = this.deps.analyses.pendingJobs();
    const settings = this.deps.settings.getAll();
    const usage = this.deps.analyses.budgetUsage();
    return {
      jobs: pending.map((a) => ({
        analysis_id: a.id,
        deal_id: a.deal_id,
        title: this.deps.deals.getById(a.deal_id)?.title ?? a.deal_id,
        trig: a.trig,
        status: a.status,
      })),
      counts: {
        queued: pending.filter((a) => a.status === 'queued').length,
        running: pending.filter((a) => a.status !== 'queued').length,
      },
      budget: {
        auto_used_hour: usage.autoHour,
        max_per_hour: settings.max_auto_per_hour,
        auto_used_day: usage.autoDay,
        max_per_day: settings.max_auto_per_day,
        spend_today_usd: Math.round(usage.spendDayUsd * 100) / 100,
        daily_cap_usd: settings.daily_spend_cap_usd,
      },
    };
  }

  private async runJob(analysisId: number): Promise<void> {
    if (this.paused) {
      // leave the row queued; resume() after unpause re-enqueues
      return;
    }
    const { analyses, deals } = this.deps;
    const analysis = analyses.getById(analysisId);
    if (!analysis || analysis.status !== 'queued') return;
    const deal = deals.getById(analysis.deal_id);
    if (!deal) {
      analyses.markError(analysisId, 'deal disappeared from cache');
      return;
    }
    if (!this.deps.analyzer) {
      analyses.markError(analysisId, 'ANTHROPIC_API_KEY not configured');
      return;
    }

    const settings = this.deps.settings.getAll();
    try {
      analyses.setStatus(analysisId, 'fetching_images');
      const imageResult = await acquireImages(deal, this.deps.imageSources, {
        maxImages: settings.max_images,
        log: this.log,
      });
      analyses.setImages(analysisId, imageResult.source, imageResult.images.length);

      analyses.setStatus(analysisId, 'analyzing');
      const model = analysis.model ?? settings.model;
      const effort = (analysis.effort ?? settings.effort) as 'low' | 'medium' | 'high';
      const outcome = await this.deps.analyzer.analyze(deal, imageResult, { model, effort });

      analyses.markDone(analysisId, outcome.verdict, outcome.usage);
      this.log.info(
        `analysis #${analysisId} done: ${outcome.verdict.recommendation} (${outcome.verdict.confidence}) $${outcome.usage.cost_usd}`,
      );
      await this.maybeNotify(analysisId);
    } catch (err) {
      this.handleJobError(analysisId, deal.ends_at, err);
    }
  }

  private handleJobError(analysisId: number, endsAt: string | null, err: unknown): void {
    const { analyses } = this.deps;
    const message = err instanceof Error ? err.message : String(err);

    if (err instanceof NoImagesError) {
      analyses.markError(analysisId, message);
      return;
    }
    const kind = classifySdkError(err);
    if (kind === 'refused') {
      analyses.markError(analysisId, message, { refused: true });
      return;
    }
    if (kind === 'non_retryable') {
      analyses.markError(analysisId, message);
      this.paused = true; // auth problem — stop burning the queue; surfaced via /api/status
      this.log.error(`queue paused: non-retryable analysis error: ${message}`);
      return;
    }
    // retryable / fixable_once / parse_failure → one job-level retry after 30s
    const attempts = analyses.bumpAttempts(analysisId);
    if (attempts <= 1) {
      analyses.requeue(analysisId);
      this.log.warn(`analysis #${analysisId} failed (${kind}); retrying in 30s: ${message}`);
      const row = analyses.getById(analysisId);
      const timer = setTimeout(() => {
        this.push(analysisId, analysisPriority(row?.trig ?? 'auto', endsAt));
      }, 30_000);
      timer.unref?.();
    } else {
      analyses.markError(analysisId, message);
    }
  }

  private async maybeNotify(analysisId: number): Promise<void> {
    const { analyses, deals, rules, notifications, notifier, settings } = this.deps;
    const analysis = analyses.getById(analysisId);
    if (!analysis || analysis.status !== 'done' || !analysis.verdict_json) return;
    const deal = deals.getById(analysis.deal_id);
    if (!deal) return;

    const cfg = settings.getAll();
    if (!cfg.discord_enabled || !notifier.configured()) return;
    if (!analysis.recommendation || !cfg.notify_verdicts.includes(analysis.recommendation)) return;
    if (analysis.trig === 'auto' && analysis.rule_id != null) {
      const rule = rules.getById(analysis.rule_id);
      if (rule && rule.notify === 0) return;
    }

    const urgency = computeUrgency(deal);
    // UNIQUE(analysis_id) claim — at most one notification per analysis, ever.
    if (!notifications.claim(analysisId, urgency)) return;
    try {
      const verdict = JSON.parse(analysis.verdict_json);
      await notifier.send(buildEmbed(deal, analysis, verdict, urgency));
      notifications.markSent(analysisId);
      this.log.info(`notified Discord for analysis #${analysisId} (${urgency})`);
    } catch (err) {
      notifications.markFailed(analysisId, err instanceof Error ? err.message : String(err));
      this.log.error(`Discord notify failed for analysis #${analysisId}: ${String(err)}`);
    }
  }

  async onIdle(): Promise<void> {
    await this.q.onIdle();
  }
}
