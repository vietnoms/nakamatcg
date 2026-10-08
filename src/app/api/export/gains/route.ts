import Papa from "papaparse";
import { type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { realizedGains, unrealizedGains } from "@/server/gains";

export const dynamic = "force-dynamic";

const dollars = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2));

/** Gain/loss as CSV for a P&L. Session checked by the proxy. */
export async function GET(req: NextRequest) {
  const view = req.nextUrl.searchParams.get("view") === "realized" ? "realized" : "unrealized";
  const db = getDb();
  const tz = process.env.APP_TZ ?? "America/Los_Angeles";
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz });
  let rows: Record<string, string | number>[];

  if (view === "unrealized") {
    const u = await unrealizedGains(db);
    const asOf = u.marketAsOf ? day.format(u.marketAsOf) : "";
    rows = u.rows
      .sort((a, b) => b.totalGainCents - a.totalGainCents)
      .map((r) => ({
        card: r.name,
        set: r.setName,
        number: r.cardNumber,
        variant: r.variant,
        condition_or_grade: r.badge,
        qty: r.qty,
        cost_each: dollars(r.costCents),
        market_each: dollars(r.marketCents),
        difference_each: dollars(r.gainCents),
        difference_pct: r.gainPct === null ? "" : r.gainPct.toFixed(2),
        total_cost: dollars(r.totalCostCents),
        total_market: dollars(r.totalMarketCents),
        total_difference: dollars(r.totalGainCents),
        market_as_of: asOf,
      }));
  } else {
    rows = (await realizedGains(db)).map((r) => ({
      date: day.format(r.occurredAt),
      show: r.eventName,
      how: r.how,
      code: r.code,
      card: r.name,
      set: r.setName,
      number: r.cardNumber,
      condition_or_grade: r.badge,
      sold_for: dollars(r.soldCents),
      cost: dollars(r.costCents),
      difference: dollars(r.gainCents),
      difference_pct: r.gainPct === null ? "" : r.gainPct.toFixed(2),
    }));
  }

  const stamp = day.format(new Date());
  return new Response(Papa.unparse(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${view}-gains-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
