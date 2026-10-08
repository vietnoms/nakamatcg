"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/auth/guard";
import { getDb } from "@/db/client";
import { FIELDS, parseCsv, parseRows, type Mapping } from "@/import/collectr";
import { applyImport, planImport, type ImportPlan, type ImportResult } from "@/server/import";

const Input = z.object({
  text: z.string().min(1).max(8_000_000),
  filename: z.string().max(200),
  mapping: z.object(Object.fromEntries(FIELDS.map((f) => [f, z.number().int().min(0).nullable()]))),
  /** null: every portfolio */
  portfolios: z.array(z.string()).nullable(),
});
type ImportInput = z.infer<typeof Input>;

function items(input: ImportInput) {
  const { rows } = parseCsv(input.text);
  const { items, skipped } = parseRows(rows, input.mapping as Mapping);
  const keep = input.portfolios ? new Set(input.portfolios) : null;
  return { items: keep ? items.filter((i) => keep.has(i.portfolio)) : items, skipped };
}

export async function previewImport(raw: ImportInput): Promise<ImportPlan & { skipped: { line: number; reason: string; name: string }[] }> {
  await requireSession();
  const input = Input.parse(raw);
  if (input.mapping.name === null) throw new Error("Pick the column that holds the card name.");
  const { items: list, skipped } = items(input);
  return { ...(await planImport(getDb(), list)), skipped };
}

export async function commitImport(raw: ImportInput): Promise<ImportResult> {
  await requireSession();
  const input = Input.parse(raw);
  if (input.mapping.name === null) throw new Error("Pick the column that holds the card name.");
  const res = await applyImport(getDb(), items(input).items, input.filename);
  revalidatePath("/", "layout");
  return res;
}
