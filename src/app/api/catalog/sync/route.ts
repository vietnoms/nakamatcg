import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { syncCatalog } from "@/server/catalog";

export const dynamic = "force-dynamic";
// about 300 sets, two requests each: a few minutes
export const maxDuration = 800;

/** "Refresh now" on Settings. The proxy has already checked the session. */
export async function POST() {
  try {
    return NextResponse.json(await syncCatalog(getDb()));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "sync failed" }, { status: 502 });
  }
}
