import type { DB } from '../db.js';

export interface PollRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  deals_fetched: number | null;
  new_deals: number | null;
  enqueued: number | null;
  error: string | null;
}

export function createPollsRepo(db: DB) {
  function start(): number {
    const res = db
      .prepare("INSERT INTO polls (started_at) VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
      .run();
    return Number(res.lastInsertRowid);
  }

  function finish(
    id: number,
    stats: { deals_fetched: number; new_deals: number; enqueued: number },
  ): void {
    db.prepare(
      `UPDATE polls SET finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
       deals_fetched = ?, new_deals = ?, enqueued = ? WHERE id = ?`,
    ).run(stats.deals_fetched, stats.new_deals, stats.enqueued, id);
  }

  function fail(id: number, error: string): void {
    db.prepare(
      "UPDATE polls SET finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), error = ? WHERE id = ?",
    ).run(error.slice(0, 1000), id);
  }

  function latest(): PollRow | undefined {
    return db.prepare('SELECT * FROM polls ORDER BY id DESC LIMIT 1').get() as PollRow | undefined;
  }

  return { start, finish, fail, latest };
}

export type PollsRepo = ReturnType<typeof createPollsRepo>;
