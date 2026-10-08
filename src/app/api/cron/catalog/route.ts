import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { syncCatalog } from "@/server/catalog";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

/**
 * Nightly price catalog refresh (vercel.json crons; tcgcsv.com updates around 20:00 UTC).
 * Public to the proxy, so it checks Vercel's cron secret itself.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || got.length !== want.length || !timingSafeEqual(got, want)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await syncCatalog(getDb()));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "sync failed" }, { status: 502 });
  }
}
