import Papa from "papaparse";
import { type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { consignmentReport, getGroup } from "@/server/groups";

export const dynamic = "force-dynamic";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A consignor's statement: each card sold, my fee, and what I owe. Session checked by the proxy. */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("group") ?? "";
  const from = req.nextUrl.searchParams.get("from") || undefined;
  const to = req.nextUrl.searchParams.get("to") || undefined;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("bad group", { status: 400 });
  if ((from && !DAY.test(from)) || (to && !DAY.test(to))) return new Response("bad date", { status: 400 });

  const db = getDb();
  const group = await getGroup(db, id);
  if (!group || group.kind !== "consignment") return new Response("not a consignment group", { status: 404 });
  const tz = process.env.APP_TZ ?? "America/Los_Angeles";
  const r = await consignmentReport(db, group, { from, to, tz });
  const d = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2));
  const rows: Record<string, string>[] = r.sales.map((s) => ({
    date: new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(s.occurredAt),
    how: s.how,
    code: s.code,
    card: s.name,
    set_and_number: [s.setName, s.cardNumber && `#${s.cardNumber}`].filter(Boolean).join(" "),
    condition: s.badge,
    sticker: d(s.stickerCents),
    sold_for: d(s.soldCents),
    fee: d(s.feeCents),
    payout: d(s.payoutCents),
  }));
  rows.push({ date: "TOTAL", how: "", code: "", card: `${r.totals.cards} card${r.totals.cards === 1 ? "" : "s"}`, set_and_number: "", condition: "", sticker: "", sold_for: d(r.totals.soldCents), fee: d(r.totals.feeCents), payout: d(r.totals.payoutCents) });
  const slug = group.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "consignor";
  return new Response(Papa.unparse(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="consignment-${slug}${from ? `-${from}` : ""}${to ? `-to-${to}` : ""}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
