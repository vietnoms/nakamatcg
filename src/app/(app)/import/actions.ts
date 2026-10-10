"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/auth/guard";
import { getDb } from "@/db/client";
import { FIELDS, parseCsv, parseRows, type Mapping } from "@/import/collectr";
import { createGroup, getGroup, nameTaken } from "@/server/groups";
import { applyImport, planImport, type ImportPlan, type ImportResult, type ImportTarget } from "@/server/import";
import { addStock } from "@/server/stock";

const Input = z.object({
  text: z.string().min(1).max(8_000_000),
  filename: z.string().max(200),
  mapping: z.object(Object.fromEntries(FIELDS.map((f) => [f, z.number().int().min(0).nullable()]))),
  /** null: every portfolio */
  portfolios: z.array(z.string()).nullable(),
  /** whose cards: mine (grouped by portfolio), an existing consignor's, or a new consignor */
  owner: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("own") }),
      z.object({ kind: z.literal("consignment"), groupId: z.string().uuid() }),
      z.object({
        kind: z.literal("newConsignor"),
        name: z.string().trim().min(1).max(100),
        feeBps: z.number().int().min(0).max(10000),
        minFeeCents: z.number().int().min(0).max(1_000_000),
      }),
    ])
    .default({ kind: "own" }),
  /** bought as a lot: every new copy costs this % of market (own cards only) */
  lotPercent: z.number().min(1).max(200).nullable().default(null),
  /** cards already here in another group: move them into the portfolio's group instead of adding copies */
  moveExisting: z.boolean().default(false),
});
type ImportInput = z.infer<typeof Input>;

function items(input: ImportInput) {
  const { rows } = parseCsv(input.text);
  const { items, skipped } = parseRows(rows, input.mapping as Mapping);
  const keep = input.portfolios ? new Set(input.portfolios) : null;
  // the portfolios left out still lend their costs to the same cards scanned into the ones brought
  return { items: keep ? items.filter((i) => keep.has(i.portfolio)) : items, costDonors: keep ? items.filter((i) => !keep.has(i.portfolio)) : [], skipped };
}

/** A new consignor has no cards yet: preview against a group nobody has. */
const NOBODY = "00000000-0000-0000-0000-000000000000";

async function target(owner: ImportInput["owner"], create: boolean): Promise<ImportTarget> {
  if (owner.kind === "own") return { kind: "own" };
  if (owner.kind === "consignment") {
    const g = await getGroup(getDb(), owner.groupId);
    if (!g || g.kind !== "consignment") throw new Error("That consignor's group is gone. Pick another.");
    return { kind: "consignment", groupId: g.id };
  }
  if (await nameTaken(getDb(), owner.name)) throw new Error(`There is already a group called "${owner.name}". Pick it from the list instead.`);
  if (!create) return { kind: "consignment", groupId: NOBODY };
  const groupId = await createGroup(getDb(), { name: owner.name, kind: "consignment", feeBps: owner.feeBps, minFeeCents: owner.minFeeCents });
  return { kind: "consignment", groupId };
}

export async function previewImport(raw: z.input<typeof Input>): Promise<ImportPlan & { skipped: { line: number; reason: string; name: string }[] }> {
  await requireSession();
  const input = Input.parse(raw);
  if (input.mapping.name === null) throw new Error("Pick the column that holds the card name.");
  const { items: list, costDonors, skipped } = items(input);
  return { ...(await planImport(getDb(), list, await target(input.owner, false), { costDonors, lotPercent: input.lotPercent ?? undefined, moveExisting: input.moveExisting })), skipped };
}

export async function commitImport(raw: z.input<typeof Input>): Promise<ImportResult & { groupId: string | null }> {
  await requireSession();
  const input = Input.parse(raw);
  if (input.mapping.name === null) throw new Error("Pick the column that holds the card name.");
  const t = await target(input.owner, true);
  const { items: list, costDonors } = items(input);
  const res = { ...(await applyImport(getDb(), list, input.filename, t, { costDonors, lotPercent: input.lotPercent ?? undefined, moveExisting: input.moveExisting })), groupId: t.kind === "consignment" ? t.groupId : null };
  revalidatePath("/", "layout");
  return res;
}

const StockInput = z.object({
  product: z.object({
    kind: z.enum(["raw", "slab", "sealed"]),
    name: z.string().trim().min(1).max(200),
    setName: z.string().trim().max(200),
    cardNumber: z.string().trim().max(50),
    variant: z.string().trim().max(100),
    condition: z.string().trim().max(20),
    grader: z.string().trim().max(20),
    grade: z.string().trim().max(20),
    cert: z.string().trim().max(50),
    marketCents: z.number().int().min(0).nullable(),
  }),
  qty: z.number().int().min(1).max(500),
  costCents: z.number().int().min(0).max(100_000_000).nullable(),
  priceCents: z.number().int().min(0).max(100_000_000).nullable(),
  groupId: z.string().uuid().nullable(),
});

/** Adds copies by hand (sealed from a distributor, a store buy): no Collectr, no customer. */
export async function addStockAction(raw: z.input<typeof StockInput>): Promise<{ codes: string[] }> {
  await requireSession();
  const input = StockInput.parse(raw);
  if (input.groupId) {
    const g = await getGroup(getDb(), input.groupId);
    if (!g || g.kind === "consignment") throw new Error("Pick one of your own groups.");
  }
  const { codes } = await addStock(getDb(), input);
  revalidatePath("/", "layout");
  return { codes };
}
