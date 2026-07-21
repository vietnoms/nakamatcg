import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { VerdictSchema, type Verdict } from '../../shared/verdict.js';
import type { DealRow } from '../../shared/types.js';
import type { ImageFetchResult } from '../images/types.js';
import { buildSystemPrompt, buildUserContent, loadGraderPrompt } from './prompt.js';

/**
 * Standard (non-introductory) prices per MTok — deliberately the conservative
 * choice so the daily spend cap binds on the high side.
 */
export const MODEL_PRICING_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};
const FALLBACK_PRICING = MODEL_PRICING_PER_MTOK['claude-sonnet-5']!;

export function computeCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = MODEL_PRICING_PER_MTOK[model] ?? FALLBACK_PRICING;
  const usd = (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
  return Math.round(usd * 10_000) / 10_000;
}

export type AnalysisErrorKind =
  | 'retryable'
  | 'fixable_once'
  | 'non_retryable'
  | 'refused'
  | 'parse_failure';

export class AnalysisError extends Error {
  constructor(
    message: string,
    public readonly kind: AnalysisErrorKind,
  ) {
    super(message);
    this.name = 'AnalysisError';
  }
}

export function classifySdkError(err: unknown): AnalysisErrorKind {
  if (err instanceof AnalysisError) return err.kind;
  if (err instanceof Anthropic.AuthenticationError) return 'non_retryable';
  if (err instanceof Anthropic.PermissionDeniedError) return 'non_retryable';
  if (err instanceof Anthropic.NotFoundError) return 'non_retryable'; // bad model id
  if (err instanceof Anthropic.BadRequestError) return 'fixable_once'; // e.g. oversized request
  if (err instanceof Anthropic.RateLimitError) return 'retryable';
  if (err instanceof Anthropic.InternalServerError) return 'retryable';
  if (err instanceof Anthropic.APIConnectionError) return 'retryable';
  if (err instanceof Anthropic.APIError) return 'retryable'; // 529 overloaded etc.
  return 'retryable';
}

export interface AnalyzeUsage {
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export interface AnalyzeOutcome {
  verdict: Verdict;
  usage: AnalyzeUsage;
}

/** Normalize out-of-range photo indexes rather than failing an otherwise-good verdict. */
export function sanitizeVerdict(verdict: Verdict, imageCount: number): Verdict {
  return {
    ...verdict,
    flaws: verdict.flaws.map((f) => ({
      ...f,
      photo_index: f.photo_index >= 1 && f.photo_index <= imageCount ? f.photo_index : -1,
    })),
  };
}

/** Tier-3 (single photo) analyses can never claim more than LOW confidence. */
export function clampConfidenceForDegraded(verdict: Verdict, degraded: boolean): Verdict {
  if (!degraded || verdict.confidence === 'LOW') return verdict;
  return {
    ...verdict,
    confidence: 'LOW',
    confidence_reason: `[clamped: single-photo analysis] ${verdict.confidence_reason}`,
  };
}

export class Analyzer {
  private readonly client: Anthropic;
  private systemPrompt: string | null = null;

  constructor(opts: { apiKey: string; client?: Anthropic }) {
    this.client = opts.client ?? new Anthropic({ apiKey: opts.apiKey, maxRetries: 3 });
  }

  private getSystemPrompt(): string {
    if (!this.systemPrompt) this.systemPrompt = buildSystemPrompt(loadGraderPrompt());
    return this.systemPrompt;
  }

  async analyze(
    deal: DealRow,
    imageResult: ImageFetchResult,
    opts: { model: string; effort: 'low' | 'medium' | 'high' },
  ): Promise<AnalyzeOutcome> {
    const content = buildUserContent(deal, imageResult.images, imageResult.degraded, imageResult.context);
    const response = await this.client.messages.parse({
      model: opts.model,
      // adaptive thinking (default-on for sonnet-5) bills into max_tokens — leave headroom
      max_tokens: 8192,
      system: [
        {
          type: 'text',
          text: this.getSystemPrompt(),
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content }],
      output_config: {
        effort: opts.effort,
        format: zodOutputFormat(VerdictSchema),
      },
    });

    if (response.stop_reason === 'refusal') {
      throw new AnalysisError('model declined to analyze this listing (refusal)', 'refused');
    }
    if (response.stop_reason === 'max_tokens') {
      throw new AnalysisError('verdict truncated at max_tokens', 'retryable');
    }
    const parsed = response.parsed_output;
    if (!parsed) {
      throw new AnalysisError('structured output missing/unparseable', 'parse_failure');
    }
    const verdict = clampConfidenceForDegraded(
      sanitizeVerdict(VerdictSchema.parse(parsed), imageResult.images.length),
      imageResult.degraded,
    );
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    return {
      verdict,
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: computeCostUsd(opts.model, inputTokens, outputTokens),
      },
    };
  }
}
