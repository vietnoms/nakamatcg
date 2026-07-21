import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import type { DealUpsert } from '../db/repos/deals.js';
import { extractEbayItemId, extractHashFromDealUrl } from '../images/hash.js';

// Server-side filter vocabulary of the pallet.trade `get_deals` tool.
export interface GetDealsFilters {
  source?: string;
  marketplace?: string;
  tier?: string;
  min_discount_pct?: number;
  min_price?: number;
  max_price?: number;
  min_grade?: number;
  grader?: string;
  auction_only?: boolean;
  bin_only?: boolean;
  verified_only?: boolean;
  alert_fired?: boolean;
  ends_within?: number;
  listed_within?: number;
  seller?: string;
  limit?: number;
}

const DealPayloadSchema = z
  .object({
    id: z.string(),
    marketplace: z.string().nullish(),
    // url flows into <a href> and Discord embeds — never accept non-http schemes
    url: z.string().refine((u) => u.startsWith('https://') || u.startsWith('http://')),
    seller: z.string().nullish(),
    title: z.string().nullish(),
    price_total: z.number(),
    currency: z.string().nullish(),
    listed_at: z.string().nullish(),
    ends_at: z.string().nullish(),
    listing_type: z.enum(['auction', 'fixed_price']).nullish(),
    match: z
      .object({
        card: z.string().nullish(),
        set: z.string().nullish(),
        number: z.union([z.string(), z.number()]).nullish(),
        variant: z.string().nullish(),
        grader: z.string().nullish(),
        grade: z.union([z.string(), z.number()]).nullish(),
      })
      .passthrough()
      .nullish(),
    signal: z
      .object({
        market_estimate: z.number().nullish(),
        percent_below_market: z.number().nullish(),
        deal_tier: z.string().nullish(),
        verified: z.boolean().nullish(),
        tier_basis: z.string().nullish(),
        liquidity_score: z.number().nullish(),
        liquidity_rating: z.string().nullish(),
      })
      .passthrough()
      .nullish(),
    current_bid: z.number().nullish(),
    bid_count: z.number().nullish(),
    source: z.string().nullish(),
  })
  .passthrough();

export type DealPayload = z.infer<typeof DealPayloadSchema>;

/** Map a raw MCP deal payload onto our deals table shape. Returns null for unusable rows. */
export function dealFromPayload(payload: unknown): DealUpsert | null {
  const parsed = DealPayloadSchema.safeParse(payload);
  if (!parsed.success) return null;
  const d = parsed.data;
  const ebayItemId = extractEbayItemId(d.id, d.url);
  const gradeNum =
    d.match?.grade == null
      ? null
      : typeof d.match.grade === 'number'
        ? d.match.grade
        : Number.parseFloat(d.match.grade) || null;
  return {
    id: d.id,
    ebay_item_id: ebayItemId ?? '',
    source: d.source ?? 'ebay',
    marketplace: d.marketplace ?? 'ebay',
    url: d.url,
    seller: d.seller ?? null,
    title: d.title ?? '(untitled listing)',
    price_total: d.price_total,
    currency: d.currency ?? 'USD',
    listing_type: d.listing_type ?? 'fixed_price',
    listed_at: d.listed_at ?? null,
    ends_at: d.ends_at ?? null,
    card_name: d.match?.card ?? null,
    set_name: d.match?.set ?? null,
    card_number: d.match?.number == null ? null : String(d.match.number),
    variant: d.match?.variant ?? null,
    grader: d.match?.grader ?? null,
    grade: gradeNum,
    market_estimate: d.signal?.market_estimate ?? null,
    percent_below_market: d.signal?.percent_below_market ?? null,
    deal_tier: d.signal?.deal_tier ?? null,
    verified: d.signal?.verified ? 1 : 0,
    liquidity_score: d.signal?.liquidity_score ?? null,
    liquidity_rating: d.signal?.liquidity_rating ?? null,
    current_bid: d.current_bid ?? null,
    bid_count: d.bid_count ?? null,
    primary_image_hash: extractHashFromDealUrl(d.url),
    raw_json: JSON.stringify(payload),
  };
}

/** Dig the deal array out of an MCP tool result (structuredContent or JSON text block). */
export function extractDealsFromToolResult(result: {
  structuredContent?: unknown;
  content?: Array<{ type: string; text?: string }>;
}): unknown[] {
  const candidates: unknown[] = [];
  if (result.structuredContent !== undefined) candidates.push(result.structuredContent);
  for (const block of result.content ?? []) {
    if (block.type === 'text' && block.text) {
      try {
        candidates.push(JSON.parse(block.text));
      } catch {
        // non-JSON text block — ignore
      }
    }
  }
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
    if (c && typeof c === 'object') {
      const obj = c as Record<string, unknown>;
      for (const key of ['deals', 'results', 'items', 'listings']) {
        if (Array.isArray(obj[key])) return obj[key] as unknown[];
      }
      // single-deal result (get_deal)
      if (typeof obj.id === 'string' && typeof obj.url === 'string') return [obj];
    }
  }
  return [];
}

export class PalletTradeClient {
  private client: Client | null = null;
  private connecting: Promise<void> | null = null;
  lastError: string | null = null;

  constructor(private readonly opts: { url: string; token: string }) {}

  private async ensureConnected(): Promise<Client> {
    if (this.client) return this.client;
    if (!this.connecting) {
      this.connecting = (async () => {
        const transport = new StreamableHTTPClientTransport(new URL(this.opts.url), {
          requestInit: {
            headers: { Authorization: `Bearer ${this.opts.token}` },
          },
        });
        const client = new Client({ name: 'pallet-sniper', version: '0.1.0' });
        await client.connect(transport);
        this.client = client;
      })().finally(() => {
        this.connecting = null;
      });
    }
    await this.connecting;
    if (!this.client) throw new Error('MCP connect failed');
    return this.client;
  }

  private async callTool(name: string, args: Record<string, unknown>): Promise<unknown[]> {
    try {
      const client = await this.ensureConnected();
      const result = await client.callTool({ name, arguments: args });
      this.lastError = null;
      if (result.isError) {
        const text = (result.content as Array<{ text?: string }> | undefined)
          ?.map((c) => c.text)
          .filter(Boolean)
          .join(' ');
        throw new Error(`pallet.trade ${name} returned an error: ${text ?? 'unknown'}`);
      }
      return extractDealsFromToolResult(
        result as { structuredContent?: unknown; content?: Array<{ type: string; text?: string }> },
      );
    } catch (err) {
      // Drop the session so the next call re-handshakes.
      this.lastError = err instanceof Error ? err.message : String(err);
      try {
        await this.client?.close();
      } catch {
        /* ignore */
      }
      this.client = null;
      throw err;
    }
  }

  async getDeals(filters: GetDealsFilters = {}): Promise<unknown[]> {
    const args: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(filters)) {
      if (v !== undefined && v !== null) args[k] = v;
    }
    if (args.limit === undefined) args.limit = 100;
    return this.callTool('get_deals', args);
  }

  async getDeal(id: string): Promise<unknown | null> {
    const rows = await this.callTool('get_deal', { id });
    return rows[0] ?? null;
  }

  isConnected(): boolean {
    return this.client !== null;
  }

  async close(): Promise<void> {
    try {
      await this.client?.close();
    } catch {
      /* ignore */
    }
    this.client = null;
  }
}
