import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppCtx } from '../context.js';
import { analysisPriority } from '../rules/match.js';
import type { DealsQuery } from '../../shared/types.js';

const boolish = (v: unknown) =>
  v === undefined ? undefined : v === 'true' || v === '1' || v === true;

const DealsQuerySchema = z.object({
  tiers: z
    .preprocess(
      (v) => (typeof v === 'string' && v.length > 0 ? v.split(',') : undefined),
      z.array(z.enum(['steal', 'great-deal', 'good-deal', 'fair'])).optional(),
    ),
  min_price: z.coerce.number().optional(),
  max_price: z.coerce.number().optional(),
  min_discount: z.coerce.number().optional(),
  grader: z.string().optional(),
  min_grade: z.coerce.number().optional(),
  auction_only: z.preprocess(boolish, z.boolean().optional()),
  bin_only: z.preprocess(boolish, z.boolean().optional()),
  marketplace: z.string().optional(),
  ends_within_h: z.coerce.number().optional(),
  source: z.enum(['ebay', 'wallet', 'all']).optional(),
  active_only: z.preprocess(boolish, z.boolean().optional()),
  sort: z.enum(['discount', 'ends_at', 'price']).optional(),
  limit: z.coerce.number().int().optional(),
});

export function registerDealRoutes(app: FastifyInstance, ctx: AppCtx): void {
  app.get('/api/deals', async (req, reply) => {
    const parsed = DealsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid query', issues: parsed.error.issues });
    }
    // strip undefined so the repo's `?? defaults` apply cleanly
    const q = Object.fromEntries(
      Object.entries(parsed.data).filter(([, v]) => v !== undefined),
    ) as DealsQuery;
    const { deals, total } = ctx.deals.query(q);
    const lastPoll = ctx.polls.latest();
    return {
      deals,
      total_matching: total,
      last_poll_at: lastPoll?.finished_at ?? lastPoll?.started_at ?? null,
    };
  });

  app.get('/api/deals/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const deal = ctx.deals.getById(id);
    if (!deal) return reply.code(404).send({ error: 'deal not found' });
    const analyses = ctx.analyses.listForDeal(id).map((a) => ({
      ...a,
      verdict: a.verdict_json ? JSON.parse(a.verdict_json) : null,
    }));
    return { deal, analyses };
  });

  app.post('/api/deals/:id/analyze', async (req, reply) => {
    const { id } = req.params as { id: string };
    const deal = ctx.deals.getById(id);
    if (!deal) return reply.code(404).send({ error: 'deal not found' });
    if (!ctx.env.ANTHROPIC_API_KEY) {
      return reply.code(503).send({ error: 'ANTHROPIC_API_KEY not configured' });
    }
    const active = ctx.analyses.activeForDeal(id);
    if (active) {
      return reply
        .code(409)
        .send({ error: 'analysis already in progress for this deal', existing_analysis_id: active.id });
    }
    const settings = ctx.settings.getAll();
    const body = (req.body ?? {}) as { model?: string };
    const model = typeof body.model === 'string' && body.model ? body.model : settings.model;
    const analysisId = ctx.analyses.insertManual(id, model, settings.effort);
    ctx.queue.push(analysisId, analysisPriority('manual', deal.ends_at));
    return reply.code(202).send({ analysis_id: analysisId });
  });
}
