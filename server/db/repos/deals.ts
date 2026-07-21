import type { DB } from '../db.js';
import type { DealRow, DealsQuery, DealWithLatestAnalysis, LatestAnalysisSummary } from '../../../shared/types.js';

export interface DealUpsert extends Omit<DealRow, 'first_seen_at' | 'last_seen_at'> {}

export function createDealsRepo(db: DB) {
  const exists = db.prepare('SELECT 1 FROM deals WHERE id = ?');
  const insert = db.prepare(`
    INSERT INTO deals (
      id, ebay_item_id, source, marketplace, url, seller, title, price_total, currency,
      listing_type, listed_at, ends_at, card_name, set_name, card_number, variant, grader, grade,
      market_estimate, percent_below_market, deal_tier, verified, liquidity_score, liquidity_rating,
      current_bid, bid_count, primary_image_hash, raw_json
    ) VALUES (
      @id, @ebay_item_id, @source, @marketplace, @url, @seller, @title, @price_total, @currency,
      @listing_type, @listed_at, @ends_at, @card_name, @set_name, @card_number, @variant, @grader, @grade,
      @market_estimate, @percent_below_market, @deal_tier, @verified, @liquidity_score, @liquidity_rating,
      @current_bid, @bid_count, @primary_image_hash, @raw_json
    )`);
  const update = db.prepare(`
    UPDATE deals SET
      price_total = @price_total, currency = @currency, ends_at = @ends_at,
      market_estimate = @market_estimate, percent_below_market = @percent_below_market,
      deal_tier = @deal_tier, verified = @verified,
      liquidity_score = @liquidity_score, liquidity_rating = @liquidity_rating,
      current_bid = @current_bid, bid_count = @bid_count,
      raw_json = @raw_json,
      last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = @id`);

  /** Returns true when the deal was newly inserted (i.e. a NEW listing). */
  const upsert = db.transaction((deal: DealUpsert): boolean => {
    if (exists.get(deal.id)) {
      update.run(deal);
      return false;
    }
    insert.run(deal);
    return true;
  });

  function getById(id: string): DealRow | undefined {
    return db.prepare('SELECT * FROM deals WHERE id = ?').get(id) as DealRow | undefined;
  }

  function query(q: DealsQuery): { deals: DealWithLatestAnalysis[]; total: number } {
    const where: string[] = [];
    const params: Record<string, unknown> = {};

    if (q.tiers && q.tiers.length > 0) {
      const names = q.tiers.map((_, i) => `@tier${i}`);
      q.tiers.forEach((t, i) => (params[`tier${i}`] = t));
      where.push(`d.deal_tier IN (${names.join(',')})`);
    }
    if (q.min_price !== undefined) { where.push('d.price_total >= @min_price'); params.min_price = q.min_price; }
    if (q.max_price !== undefined) { where.push('d.price_total <= @max_price'); params.max_price = q.max_price; }
    if (q.min_discount !== undefined) { where.push('d.percent_below_market >= @min_discount'); params.min_discount = q.min_discount; }
    if (q.grader) { where.push('UPPER(d.grader) = UPPER(@grader)'); params.grader = q.grader; }
    if (q.min_grade !== undefined) { where.push('d.grade >= @min_grade'); params.min_grade = q.min_grade; }
    if (q.auction_only) where.push("d.listing_type = 'auction'");
    if (q.bin_only) where.push("d.listing_type = 'fixed_price'");
    if (q.marketplace) { where.push('d.marketplace = @marketplace'); params.marketplace = q.marketplace; }
    if (q.ends_within_h !== undefined) {
      where.push("d.ends_at IS NOT NULL AND d.ends_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now', @ends_mod)");
      params.ends_mod = `+${q.ends_within_h} hours`;
    }
    if (q.source && q.source !== 'all') { where.push('d.source = @source'); params.source = q.source; }
    if (q.active_only !== false) {
      // hide ended auctions; BIN listings age out of the feed's 48h window naturally
      where.push("(d.ends_at IS NULL OR d.ends_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))");
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const orderSql =
      q.sort === 'ends_at'
        ? 'ORDER BY d.ends_at IS NULL, d.ends_at ASC'
        : q.sort === 'price'
          ? 'ORDER BY d.price_total ASC'
          : 'ORDER BY d.percent_below_market DESC NULLS LAST';
    const limit = Math.min(Math.max(q.limit ?? 100, 1), 200);

    const total = (
      db.prepare(`SELECT COUNT(*) AS n FROM deals d ${whereSql}`).get(params) as { n: number }
    ).n;

    const rows = db
      .prepare(
        `SELECT d.*,
                a.id AS la_id, a.status AS la_status, a.recommendation AS la_recommendation,
                a.confidence AS la_confidence, a.assessed_condition AS la_assessed_condition,
                a.claim_match AS la_claim_match
         FROM deals d
         LEFT JOIN analyses a ON a.id = (
           SELECT id FROM analyses WHERE deal_id = d.id ORDER BY id DESC LIMIT 1
         )
         ${whereSql} ${orderSql} LIMIT ${limit}`,
      )
      .all(params) as Array<DealRow & Record<string, unknown>>;

    const deals: DealWithLatestAnalysis[] = rows.map((r) => {
      const {
        la_id, la_status, la_recommendation, la_confidence, la_assessed_condition, la_claim_match,
        ...deal
      } = r as Record<string, unknown>;
      const latest: LatestAnalysisSummary | null = la_id
        ? {
            id: la_id as number,
            status: la_status as LatestAnalysisSummary['status'],
            recommendation: (la_recommendation ?? null) as LatestAnalysisSummary['recommendation'],
            confidence: (la_confidence ?? null) as LatestAnalysisSummary['confidence'],
            assessed_condition: (la_assessed_condition ?? null) as string | null,
            claim_match: (la_claim_match ?? null) as string | null,
          }
        : null;
      return { deal: deal as unknown as DealRow, latest_analysis: latest };
    });

    return { deals, total };
  }

  return { upsert, getById, query };
}

export type DealsRepo = ReturnType<typeof createDealsRepo>;
