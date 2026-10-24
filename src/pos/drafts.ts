/** Drafts of carts (finished or not), kept on this phone. See LocalDraft in ./db. */
import { posDb, type LocalDraft } from "./db";

export async function saveDraft(d: Omit<LocalDraft, "createdAt" | "updatedAt">): Promise<void> {
  const db = posDb();
  const now = new Date().toISOString();
  const prev = await db.drafts.get(d.id);
  await db.drafts.put({ ...d, createdAt: prev?.createdAt ?? now, updatedAt: now });
}

export async function setDraftState(id: string, state: LocalDraft["state"]): Promise<void> {
  await posDb().drafts.update(id, { state, updatedAt: new Date().toISOString() });
}

/** Drafts other than the cart on screen, newest first. */
export async function listDrafts(exceptId: string | null): Promise<(LocalDraft & { photos: number })[]> {
  const db = posDb();
  const ds = (await db.drafts.orderBy("updatedAt").reverse().toArray()).filter((d) => d.id !== exceptId);
  return Promise.all(ds.map(async (d) => ({ ...d, photos: await db.photos.where("draftId").equals(d.id).count() })));
}

export async function getDraft(id: string): Promise<LocalDraft | undefined> {
  return posDb().drafts.get(id);
}

/** Deletes a draft and the photos taken for it (photos of confirmed deals are not draft photos). */
export async function deleteDraft(id: string): Promise<void> {
  const db = posDb();
  await db.transaction("rw", [db.drafts, db.photos], async () => {
    await db.photos.where("draftId").equals(id).and((p) => p.state === "cart").delete();
    await db.drafts.delete(id);
  });
}
