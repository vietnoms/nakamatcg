import { type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { getPhoto } from "@/server/photos";

export const dynamic = "force-dynamic";

/** One deal photo. Photos never change (append-only), so the browser may keep them. Session checked by the proxy. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("bad id", { status: 400 });
  const photo = await getPhoto(getDb(), id);
  if (!photo) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(photo.bytes), {
    headers: { "Content-Type": photo.mime, "Cache-Control": "private, max-age=31536000, immutable" },
  });
}
