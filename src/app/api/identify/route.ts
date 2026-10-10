import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { isGame } from "@/lookup/match";
import { lookupCard } from "@/server/identify";
import { cardsightGradedPricer, cardsightProvider, claudeProvider } from "@/server/providers";

export const dynamic = "force-dynamic";
// CardSight answers in a second or two; a Claude fallback can take longer
export const maxDuration = 60;

const MAX_BYTES = 6 * 1024 * 1024;

// the proxy has already checked the session for every /api route
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("image");
  const g = form?.get("game");
  const game = isGame(g) ? g : "pokemon";
  if (!(file instanceof Blob) || !file.type.startsWith("image/")) return NextResponse.json({ error: "send an image" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "image too large (6 MB max)" }, { status: 413 });

  const result = await lookupCard(getDb(), { bytes: await file.arrayBuffer(), mediaType: file.type }, game, {
    cardsight: cardsightProvider(),
    claude: claudeProvider(),
    gradedPrice: cardsightGradedPricer(),
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
