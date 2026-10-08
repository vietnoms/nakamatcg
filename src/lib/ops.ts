/**
 * What the phone records and syncs. Every sale, bundle, buy, and trade is one "deal": cards out
 * (mine, leaving the table), misc lines (unstickered sales), cards in (bought or traded in), and
 * payments. A void cancels an earlier deal. Ids are made on the phone, so syncing twice is a no-op.
 * Shared by the phone and the server: no server-only imports.
 */
import { z } from "zod";

const Cents = z.number().int().min(0).max(100_000_000);
const Id = z.string().uuid();

export const ProductInput = z.object({
  kind: z.enum(["raw", "slab", "sealed"]),
  name: z.string().trim().min(1).max(200),
  setName: z.string().trim().max(200).default(""),
  cardNumber: z.string().trim().max(50).default(""),
  variant: z.string().trim().max(100).default(""),
  condition: z.string().trim().max(20).default(""),
  grader: z.string().trim().max(20).default(""),
  grade: z.string().trim().max(20).default(""),
  cert: z.string().trim().max(50).default(""),
  marketCents: Cents.nullable().default(null),
});
export type ProductInput = z.infer<typeof ProductInput>;

export const OutLine = z.object({ unitId: Id, amountCents: Cents, stickerCents: Cents.nullable() });
export const MiscLine = z.object({ description: z.string().trim().min(1).max(200), amountCents: Cents });
export const InLine = z.object({
  unitId: Id,
  code: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{6}$/),
  product: ProductInput,
  costCents: Cents,
  priceCents: Cents.nullable(),
});
export const Payment = z.object({ method: z.string().min(1).max(40), direction: z.enum(["in", "out"]), amountCents: Cents });

export const DealOp = z.object({
  type: z.literal("deal"),
  id: Id,
  kind: z.enum(["sale", "buy", "trade"]),
  occurredAt: z.string().datetime(),
  eventId: Id.nullable(),
  note: z.string().max(500).default(""),
  device: z.string().max(60).default(""),
  out: z.array(OutLine).max(500),
  misc: z.array(MiscLine).max(100),
  in: z.array(InLine).max(500),
  payments: z.array(Payment).max(10),
});
export type DealOp = z.infer<typeof DealOp>;

export const VoidOp = z.object({
  type: z.literal("void"),
  id: Id,
  voidsId: Id,
  occurredAt: z.string().datetime(),
  note: z.string().max(500).default(""),
  device: z.string().max(60).default(""),
});
export type VoidOp = z.infer<typeof VoidOp>;

export const Op = z.discriminatedUnion("type", [DealOp, VoidOp]);
export type Op = z.infer<typeof Op>;

const sum = (xs: { amountCents: number }[]) => xs.reduce((n, x) => n + x.amountCents, 0);

/**
 * Value given and taken must match: what left the table (cards out + misc), minus what came in
 * (cards bought or traded in, at cost), equals money in minus money out.
 */
export function dealBalance(d: Pick<DealOp, "out" | "misc" | "in" | "payments">): number {
  const goods = sum(d.out) + sum(d.misc) - d.in.reduce((n, l) => n + l.costCents, 0);
  const money = sum(d.payments.filter((p) => p.direction === "in")) - sum(d.payments.filter((p) => p.direction === "out"));
  return goods - money;
}
