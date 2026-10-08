import Papa from "papaparse";
import { type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { getSettings } from "@/server/settings";
import { summarize } from "@/server/summary";

export const dynamic = "force-dynamic";

/** Cards that left in a show (sold or traded), to remove from Collectr by hand. Session checked by the proxy. */
export async function GET(req: NextRequest) {
  const ev = req.nextUrl.searchParams.get("event");
  const day = req.nextUrl.searchParams.get("day") ?? undefined;
  const eventId = !ev || ev === "none" ? null : ev;
  if (eventId && !/^[0-9a-f-]{36}$/i.test(eventId)) return new Response("bad event", { status: 400 });
  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return new Response("bad day", { status: 400 });

  const db = getDb();
  const tz = process.env.APP_TZ ?? "America/Los_Angeles";
  const s = await summarize(db, { eventId, day, tz, methods: (await getSettings(db)).paymentMethods });
  const rows = s.deals
    .filter((d) => !d.voided)
    .flatMap((d) =>
      d.lines
        .filter((l) => l.direction === "out" && l.code)
        .map((l) => ({
          date: new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d.occurredAt),
          kind: d.kind === "trade" ? "traded" : "sold",
          code: l.code,
          card: l.name,
          set_and_number: l.detail,
          sticker: l.stickerCents === null ? "" : (l.stickerCents / 100).toFixed(2),
          got: (l.amountCents / 100).toFixed(2),
          cost: l.costCents === null ? "" : (l.costCents / 100).toFixed(2),
        })),
    );
  return new Response(Papa.unparse(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="sold-${day ?? "show"}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
