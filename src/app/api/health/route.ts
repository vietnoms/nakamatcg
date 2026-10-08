export const dynamic = "force-dynamic";

/** Public, no data: lets the phone tell "no signal" from "signed out". */
export function GET() {
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
