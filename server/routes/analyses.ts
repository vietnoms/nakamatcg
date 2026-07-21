import type { FastifyInstance } from 'fastify';
import type { AppCtx } from '../context.js';

export function registerAnalysisRoutes(app: FastifyInstance, ctx: AppCtx): void {
  app.get('/api/analyses/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid id' });
    const analysis = ctx.analyses.getById(id);
    if (!analysis) return reply.code(404).send({ error: 'analysis not found' });
    return {
      ...analysis,
      verdict: analysis.verdict_json ? JSON.parse(analysis.verdict_json) : null,
    };
  });

  app.get('/api/analyses', async (req, reply) => {
    const dealId = (req.query as { deal_id?: string }).deal_id;
    if (!dealId) return reply.code(400).send({ error: 'deal_id query param required' });
    return ctx.analyses.listForDeal(dealId).map((a) => ({
      ...a,
      verdict: a.verdict_json ? JSON.parse(a.verdict_json) : null,
    }));
  });
}
