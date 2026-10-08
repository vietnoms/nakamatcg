/** Money is integer cents everywhere. These are the only conversions to and from text. */

export function parseDollars(input: string, opts: { allowNegative?: boolean } = {}): number | null {
  let s = input.trim().replace(/[$,\s]/g, "");
  let sign = 1;
  if (s.startsWith("-")) {
    if (!opts.allowNegative) return null;
    sign = -1;
    s = s.slice(1);
  }
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;
  const [whole = "0", frac = ""] = s.split(".");
  // integer arithmetic: parseFloat("0.29") * 100 is 28.999999999999996
  const cents = Number(whole || "0") * 100 + Number((frac + "00").slice(0, 2));
  const roundUp = Number(frac.charAt(2) || "0") >= 5 ? 1 : 0;
  return sign * (cents + roundUp);
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usdWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatCents(cents: number): string {
  return usd.format(cents / 100);
}

/** "$125" for whole dollars, "$4.50" otherwise. */
export function formatStickerPrice(cents: number): string {
  return cents % 100 === 0 ? usdWhole.format(cents / 100) : usd.format(cents / 100);
}
