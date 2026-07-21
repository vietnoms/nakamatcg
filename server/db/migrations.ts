// Migrations as TS modules (not .sql assets) so `tsc` output is self-contained —
// nothing to copy into dist/.

export interface Migration {
  id: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: '001_init',
    sql: `
CREATE TABLE deals (
  id TEXT PRIMARY KEY,
  ebay_item_id TEXT NOT NULL,
  source TEXT NOT NULL,
  marketplace TEXT NOT NULL,
  url TEXT NOT NULL,
  seller TEXT,
  title TEXT NOT NULL,
  price_total REAL NOT NULL,
  currency TEXT NOT NULL,
  listing_type TEXT NOT NULL CHECK (listing_type IN ('auction','fixed_price')),
  listed_at TEXT,
  ends_at TEXT,
  card_name TEXT, set_name TEXT, card_number TEXT, variant TEXT, grader TEXT, grade REAL,
  market_estimate REAL, percent_below_market REAL, deal_tier TEXT,
  verified INTEGER NOT NULL DEFAULT 0, liquidity_score REAL, liquidity_rating TEXT,
  current_bid REAL, bid_count INTEGER,
  primary_image_hash TEXT,
  raw_json TEXT NOT NULL,
  first_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_deals_tier ON deals(deal_tier);
CREATE INDEX idx_deals_ends ON deals(ends_at);
CREATE INDEX idx_deals_discount ON deals(percent_below_market DESC);

CREATE TABLE analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id TEXT NOT NULL REFERENCES deals(id),
  trig TEXT NOT NULL CHECK (trig IN ('manual','auto')),
  rule_id INTEGER,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','fetching_images','analyzing','done','error','refused')),
  image_source TEXT CHECK (image_source IN ('ebay_api','playwright','primary_only')),
  image_count INTEGER,
  model TEXT, effort TEXT,
  verdict_json TEXT,
  assessed_condition TEXT, claim_match TEXT, recommendation TEXT, confidence TEXT,
  input_tokens INTEGER, output_tokens INTEGER, cost_usd REAL,
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  started_at TEXT, completed_at TEXT
);
CREATE UNIQUE INDEX idx_analyses_auto_once ON analyses(deal_id) WHERE trig = 'auto';
CREATE INDEX idx_analyses_deal ON analyses(deal_id);
CREATE INDEX idx_analyses_created ON analyses(created_at);
CREATE INDEX idx_analyses_status ON analyses(status);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  analysis_id INTEGER NOT NULL UNIQUE REFERENCES analyses(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
  urgency TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  sent_at TEXT
);

CREATE TABLE rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  notify INTEGER NOT NULL DEFAULT 1,
  criteria TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE polls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  deals_fetched INTEGER, new_deals INTEGER, enqueued INTEGER,
  error TEXT
);
`,
  },
];
