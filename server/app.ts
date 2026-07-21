import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AppCtx } from './context.js';
import { registerDealRoutes } from './routes/deals.js';
import { registerAnalysisRoutes } from './routes/analyses.js';
import { registerRuleRoutes } from './routes/rules.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerSystemRoutes } from './routes/system.js';

/** Build the Fastify app. Split from index.ts so tests can drive it with inject(). */
export async function buildApp(ctx: AppCtx, opts: { serveStatic?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  registerDealRoutes(app, ctx);
  registerAnalysisRoutes(app, ctx);
  registerRuleRoutes(app, ctx);
  registerSettingsRoutes(app, ctx);
  registerSystemRoutes(app, ctx);

  if (opts.serveStatic) {
    const webDist = resolve(process.cwd(), 'web/dist');
    if (existsSync(webDist)) {
      const fastifyStatic = (await import('@fastify/static')).default;
      await app.register(fastifyStatic, { root: webDist });
      // SPA fallback: any non-API GET serves index.html
      app.setNotFoundHandler((req, reply) => {
        if (req.method === 'GET' && !req.url.startsWith('/api/')) {
          return reply.sendFile('index.html');
        }
        return reply.code(404).send({ error: 'not found' });
      });
    }
  }

  return app;
}
