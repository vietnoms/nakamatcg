"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/auth/guard";
import { getDb } from "@/db/client";
import { saveSetting } from "@/server/settings";
import { createEvent, setStartingCash } from "@/server/summary";

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function createEventAction(input: { name: string; startsOn: string; endsOn: string; startingCashCents: number }): Promise<string> {
  await requireSession();
  const e = z
    .object({ name: z.string().trim().min(1).max(100), startsOn: Day, endsOn: Day, startingCashCents: z.number().int().min(0).max(10_000_000) })
    .parse(input);
  const db = getDb();
  const id = await createEvent(db, e);
  // a new show becomes the active one: phones pick it up on their next sync
  await saveSetting(db, "activeEventId", id);
  revalidatePath("/summary");
  return id;
}

export async function setActiveEvent(id: string | null): Promise<void> {
  await requireSession();
  await saveSetting(getDb(), "activeEventId", z.string().uuid().nullable().parse(id));
  revalidatePath("/summary");
}

export async function setStartingCashAction(eventId: string, cents: number): Promise<void> {
  await requireSession();
  await setStartingCash(getDb(), z.string().uuid().parse(eventId), z.number().int().min(0).max(10_000_000).parse(cents));
  revalidatePath("/summary");
}
