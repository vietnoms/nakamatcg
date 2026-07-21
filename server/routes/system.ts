import type { FastifyInstance } from 'fastify';
import type { AppCtx } from '../context.js';
import { envCapabilities } from '../env.js';
import type { StatusInfo } from '../../shared/types.js';

export function registerSystemRoutes(app: FastifyInstance, ctx: AppCtx): void {
  app.get('/api/queue', async () => ({ ...ctx.queue.snapshot(), paused: ctx.queue.paused }));

  app.post('/api/poll', async (_req, reply) => {
    if (!ctx.poller) {
      return reply.code(503).send({ error: 'PALLET_TRADE_TOKEN not configured — polling disabled' });
    }
    const result = await ctx.poller.pollNow();
    if (result === 'busy') return reply.code(409).send({ error: 'poll already in progress' });
    return reply.code(202).send({ ok: true });
  });

  app.get('/api/status', async (): Promise<StatusInfo> => {
    const last = ctx.polls.latest();
    return {
      mcp_ok: ctx.mcp !== null && ctx.mcp.lastError === null,
      mcp_error: ctx.mcp?.lastError ?? (ctx.mcp ? null : 'PALLET_TRADE_TOKEN not configured'),
      last_poll: last
        ? {
            started_at: last.started_at,
            finished_at: last.finished_at,
            deals_fetched: last.deals_fetched,
            new_deals: last.new_deals,
            enqueued: last.enqueued,
            error: last.error,
          }
        : null,
      next_poll_at: ctx.poller?.nextPollAt?.toISOString() ?? null,
      uptime_s: Math.round((Date.now() - ctx.startedAt) / 1000),
      version: ctx.version,
      queue_paused: ctx.queue.paused,
      capabilities: envCapabilities(ctx.env),
    };
  });

  app.get('/api/notifications', async (req) => {
    const limit = Number((req.query as { limit?: string }).limit) || 50;
    return ctx.notifications.list(limit);
  });

  app.post('/api/notifications/test', async (_req, reply) => {
    if (!ctx.notifier.configured()) {
      return reply.code(503).send({ error: 'DISCORD_WEBHOOK_URL not configured' });
    }
    try {
      await ctx.notifier.sendTest();
      return { ok: true };
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
