import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { MAX_PHOTO_BYTES, savePhoto } from "@/server/photos";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

/** A deal photo from the phone (multipart: id, dealId, takenAt, image). The proxy has checked the session. */
export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart form data" }, { status: 400 });
  }
  const id = String(form.get("id") ?? "");
  const dealId = String(form.get("dealId") ?? "");
  const takenAt = new Date(String(form.get("takenAt") ?? ""));
  const image = form.get("image");
  if (!UUID.test(id) || !UUID.test(dealId) || Number.isNaN(takenAt.getTime())) return NextResponse.json({ error: "bad id, deal or time" }, { status: 400 });
  if (!(image instanceof Blob) || !image.type.startsWith("image/")) return NextResponse.json({ error: "image must be a picture" }, { status: 400 });
  if (image.size > MAX_PHOTO_BYTES) return NextResponse.json({ error: "photo too large" }, { status: 413 });

  const res = await savePhoto(getDb(), { id, dealId, takenAt, mime: image.type, bytes: new Uint8Array(await image.arrayBuffer()) });
  if (res === "no-deal") return NextResponse.json({ error: "deal not synced yet" }, { status: 404 });
  return NextResponse.json({ status: res }, { headers: { "Cache-Control": "no-store" } });
}
