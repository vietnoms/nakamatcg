import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { posSnapshot } from "@/server/pos";

export const dynamic = "force-dynamic";

// the proxy has already checked the session for every /api route
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("since");
  const since = raw ? new Date(raw) : null;
  if (since && Number.isNaN(since.getTime())) return NextResponse.json({ error: "bad since" }, { status: 400 });
  return NextResponse.json(await posSnapshot(getDb(), since), { headers: { "Cache-Control": "no-store" } });
}
