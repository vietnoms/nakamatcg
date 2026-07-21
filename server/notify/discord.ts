import PQueue from 'p-queue';
import type { AnalysisRow, DealRow } from '../../shared/types.js';
import type { Verdict } from '../../shared/verdict.js';
import { cdnUrl } from '../images/hash.js';

export type Urgency = 'ending_soon' | 'normal';

const URGENT_WINDOW_MS = 2 * 3_600_000; // auctions ending < 2h

const COLORS = {
  BUY: 0x57f287,
  MAYBE: 0xfee75c,
  PASS: 0x95a5a6,
  URGENT: 0xed4245,
} as const;

export function computeUrgency(deal: DealRow, now: Date = new Date()): Urgency {
  if (deal.listing_type !== 'auction' || !deal.ends_at) return 'normal';
  const msLeft = new Date(deal.ends_at).getTime() - now.getTime();
  return msLeft > 0 && msLeft < URGENT_WINDOW_MS ? 'ending_soon' : 'normal';
}

interface DiscordEmbed {
  title: string;
  url: string;
  color: number;
  thumbnail?: { url: string };
  fields: Array<{ name: string; value: string; inline?: boolean }>;
  footer: { text: string };
  timestamp: string;
}

function money(v: number | null | undefined, currency: string): string {
  if (v == null) return '—';
  return `${currency === 'USD' ? '$' : `${currency} `}${v.toFixed(2)}`;
}

/** Discord rejects embed field values > 1024 chars. */
function field(name: string, value: string, inline?: boolean) {
  return { name, value: value.length > 1024 ? `${value.slice(0, 1021)}…` : value, ...(inline ? { inline } : {}) };
}

export function buildEmbed(
  deal: DealRow,
  analysis: AnalysisRow,
  verdict: Verdict,
  urgency: Urgency,
  now: Date = new Date(),
): { content?: string; embeds: DiscordEmbed[] } {
  const cardLabel =
    [deal.card_name, deal.set_name].filter(Boolean).join(' · ') || deal.title.slice(0, 120);
  const gradeSuffix = deal.grader ? ` ${deal.grader} ${deal.grade ?? ''}`.trimEnd() : '';
  const urgent = urgency === 'ending_soon';

  const fields: DiscordEmbed['fields'] = [
    {
      name: 'Price',
      value: `${money(deal.price_total, deal.currency)} vs est. ${money(deal.market_estimate, deal.currency)}`,
      inline: true,
    },
    {
      name: 'Discount',
      value:
        deal.percent_below_market != null
          ? `${deal.percent_below_market}% below market${deal.deal_tier ? ` · ${deal.deal_tier}` : ''}`
          : (deal.deal_tier ?? '—'),
      inline: true,
    },
    {
      name: 'Verdict',
      value: `${verdict.recommendation} · confidence ${verdict.confidence}`,
      inline: true,
    },
    {
      name: 'Condition',
      value: `Assessed ${verdict.assessed_condition} vs claimed ${
        deal.grader ? `${deal.grader} ${deal.grade ?? '?'}` : 'raw'
      } — ${verdict.claim_match}`,
      inline: true,
    },
  ];

  const topFlaws = verdict.flaws.slice(0, 3);
  fields.push(
    field(
      'Top flaws',
      topFlaws.length === 0
        ? 'None found'
        : topFlaws
            .map(
              (f) =>
                `${f.severity} ${f.type.replace(/_/g, ' ')} — ${f.location}${
                  f.photo_index > 0 ? ` (photo ${f.photo_index})` : ''
                }`,
            )
            .join('\n'),
    ),
  );

  if (deal.listing_type === 'auction' && deal.ends_at) {
    const unix = Math.floor(new Date(deal.ends_at).getTime() / 1000);
    fields.push({
      name: 'Auction',
      value: `Ends <t:${unix}:R>${deal.bid_count != null ? ` · ${deal.bid_count} bids` : ''}`,
      inline: true,
    });
  }

  if (verdict.red_flags.length > 0) {
    fields.push(field('Red flags', verdict.red_flags.slice(0, 5).join('\n')));
  }

  const embed: DiscordEmbed = {
    title: `${urgent ? '[ENDING SOON] ' : ''}${verdict.recommendation} — ${cardLabel}${gradeSuffix}`.slice(0, 256),
    url: deal.url,
    color: urgent && verdict.recommendation === 'BUY' ? COLORS.URGENT : COLORS[verdict.recommendation],
    ...(deal.primary_image_hash
      ? { thumbnail: { url: cdnUrl(deal.primary_image_hash, 's-l500') } }
      : {}),
    fields,
    footer: {
      text: `pallet sniper · analysis #${analysis.id} · $${(analysis.cost_usd ?? 0).toFixed(2)} · ${analysis.model ?? ''}`,
    },
    timestamp: (analysis.completed_at ? new Date(analysis.completed_at) : now).toISOString(),
  };

  const payload: { content?: string; embeds: DiscordEmbed[] } = { embeds: [embed] };
  if (urgent && deal.ends_at) {
    payload.content = `⏰ Auction ends soon — <t:${Math.floor(new Date(deal.ends_at).getTime() / 1000)}:R>`;
  }
  return payload;
}

export class DiscordNotifier {
  // Hard 1 msg/sec throttle, independent of Discord's own rate-limit responses.
  private readonly q = new PQueue({ concurrency: 1, interval: 1000, intervalCap: 1 });

  constructor(
    private readonly webhookUrl: string | undefined,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  configured(): boolean {
    return Boolean(this.webhookUrl);
  }

  /** Post a payload; resolves when delivered, throws after exhausting retries. */
  async send(payload: unknown): Promise<void> {
    if (!this.webhookUrl) throw new Error('DISCORD_WEBHOOK_URL not configured');
    await this.q.add(() => this.postWithRetry(payload));
  }

  private async postWithRetry(payload: unknown, maxAttempts = 3): Promise<void> {
    let lastErr: Error | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const res = await this.fetchFn(this.webhookUrl as string, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return;
      if (res.status === 429) {
        let waitS = Number(res.headers.get('retry-after')) || 1;
        try {
          const body = (await res.json()) as { retry_after?: number };
          if (typeof body.retry_after === 'number') waitS = body.retry_after;
        } catch {
          /* body not JSON — header value stands */
        }
        lastErr = new Error(`Discord 429, retry_after=${waitS}s`);
        await new Promise((r) => setTimeout(r, Math.min(waitS, 30) * 1000));
        continue;
      }
      const text = await res.text().catch(() => '');
      throw new Error(`Discord webhook HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    throw lastErr ?? new Error('Discord webhook failed');
  }

  async sendTest(): Promise<void> {
    await this.send({
      embeds: [
        {
          title: 'pallet sniper — test notification',
          color: COLORS.BUY,
          description: 'Webhook is wired up correctly. Deal alerts will look like this.',
          fields: [
            { name: 'Price', value: '$142.50 vs est. $220.00', inline: true },
            { name: 'Discount', value: '35% below market · steal', inline: true },
            { name: 'Verdict', value: 'BUY · confidence HIGH', inline: true },
          ],
          footer: { text: 'pallet sniper · test' },
          timestamp: new Date().toISOString(),
        },
      ],
    });
  }
}
