import type { DB } from '../db.js';
import type { AnalysisRow, AnalysisStatus } from '../../../shared/types.js';
import type { Verdict } from '../../../shared/verdict.js';

export interface AutoEnqueueCaps {
  maxPerHour: number;
  maxPerDay: number;
  dailySpendCapUsd: number;
}

export function createAnalysesRepo(db: DB) {
  function getById(id: number): AnalysisRow | undefined {
    return db.prepare('SELECT * FROM analyses WHERE id = ?').get(id) as AnalysisRow | undefined;
  }

  function listForDeal(dealId: string): AnalysisRow[] {
    return db
      .prepare('SELECT * FROM analyses WHERE deal_id = ? ORDER BY id DESC')
      .all(dealId) as AnalysisRow[];
  }

  function activeForDeal(dealId: string): AnalysisRow | undefined {
    return db
      .prepare(
        "SELECT * FROM analyses WHERE deal_id = ? AND status IN ('queued','fetching_images','analyzing') ORDER BY id DESC LIMIT 1",
      )
      .get(dealId) as AnalysisRow | undefined;
  }

  function insertManual(dealId: string, model: string, effort: string): number {
    const res = db
      .prepare("INSERT INTO analyses (deal_id, trig, model, effort) VALUES (?, 'manual', ?, ?)")
      .run(dealId, model, effort);
    return Number(res.lastInsertRowid);
  }

  /**
   * Atomic budget-guarded auto enqueue. Returns the new analysis id, or null when
   * capped by budget or deduped by the auto-once unique index.
   */
  function insertAutoGuarded(
    dealId: string,
    ruleId: number,
    model: string,
    effort: string,
    caps: AutoEnqueueCaps,
  ): number | null {
    // NB: window bounds MUST use the same strftime format as created_at defaults —
    // datetime('now') renders "YYYY-MM-DD HH:MM:SS" (space separator) and string-compares
    // wrongly against our "YYYY-MM-DDTHH:MM:SS.mmmZ" values ('T' > ' ').
    const res = db
      .prepare(
        `INSERT INTO analyses (deal_id, trig, rule_id, model, effort)
         SELECT @dealId, 'auto', @ruleId, @model, @effort
         WHERE (SELECT COUNT(*) FROM analyses
                 WHERE trig='auto' AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) < @maxPerHour
           AND (SELECT COUNT(*) FROM analyses
                 WHERE trig='auto' AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')) < @maxPerDay
           AND (SELECT COALESCE(SUM(cost_usd),0) FROM analyses
                 WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')) < @dailySpendCap
         ON CONFLICT DO NOTHING`,
      )
      .run({
        dealId,
        ruleId,
        model,
        effort,
        maxPerHour: caps.maxPerHour,
        maxPerDay: caps.maxPerDay,
        dailySpendCap: caps.dailySpendCapUsd,
      });
    return res.changes > 0 ? Number(res.lastInsertRowid) : null;
  }

  function setStatus(id: number, status: AnalysisStatus): void {
    const extra =
      status === 'fetching_images'
        ? ", started_at = COALESCE(started_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))"
        : '';
    db.prepare(`UPDATE analyses SET status = ?${extra} WHERE id = ?`).run(status, id);
  }

  function setImages(id: number, source: string, count: number): void {
    db.prepare('UPDATE analyses SET image_source = ?, image_count = ? WHERE id = ?').run(
      source,
      count,
      id,
    );
  }

  function markDone(
    id: number,
    verdict: Verdict,
    usage: { input_tokens: number; output_tokens: number; cost_usd: number },
  ): void {
    db.prepare(
      `UPDATE analyses SET
         status = 'done', verdict_json = @verdict_json,
         assessed_condition = @assessed_condition, claim_match = @claim_match,
         recommendation = @recommendation, confidence = @confidence,
         input_tokens = @input_tokens, output_tokens = @output_tokens, cost_usd = @cost_usd,
         completed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), error = NULL
       WHERE id = @id`,
    ).run({
      id,
      verdict_json: JSON.stringify(verdict),
      assessed_condition: verdict.assessed_condition,
      claim_match: verdict.claim_match,
      recommendation: verdict.recommendation,
      confidence: verdict.confidence,
      ...usage,
    });
  }

  function markError(id: number, error: string, opts?: { refused?: boolean }): void {
    db.prepare(
      `UPDATE analyses SET status = ?, error = ?, completed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    ).run(opts?.refused ? 'refused' : 'error', error.slice(0, 2000), id);
  }

  function bumpAttempts(id: number): number {
    db.prepare('UPDATE analyses SET attempts = attempts + 1 WHERE id = ?').run(id);
    return (db.prepare('SELECT attempts FROM analyses WHERE id = ?').get(id) as { attempts: number })
      .attempts;
  }

  function requeue(id: number): void {
    db.prepare("UPDATE analyses SET status = 'queued' WHERE id = ?").run(id);
  }

  /** Crash recovery: put in-flight work back to queued, return everything runnable. */
  function resumeQueued(): AnalysisRow[] {
    db.prepare(
      "UPDATE analyses SET status = 'queued' WHERE status IN ('fetching_images','analyzing')",
    ).run();
    return db.prepare("SELECT * FROM analyses WHERE status = 'queued'").all() as AnalysisRow[];
  }

  function budgetUsage(): { autoHour: number; autoDay: number; spendDayUsd: number } {
    const autoHour = (
      db.prepare(
        "SELECT COUNT(*) AS n FROM analyses WHERE trig='auto' AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')",
      ).get() as { n: number }
    ).n;
    const autoDay = (
      db.prepare(
        "SELECT COUNT(*) AS n FROM analyses WHERE trig='auto' AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')",
      ).get() as { n: number }
    ).n;
    const spendDayUsd = (
      db.prepare(
        "SELECT COALESCE(SUM(cost_usd),0) AS s FROM analyses WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')",
      ).get() as { s: number }
    ).s;
    return { autoHour, autoDay, spendDayUsd };
  }

  function pendingJobs(): AnalysisRow[] {
    return db
      .prepare(
        "SELECT * FROM analyses WHERE status IN ('queued','fetching_images','analyzing') ORDER BY id ASC",
      )
      .all() as AnalysisRow[];
  }

  return {
    getById,
    listForDeal,
    activeForDeal,
    insertManual,
    insertAutoGuarded,
    setStatus,
    setImages,
    markDone,
    markError,
    bumpAttempts,
    requeue,
    resumeQueued,
    budgetUsage,
    pendingJobs,
  };
}

export type AnalysesRepo = ReturnType<typeof createAnalysesRepo>;
