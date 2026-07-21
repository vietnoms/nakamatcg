import type { FastifyInstance } from 'fastify';
import type { AppCtx } from '../context.js';
import { SettingsSchema } from '../db/repos/settings.js';

export function registerSettingsRoutes(app: FastifyInstance, ctx: AppCtx): void {
  app.get('/api/settings', async () => ctx.settings.getAll());

  app.put('/api/settings', async (req, reply) => {
    const parsed = SettingsSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid settings', issues: parsed.error.issues });
    }
    return ctx.settings.put(parsed.data);
  });
}
