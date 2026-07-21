import { describe, expect, it } from 'vitest';
import { VerdictSchema } from '../shared/verdict.js';
import { makeWorld, seedFixtureDeals } from './helpers.js';

const CAPS = { maxPerHour: 10, maxPerDay: 100, dailySpendCapUsd: 100 };

const verdict = VerdictSchema.parse({
  assessed_condition: 'NM',
  condition_rationale: 'clean',
  claim_match: 'MATCHES',
  flaws: [],
  red_flags: [],
  recommendation: 'BUY',
  confidence: 'HIGH',
  confidence_reason: 'full gallery',
  summary: 'good deal',
});

describe('atomic budget-guarded auto enqueue', () => {
  it('enforces the auto-once unique index (never re-analyze a listing)', () => {
    const w = makeWorld();
    const [id1] = seedFixtureDeals(w);
    expect(w.analyses.insertAutoGuarded(id1!, 1, 'm', 'medium', CAPS)).not.toBeNull();
    expect(w.analyses.insertAutoGuarded(id1!, 1, 'm', 'medium', CAPS)).toBeNull(); // deduped
  });

  it('hour window excludes same-day rows older than an hour (T-vs-space datetime regression)', () => {
    const w = makeWorld();
    const [id1, id2] = seedFixtureDeals(w);
    const caps = { ...CAPS, maxPerHour: 1 };
    const a1 = w.analyses.insertAutoGuarded(id1!, 1, 'm', 'medium', caps)!;
    // age the row 2 hours (same strftime format the column defaults to)
    w.db
      .prepare(
        "UPDATE analyses SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 hours') WHERE id = ?",
      )
      .run(a1);
    // an aged-out row must not consume the hourly budget
    expect(w.analyses.insertAutoGuarded(id2!, 1, 'm', 'medium', caps)).not.toBeNull();
    expect(w.analyses.budgetUsage().autoHour).toBe(1);
  });

  it('enforces the hourly cap', () => {
    const w = makeWorld();
    const [id1, id2] = seedFixtureDeals(w);
    const caps = { ...CAPS, maxPerHour: 1 };
    expect(w.analyses.insertAutoGuarded(id1!, 1, 'm', 'medium', caps)).not.toBeNull();
    expect(w.analyses.insertAutoGuarded(id2!, 1, 'm', 'medium', caps)).toBeNull();
  });

  it('enforces the daily cap', () => {
    const w = makeWorld();
    const [id1, id2] = seedFixtureDeals(w);
    const caps = { ...CAPS, maxPerDay: 1 };
    expect(w.analyses.insertAutoGuarded(id1!, 1, 'm', 'medium', caps)).not.toBeNull();
    expect(w.analyses.insertAutoGuarded(id2!, 1, 'm', 'medium', caps)).toBeNull();
  });

  it('enforces the daily spend cap from summed real cost', () => {
    const w = makeWorld();
    const [id1, id2] = seedFixtureDeals(w);
    const caps = { ...CAPS, dailySpendCapUsd: 0.05 };
    const a1 = w.analyses.insertAutoGuarded(id1!, 1, 'm', 'medium', caps);
    expect(a1).not.toBeNull();
    w.analyses.markDone(a1!, verdict, { input_tokens: 18000, output_tokens: 1000, cost_usd: 0.1 });
    expect(w.analyses.insertAutoGuarded(id2!, 1, 'm', 'medium', caps)).toBeNull();
  });

  it('manual analyses bypass count caps and can repeat per deal', () => {
    const w = makeWorld();
    const [id1] = seedFixtureDeals(w);
    expect(w.analyses.insertAutoGuarded(id1!, 1, 'm', 'medium', { ...CAPS, maxPerHour: 0 })).toBeNull();
    const m1 = w.analyses.insertManual(id1!, 'm', 'medium');
    const m2 = w.analyses.insertManual(id1!, 'm', 'medium'); // no unique index on manual
    expect(m1).toBeGreaterThan(0);
    expect(m2).toBeGreaterThan(m1);
  });

  it('budgetUsage reflects the rows', () => {
    const w = makeWorld();
    const [id1] = seedFixtureDeals(w);
    const a1 = w.analyses.insertAutoGuarded(id1!, 1, 'm', 'medium', CAPS)!;
    w.analyses.markDone(a1, verdict, { input_tokens: 100, output_tokens: 10, cost_usd: 0.07 });
    const u = w.analyses.budgetUsage();
    expect(u.autoHour).toBe(1);
    expect(u.autoDay).toBe(1);
    expect(u.spendDayUsd).toBeCloseTo(0.07);
  });
});

describe('crash resume', () => {
  it('returns in-flight rows to queued', () => {
    const w = makeWorld();
    const [id1, id2] = seedFixtureDeals(w);
    const a1 = w.analyses.insertManual(id1!, 'm', 'medium');
    const a2 = w.analyses.insertManual(id2!, 'm', 'medium');
    w.analyses.setStatus(a1, 'fetching_images');
    w.analyses.setStatus(a2, 'analyzing');

    const resumed = w.analyses.resumeQueued();
    expect(resumed.map((r) => r.id).sort()).toEqual([a1, a2]);
    expect(w.analyses.getById(a1)!.status).toBe('queued');
    expect(w.analyses.getById(a2)!.status).toBe('queued');
  });
});
