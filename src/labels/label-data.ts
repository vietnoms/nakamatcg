import { badgeFor, type ProductKind } from "@/import/collectr";
import type { LabelData } from "./zpl";

type Item = {
  code: string;
  priceCents: number;
  kind: ProductKind;
  name: string;
  setName: string;
  cardNumber: string;
  variant: string;
  condition: string;
  grader: string;
  grade: string;
};

/** Variants that change the price get a short tag on the sticker; plain ones say nothing. */
const VARIANT_TAGS: [RegExp, string][] = [
  [/reverse/i, "Rev Holo"],
  [/1st|first/i, "1st Ed"],
  [/shadowless/i, "Shadowless"],
  [/master ?ball/i, "Master Ball"],
  [/poke ?ball/i, "Poke Ball"],
  [/staff/i, "Staff"],
  [/stamp|promo/i, "Stamped"],
];

export function variantTag(variant: string): string {
  for (const [re, tag] of VARIANT_TAGS) if (re.test(variant)) return tag;
  return "";
}

/** "Mar 9" style short date in the display time zone, as MM/DD. */
export function shortDate(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "2-digit", day: "2-digit" }).format(d);
}

export function labelDataFor(item: Item, pricedOn: string): LabelData {
  const num = item.cardNumber ? `#${item.cardNumber.replace(/^#/, "")}` : "";
  return {
    code: item.code,
    priceCents: item.priceCents,
    name: item.name,
    detail: [item.setName, num, variantTag(item.variant)].filter(Boolean).join(" "),
    badge: badgeFor(item),
    pricedOn,
  };
}
