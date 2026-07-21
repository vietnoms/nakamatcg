// Shared types between server and web. Field names are snake_case to match
// SQLite columns and API payloads 1:1 — no mapping layer to drift.

export type DealTier = 'steal' | 'great-deal' | 'good-deal' | 'fair';
export type ListingType = 'auction' | 'fixed_price';
export type AnalysisTrigger = 'manual' | 'auto';
export type AnalysisStatus =
  | 'queued'
  | 'fetching_images'
  | 'analyzing'
  | 'done'
  | 'error'
  | 'refused';
export type ImageSourceName = 'ebay_api' | 'playwright' | 'primary_only';
export type Recommendation = 'BUY' | 'MAYBE' | 'PASS';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface DealRow {
  id: string;
  ebay_item_id: string;
  source: string;
  marketplace: string;
  url: string;
  seller: string | null;
  title: string;
  price_total: number;
  currency: string;
  listing_type: ListingType;
  listed_at: string | null;
  ends_at: string | null;
  card_name: string | null;
  set_name: string | null;
  card_number: string | null;
  variant: string | null;
  grader: string | null;
  grade: number | null;
  market_estimate: number | null;
  percent_below_market: number | null;
  deal_tier: string | null;
  verified: number;
  liquidity_score: number | null;
  liquidity_rating: string | null;
  current_bid: number | null;
  bid_count: number | null;
  primary_image_hash: string | null;
  raw_json: string;
  first_seen_at: string;
  last_seen_at: string;
}

export interface AnalysisRow {
  id: number;
  deal_id: string;
  trig: AnalysisTrigger;
  rule_id: number | null;
  status: AnalysisStatus;
  image_source: ImageSourceName | null;
  image_count: number | null;
  model: string | null;
  effort: string | null;
  verdict_json: string | null;
  assessed_condition: string | null;
  claim_match: string | null;
  recommendation: Recommendation | null;
  confidence: Confidence | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  attempts: number;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface LatestAnalysisSummary {
  id: number;
  status: AnalysisStatus;
  recommendation: Recommendation | null;
  confidence: Confidence | null;
  assessed_condition: string | null;
  claim_match: string | null;
}

export interface DealWithLatestAnalysis {
  deal: DealRow;
  latest_analysis: LatestAnalysisSummary | null;
}

export interface RuleCriteria {
  source?: 'ebay' | 'wallet' | 'all';
  tiers?: DealTier[];
  min_discount_pct?: number;
  min_price?: number;
  max_price?: number;
  grader?: string;
  min_grade?: number;
  auction_only?: boolean;
  bin_only?: boolean;
  marketplace?: string;
  ends_within_h?: number;
  title_includes?: string[];
}

export interface RuleRow {
  id: number;
  name: string;
  enabled: number;
  notify: number;
  criteria: string; // JSON RuleCriteria
  created_at: string;
  updated_at: string;
}

export interface NotificationRow {
  id: number;
  analysis_id: number;
  status: 'pending' | 'sent' | 'failed' | 'skipped';
  urgency: string | null;
  error: string | null;
  created_at: string;
  sent_at: string | null;
}

export interface Settings {
  poll_interval_min: number;
  max_auto_per_hour: number;
  max_auto_per_day: number;
  daily_spend_cap_usd: number;
  model: string;
  effort: 'low' | 'medium' | 'high';
  max_images: number;
  notify_verdicts: Recommendation[];
  discord_enabled: boolean;
}

export interface QueueJobInfo {
  analysis_id: number;
  deal_id: string;
  title: string;
  trig: AnalysisTrigger;
  status: AnalysisStatus;
}

export interface BudgetState {
  auto_used_hour: number;
  max_per_hour: number;
  auto_used_day: number;
  max_per_day: number;
  spend_today_usd: number;
  daily_cap_usd: number;
}

export interface QueueState {
  jobs: QueueJobInfo[];
  counts: { queued: number; running: number };
  budget: BudgetState;
}

export interface StatusInfo {
  mcp_ok: boolean;
  mcp_error: string | null;
  last_poll: {
    started_at: string;
    finished_at: string | null;
    deals_fetched: number | null;
    new_deals: number | null;
    enqueued: number | null;
    error: string | null;
  } | null;
  next_poll_at: string | null;
  uptime_s: number;
  version: string;
  queue_paused: boolean;
  capabilities: {
    pallet_trade: boolean;
    anthropic: boolean;
    ebay_api: boolean;
    discord: boolean;
  };
}

export interface DealsQuery {
  tiers?: DealTier[];
  min_price?: number;
  max_price?: number;
  min_discount?: number;
  grader?: string;
  min_grade?: number;
  auction_only?: boolean;
  bin_only?: boolean;
  marketplace?: string;
  ends_within_h?: number;
  source?: 'ebay' | 'wallet' | 'all';
  active_only?: boolean;
  sort?: 'discount' | 'ends_at' | 'price';
  limit?: number;
}
