import { describe, expect, it } from 'vitest';
import { VerdictSchema } from '../shared/verdict.js';
import {
  clampConfidenceForDegraded,
  computeCostUsd,
  sanitizeVerdict,
} from '../server/analysis/analyzer.js';

const base = VerdictSchema.parse({
  assessed_condition: 'LP',
  condition_rationale: 'edge whitening on back',
  claim_match: 'WORSE',
  flaws: [
    {
      type: 'whitening',
      severity: 'moderate',
      location: 'back bottom edge',
      photo_index: 4,
      description: 'visible whitening along the bottom edge',
    },
  ],
  red_flags: [],
  recommendation: 'MAYBE',
  confidence: 'HIGH',
  confidence_reason: 'full gallery, sharp photos',
  summary: 'Card is LP despite NM claim; price still decent.',
});

describe('VerdictSchema', () => {
  it('round-trips a valid verdict', () => {
    expect(VerdictSchema.parse(JSON.parse(JSON.stringify(base)))).toEqual(base);
  });
  it('rejects unknown enum values', () => {
    expect(() => VerdictSchema.parse({ ...base, recommendation: 'YOLO' })).toThrow();
    expect(() => VerdictSchema.parse({ ...base, confidence: 'Sure' })).toThrow();
  });
});

describe('sanitizeVerdict', () => {
  it('coerces out-of-range photo indexes to -1', () => {
    const v = { ...base, flaws: [{ ...base.flaws[0]!, photo_index: 99 }] };
    expect(sanitizeVerdict(v, 5).flaws[0]!.photo_index).toBe(-1);
    const v2 = { ...base, flaws: [{ ...base.flaws[0]!, photo_index: 3 }] };
    expect(sanitizeVerdict(v2, 5).flaws[0]!.photo_index).toBe(3);
  });
});

describe('clampConfidenceForDegraded', () => {
  it('forces LOW for degraded single-photo analyses', () => {
    const clamped = clampConfidenceForDegraded(base, true);
    expect(clamped.confidence).toBe('LOW');
    expect(clamped.confidence_reason).toMatch(/^\[clamped: single-photo analysis\]/);
  });
  it('leaves non-degraded verdicts alone', () => {
    expect(clampConfidenceForDegraded(base, false)).toEqual(base);
  });
});

describe('computeCostUsd', () => {
  it('matches the plan arithmetic for sonnet-5', () => {
    // 18k in × $3/M + 1k out × $15/M = 0.054 + 0.015 = 0.069
    expect(computeCostUsd('claude-sonnet-5', 18_000, 1_000)).toBeCloseTo(0.069, 4);
  });
  it('matches haiku pricing', () => {
    // 18k × $1/M + 1k × $5/M = 0.018 + 0.005 = 0.023
    expect(computeCostUsd('claude-haiku-4-5', 18_000, 1_000)).toBeCloseTo(0.023, 4);
  });
  it('falls back to sonnet pricing for unknown models (conservative)', () => {
    expect(computeCostUsd('claude-mystery-9', 18_000, 1_000)).toBeCloseTo(0.069, 4);
  });
});
