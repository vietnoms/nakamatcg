/**
 * Quick intake at the table: a pile taken in for one amount ("14 cards and a slab, $85"), each
 * copy a placeholder until it is identified after the show. Pure, shared by the phone and tests.
 */
import { allocate } from "./allocate";

export type PlaceholderKind = "raw" | "slab" | "sealed";

export const PLACEHOLDER_NAME: Record<PlaceholderKind, string> = {
  raw: "Unidentified card",
  slab: "Unidentified slab",
  sealed: "Unidentified sealed",
};

export function placeholderProduct(kind: PlaceholderKind, hint = "") {
  return {
    kind,
    name: hint.trim() || PLACEHOLDER_NAME[kind],
    setName: "",
    cardNumber: "",
    variant: "",
    condition: "",
    grader: "",
    grade: "",
    cert: "",
    marketCents: null,
  };
}

/**
 * Splits a pile's total evenly over its copies, whole cents that add up exactly. Returns one
 * entry per kind present, each with its copies' amounts. The split can be redone by market once
 * the cards are identified.
 */
export function splitPile(counts: Record<PlaceholderKind, number>, totalCents: number): { kind: PlaceholderKind; costs: number[] }[] {
  const kinds = (["raw", "slab", "sealed"] as const).filter((k) => counts[k] > 0);
  const n = kinds.reduce((t, k) => t + counts[k], 0);
  if (n === 0) return [];
  const parts = allocate(totalCents, Array(n).fill(1));
  let i = 0;
  return kinds.map((kind) => {
    const costs = parts.slice(i, i + counts[kind]);
    i += counts[kind];
    return { kind, costs };
  });
}
