import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../server/app.js';
import { makeWorld, seedFixtureDeals, type TestWorld } from './helpers.js';

let world: TestWorld;
let app: FastifyInstance;

beforeEach(async () => {
  world = makeWorld();
  world.queue.paused = true; // keep enqueued jobs inert & rows deterministic
  app = await buildApp(world.ctx);
});

afterEach(async () => {
  await app.close();
});

describe('GET /api/deals', () => {
  it('returns cached deals with filters applied', async () => {
    seedFixtureDeals(world);
    const all = await app.inject({ method: 'GET', url: '/api/deals' });
    expect(all.statusCode).toBe(200);
    expect(all.json().deals).toHaveLength(2);

    const steals = await app.inject({ method: 'GET', url: '/api/deals?tiers=steal&min_discount=30' });
    expect(steals.json().deals).toHaveLength(1);
    expect(steals.json().deals[0].deal.deal_tier).toBe('steal');

    const bins = await app.inject({ method: 'GET', url: '/api/deals?bin_only=true' });
    expect(bins.json().deals).toHaveLength(1);
    expect(bins.json().deals[0].deal.listing_type).toBe('fixed_price');
  });

  it('rejects malformed queries', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/deals?tiers=bogus' });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/deals/:id/analyze', () => {
  it('404s unknown deals', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/deals/nope/analyze', payload: {} });
    expect(res.statusCode).toBe(404);
  });

  it('503s without an Anthropic key', async () => {
    const [id] = seedFixtureDeals(world);
    const res = await app.inject({
      method: 'POST',
      url: `/api/deals/${encodeURIComponent(id!)}/analyze`,
      payload: {},
    });
    expect(res.statusCode).toBe(503);
  });

  it('202s then 409s while an analysis is active', async () => {
    world.ctx.env.ANTHROPIC_API_KEY = 'test-key';
    const [id] = seedFixtureDeals(world);
    const first = await app.inject({
      method: 'POST',
      url: `/api/deals/${encodeURIComponent(id!)}/analyze`,
      payload: {},
    });
    expect(first.statusCode).toBe(202);
    const analysisId = first.json().analysis_id as number;
    expect(world.analyses.getById(analysisId)?.status).toBe('queued');

    const second = await app.inject({
      method: 'POST',
      url: `/api/deals/${encodeURIComponent(id!)}/analyze`,
      payload: {},
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().existing_analysis_id).toBe(analysisId);
  });
});

describe('rules CRUD', () => {
  it('creates, lists, updates, deletes', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/rules',
      payload: { name: 'steals', criteria: { tiers: ['steal'], min_discount_pct: 35 } },
    });
    expect(create.statusCode).toBe(201);
    const rule = create.json();
    expect(rule.criteria.tiers).toEqual(['steal']);

    const list = await app.inject({ method: 'GET', url: '/api/rules' });
    expect(list.json()).toHaveLength(1);

    const update = await app.inject({
      method: 'PUT',
      url: `/api/rules/${rule.id}`,
      payload: { enabled: false },
    });
    expect(update.json().enabled).toBe(0);

    const del = await app.inject({ method: 'DELETE', url: `/api/rules/${rule.id}` });
    expect(del.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/rules' })).json()).toHaveLength(0);
  });

  it('rejects unknown criteria keys', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/rules',
      payload: { name: 'bad', criteria: { buy_it_for_me: true } },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('settings', () => {
  it('serves defaults and merges partial updates', async () => {
    const before = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(before.json().model).toBe('claude-sonnet-5');
    expect(before.json().poll_interval_min).toBe(5);

    const put = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { max_auto_per_hour: 3 },
    });
    expect(put.json().max_auto_per_hour).toBe(3);
    expect(put.json().model).toBe('claude-sonnet-5'); // untouched

    const rejected = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { effort: 'ludicrous' },
    });
    expect(rejected.statusCode).toBe(400);
  });
});

describe('system endpoints', () => {
  it('queue snapshot exposes budget state', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/queue' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.budget.max_per_hour).toBe(10);
    expect(body.counts).toEqual({ queued: 0, running: 0 });
  });

  it('status reports missing integrations', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/status' });
    const body = res.json();
    expect(body.mcp_ok).toBe(false);
    expect(body.capabilities.pallet_trade).toBe(false);
    expect(body.version).toBe('test');
  });

  it('poll 503s when MCP is not configured', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/poll' });
    expect(res.statusCode).toBe(503);
  });

  it('discord test 503s when webhook missing', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/notifications/test' });
    expect(res.statusCode).toBe(503);
  });
});
