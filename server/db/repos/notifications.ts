import type { DB } from '../db.js';
import type { NotificationRow } from '../../../shared/types.js';

export function createNotificationsRepo(db: DB) {
  /**
   * Dedupe gate: the UNIQUE(analysis_id) column means this returns true at most
   * once per analysis, ever. Only a `true` return may be followed by a webhook POST.
   */
  function claim(analysisId: number, urgency: string): boolean {
    const res = db
      .prepare(
        'INSERT OR IGNORE INTO notifications (analysis_id, urgency) VALUES (?, ?)',
      )
      .run(analysisId, urgency);
    return res.changes > 0;
  }

  function markSent(analysisId: number): void {
    db.prepare(
      "UPDATE notifications SET status = 'sent', sent_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE analysis_id = ?",
    ).run(analysisId);
  }

  function markFailed(analysisId: number, error: string): void {
    db.prepare("UPDATE notifications SET status = 'failed', error = ? WHERE analysis_id = ?").run(
      error.slice(0, 1000),
      analysisId,
    );
  }

  function markSkipped(analysisId: number, reason: string): void {
    db.prepare("UPDATE notifications SET status = 'skipped', error = ? WHERE analysis_id = ?").run(
      reason,
      analysisId,
    );
  }

  function list(limit = 50): Array<NotificationRow & { deal_id: string; title: string | null; recommendation: string | null }> {
    return db
      .prepare(
        `SELECT n.*, a.deal_id AS deal_id, a.recommendation AS recommendation, d.title AS title
         FROM notifications n
         JOIN analyses a ON a.id = n.analysis_id
         LEFT JOIN deals d ON d.id = a.deal_id
         ORDER BY n.id DESC LIMIT ?`,
      )
      .all(Math.min(limit, 200)) as Array<
      NotificationRow & { deal_id: string; title: string | null; recommendation: string | null }
    >;
  }

  return { claim, markSent, markFailed, markSkipped, list };
}

export type NotificationsRepo = ReturnType<typeof createNotificationsRepo>;
