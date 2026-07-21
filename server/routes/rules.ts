import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppCtx } from '../context.js';
import { RuleCriteriaSchema } from '../db/repos/rules.js';

const RuleBodySchema = z.object({
  name: z.string().min(1).max(120),
  enabled: z.boolean().optional().default(true),
  notify: z.boolean().optional().default(true),
  criteria: RuleCriteriaSchema,
});

const RulePatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  notify: z.boolean().optional(),
  criteria: RuleCriteriaSchema.optional(),
});

function serializeRule<T extends { criteria: string }>(rule: T) {
  return { ...rule, criteria: JSON.parse(rule.criteria) as unknown };
}

export function registerRuleRoutes(app: FastifyInstance, ctx: AppCtx): void {
  app.get('/api/rules', async () => ctx.rules.list().map(serializeRule));

  app.post('/api/rules', async (req, reply) => {
    const parsed = RuleBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid rule', issues: parsed.error.issues });
    }
    const { name, enabled, notify, criteria } = parsed.data;
    const rule = ctx.rules.create(name, criteria, enabled, notify);
    return reply.code(201).send(serializeRule(rule));
  });

  app.put('/api/rules/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const parsed = RulePatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid rule patch', issues: parsed.error.issues });
    }
    const updated = ctx.rules.update(id, parsed.data);
    if (!updated) return reply.code(404).send({ error: 'rule not found' });
    return serializeRule(updated);
  });

  app.delete('/api/rules/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!ctx.rules.remove(id)) return reply.code(404).send({ error: 'rule not found' });
    return { ok: true };
  });
}
