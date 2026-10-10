import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { isGame } from "@/lookup/match";
import { searchCatalog } from "@/server/catalog";

export const dynamic = "force-dynamic";

// the proxy has already checked the session for every /api route
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 100);
  const g = req.nextUrl.searchParams.get("game");
  const game = isGame(g) ? g : null;
  return NextResponse.json({ results: await searchCatalog(getDb(), q, game) }, { headers: { "Cache-Control": "no-store" } });
}
