import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { applyOps } from "@/server/ops";

export const dynamic = "force-dynamic";

// the proxy has already checked the session for every /api route
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const ops = (body as { ops?: unknown })?.ops;
  if (!Array.isArray(ops) || ops.length > 200) return NextResponse.json({ error: "ops must be an array of at most 200" }, { status: 400 });
  return NextResponse.json({ results: await applyOps(getDb(), ops) }, { headers: { "Cache-Control": "no-store" } });
}
