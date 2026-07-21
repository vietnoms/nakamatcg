import { z } from 'zod';
import type { DB } from '../db.js';
import type { RuleCriteria, RuleRow } from '../../../shared/types.js';

export const RuleCriteriaSchema = z
  .object({
    source: z.enum(['ebay', 'wallet', 'all']).optional(),
    tiers: z.array(z.enum(['steal', 'great-deal', 'good-deal', 'fair'])).optional(),
    min_discount_pct: z.number().min(0).max(100).optional(),
    min_price: z.number().min(0).optional(),
    max_price: z.number().min(0).optional(),
    grader: z.string().optional(),
    min_grade: z.number().min(0).max(10).optional(),
    auction_only: z.boolean().optional(),
    bin_only: z.boolean().optional(),
    marketplace: z.string().optional(),
    ends_within_h: z.number().positive().optional(),
    title_includes: z.array(z.string()).optional(),
  })
  .strict();

export function createRulesRepo(db: DB) {
  function list(): RuleRow[] {
    return db.prepare('SELECT * FROM rules ORDER BY id ASC').all() as RuleRow[];
  }

  function listEnabled(): Array<RuleRow & { parsed: RuleCriteria }> {
    return list()
      .filter((r) => r.enabled === 1)
      .map((r) => ({ ...r, parsed: parseCriteria(r.criteria) }));
  }

  function parseCriteria(json: string): RuleCriteria {
    return RuleCriteriaSchema.parse(JSON.parse(json)) as RuleCriteria;
  }

  function create(name: string, criteria: RuleCriteria, enabled: boolean, notify: boolean): RuleRow {
    const res = db
      .prepare('INSERT INTO rules (name, enabled, notify, criteria) VALUES (?, ?, ?, ?)')
      .run(name, enabled ? 1 : 0, notify ? 1 : 0, JSON.stringify(RuleCriteriaSchema.parse(criteria)));
    return getById(Number(res.lastInsertRowid))!;
  }

  function update(
    id: number,
    patch: { name?: string; enabled?: boolean; notify?: boolean; criteria?: RuleCriteria },
  ): RuleRow | undefined {
    const existing = getById(id);
    if (!existing) return undefined;
    db.prepare(
      `UPDATE rules SET name = ?, enabled = ?, notify = ?, criteria = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    ).run(
      patch.name ?? existing.name,
      patch.enabled === undefined ? existing.enabled : patch.enabled ? 1 : 0,
      patch.notify === undefined ? existing.notify : patch.notify ? 1 : 0,
      patch.criteria ? JSON.stringify(RuleCriteriaSchema.parse(patch.criteria)) : existing.criteria,
      id,
    );
    return getById(id);
  }

  function remove(id: number): boolean {
    return db.prepare('DELETE FROM rules WHERE id = ?').run(id).changes > 0;
  }

  function getById(id: number): RuleRow | undefined {
    return db.prepare('SELECT * FROM rules WHERE id = ?').get(id) as RuleRow | undefined;
  }

  return { list, listEnabled, create, update, remove, getById, parseCriteria };
}

export type RulesRepo = ReturnType<typeof createRulesRepo>;
