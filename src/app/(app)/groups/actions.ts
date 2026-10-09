"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/auth/guard";
import { getDb } from "@/db/client";
import { createGroup, deleteGroup, moveUnits, updateGroup } from "@/server/groups";

const GroupInput = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(["own", "consignment"]),
  feeBps: z.number().int().min(0).max(10000).nullable(),
  minFeeCents: z.number().int().min(0).max(1_000_000).nullable(),
  note: z.string().max(500).optional(),
});

export async function createGroupAction(input: z.input<typeof GroupInput>): Promise<string> {
  await requireSession();
  const id = await createGroup(getDb(), GroupInput.parse(input));
  revalidatePath("/groups");
  return id;
}

export async function updateGroupAction(id: string, input: z.input<typeof GroupInput>): Promise<void> {
  await requireSession();
  await updateGroup(getDb(), z.string().uuid().parse(id), GroupInput.parse(input));
  revalidatePath("/groups", "layout");
}

export async function deleteGroupAction(id: string): Promise<void> {
  await requireSession();
  await deleteGroup(getDb(), z.string().uuid().parse(id));
  revalidatePath("/groups", "layout");
}

export async function moveUnitsAction(unitIds: string[], groupId: string | null): Promise<number> {
  await requireSession();
  const n = await moveUnits(getDb(), z.array(z.string().uuid()).max(5000).parse(unitIds), z.string().uuid().nullable().parse(groupId));
  revalidatePath("/groups", "layout");
  return n;
}
