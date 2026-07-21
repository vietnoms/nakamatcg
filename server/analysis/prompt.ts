import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Anthropic from '@anthropic-ai/sdk';
import type { DealRow } from '../../shared/types.js';
import type { AcquiredImage, EbayItemContext } from '../images/types.js';

/**
 * The grader prompt is data, not code: prompts/card-verifier.md at the repo root.
 * The user is expected to overwrite it with their tuned version (see README).
 */
export function loadGraderPrompt(): string {
  const candidates = [
    resolve(process.cwd(), 'prompts/card-verifier.md'),
    // dist/server/analysis/prompt.js → ../../../prompts (repo root when built)
    fileURLToPath(new URL('../../../prompts/card-verifier.md', import.meta.url)),
    // server/analysis/prompt.ts → ../../prompts (repo root when run via tsx)
    fileURLToPath(new URL('../../prompts/card-verifier.md', import.meta.url)),
  ];
  for (const p of candidates) {
    try {
      return readFileSync(p, 'utf8');
    } catch {
      // try next candidate
    }
  }
  throw new Error('prompts/card-verifier.md not found — run the app from the repo root');
}

/** Fixed appendix: structured-output semantics the schema itself can't express. */
export const STRUCTURED_APPENDIX = `
## Output rules (machine-parsed)

Your verdict is parsed as strict JSON against a schema — no prose outside the structure.
- "photo_index" is 1-based and refers to "Photo N" as presented; use -1 for flaws not tied to one photo.
- If photos are stock images, catalog scans, or too poor to assess: assessed_condition "UNKNOWN",
  claim_match "UNVERIFIABLE", confidence "LOW", and record the reason under red_flags.
- When told this is a SINGLE-PHOTO (degraded) analysis, confidence must be "LOW".
- "SLAB_VERIFIED" only when the photos clearly show the claimed slab (grader, grade, and cert
  readable or strongly corroborated).
- "BUY" requires: condition supports the price relative to market estimate AND no disqualifying
  red flags. When genuinely torn, prefer "MAYBE" with a precise confidence_reason.
- Never factor in shipping speed, seller charisma, or anything not visible in photos/context.
`;

export function buildSystemPrompt(graderPrompt: string): string {
  return `${graderPrompt.trim()}\n${STRUCTURED_APPENDIX}`;
}

export function buildDealContext(
  deal: DealRow,
  imageCount: number,
  degraded: boolean,
  context?: EbayItemContext,
): string {
  const lines: string[] = ['# Listing under evaluation', ''];
  lines.push(`Title: ${deal.title}`);
  const card = [deal.card_name, deal.set_name, deal.card_number ? `#${deal.card_number}` : null, deal.variant]
    .filter(Boolean)
    .join(' — ');
  if (card) lines.push(`Matched card: ${card}`);
  lines.push(
    deal.grader
      ? `Claimed grading: ${deal.grader} ${deal.grade ?? '?'}`
      : 'Claimed grading: none (raw card)',
  );
  lines.push(
    `Listing type: ${deal.listing_type === 'auction' ? `auction${deal.ends_at ? `, ends ${deal.ends_at}` : ''}${deal.bid_count != null ? `, ${deal.bid_count} bids` : ''}` : 'fixed price (BIN)'}`,
  );
  const priceBits = [`Price: ${deal.price_total} ${deal.currency}`];
  if (deal.market_estimate != null) priceBits.push(`market estimate ${deal.market_estimate} ${deal.currency}`);
  if (deal.percent_below_market != null) priceBits.push(`${deal.percent_below_market}% below market`);
  lines.push(priceBits.join(' · '));
  if (deal.seller) lines.push(`Seller: ${deal.seller}`);
  if (context?.condition) lines.push(`eBay condition field: ${context.condition}`);
  if (context?.item_specifics) {
    const specifics = Object.entries(context.item_specifics)
      .slice(0, 20)
      .map(([k, v]) => `${k}: ${v}`)
      .join('; ');
    lines.push(`Item specifics: ${specifics}`);
  }
  lines.push('');
  lines.push(
    degraded
      ? `IMAGE SOURCE: DEGRADED — only the single primary listing photo is available. This is a SINGLE-PHOTO analysis; confidence must be LOW.`
      : `IMAGE SOURCE: listing gallery, ${imageCount} photo${imageCount === 1 ? '' : 's'} follow in order.`,
  );
  return lines.join('\n');
}

export function buildUserContent(
  deal: DealRow,
  images: AcquiredImage[],
  degraded: boolean,
  context?: EbayItemContext,
): Anthropic.Messages.ContentBlockParam[] {
  const blocks: Anthropic.Messages.ContentBlockParam[] = [
    { type: 'text', text: buildDealContext(deal, images.length, degraded, context) },
  ];
  images.forEach((img, i) => {
    blocks.push({ type: 'text', text: `Photo ${i + 1}:` });
    blocks.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: img.buffer.toString('base64') },
    });
  });
  blocks.push({
    type: 'text',
    text: `Photos 1 through ${images.length} are shown above. Produce your structured verdict now.`,
  });
  return blocks;
}
