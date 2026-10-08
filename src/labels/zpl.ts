/**
 * ZPL for price stickers. Pure: the laptop builds the text and Browser Print sends it to the
 * Zebra. Each layout is a list of fields (text, QR, line) that both the ZPL and the on-screen
 * preview draw. Designed at 203 dpi for 1.5 x 1 in, scaled for other DPI.
 *
 * standard:                           fold (wraps around the toploader's side edge):
 *   +-----------+------------------+    +-------+ : +-----------+--------+
 *   | QR code   | $125             |    |       | : | QR code   | K7M2QX |
 *   | (sticker  | K7M2QX    10/09  |    | $125  | : | (sticker  | 10/09  |
 *   |  link)    | CGC 10 Pristine  |    |PSA 10 | : |  link)    | $125   |
 *   | Umbreon VMAX (alt art)       |    |       | : | Umbreon VMAX (alt  |
 *   | Evolving Skies 215/203       |    |       | : | Evolving Skies 215 |
 *   +------------------------------+    +-------+ : +-----------+--------+
 *                                         front  edge   back
 */
import { formatStickerPrice } from "@/lib/money";
import { stickerUrl } from "@/lib/codes";

export type LabelSettings = {
  widthIn: number;
  heightIn: number;
  dpi: number;
  /** ^MD, relative darkness -30..30 */
  darkness: number;
  /** ^LH, shifts everything right and down, in dots */
  offsetXDots: number;
  offsetYDots: number;
  /** ^PR, inches per second; slower prints small text sharper */
  speed: number;
  /** standard: everything on one face; fold: price and condition on a front strip, the rest wraps to the back */
  layout: LabelLayout;
  /** fold: width of the front strip (price and condition) */
  foldFrontIn: number;
  /** fold: blank band left for the toploader's edge between the front strip and the back */
  foldGapIn: number;
};

export type LabelLayout = "standard" | "fold";

export const DEFAULT_LABEL: LabelSettings = {
  widthIn: 1.5,
  heightIn: 1,
  dpi: 203,
  darkness: 0,
  offsetXDots: 0,
  offsetYDots: 0,
  speed: 3,
  layout: "standard",
  foldFrontIn: 0.5,
  foldGapIn: 0.08,
};

export type LabelData = {
  code: string;
  priceCents: number;
  /** card or product name */
  name: string;
  /** set and number, e.g. "Evolving Skies 215/203" */
  detail: string;
  /** condition, grade, or "Sealed" */
  badge: string;
  /** short priced date, e.g. "10/09" */
  pricedOn: string;
};

/** Printable ASCII only: the built-in font has no accents, and ^ and ~ are ZPL commands. */
export function zplText(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^ -~]/g, "")
    .replace(/[~^]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Font 0 is proportional; this over-estimates the advance so text never runs off the label. */
const ADVANCE = 0.56;

function fitChars(widthDots: number, fontDots: number): number {
  return Math.max(1, Math.floor(widthDots / (fontDots * ADVANCE)));
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1)).trimEnd()}.`;
}

/** Word-wraps into at most `lines` lines of `max` characters; the last line is truncated. */
export function wrap(s: string, max: number, lines: number): string[] {
  const words = s.split(" ").filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < words.length; i++) {
    const w = words[i] ?? "";
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= max) {
      cur = next;
      continue;
    }
    if (out.length === lines - 1) {
      out.push(truncate([cur, ...words.slice(i)].filter(Boolean).join(" "), max));
      return out;
    }
    if (cur) out.push(cur);
    cur = w.length > max ? truncate(w, max) : w;
  }
  if (cur) out.push(cur);
  return out.slice(0, lines);
}

/** QR alphanumeric mode covers 0-9, A-Z, space and $%*+-./: only. */
const QR_ALNUM = /^[0-9A-Z $%*+\-./:]*$/;

/** Version needed at error correction M (alphanumeric capacities), so we know the QR's size. */
function qrModules(data: string): number {
  const alnum = QR_ALNUM.test(data);
  const caps = alnum ? [20, 38, 61, 90, 122, 154] : [14, 26, 42, 62, 84, 106];
  const v = caps.findIndex((c) => data.length <= c) + 1 || 7;
  return 17 + 4 * v;
}

/**
 * ^BQ draws the QR 10 dots below its ^FO y at every magnification and DPI (measured), so the
 * field origin is raised by that much to put the QR's top edge at the margin.
 */
const BQ_TOP_OFFSET = 10;

function qrFO(x: number, top: number): string {
  return `^FO${x},${Math.max(0, top - BQ_TOP_OFFSET)}`;
}

function qrField(data: string): string {
  // MM,A = error correction M, manual input, alphanumeric; MA = automatic for anything else
  return QR_ALNUM.test(data) ? `MM,A${data}` : `MA,${data}`;
}

function header(s: LabelSettings): string[] {
  const w = Math.round(s.widthIn * s.dpi);
  const h = Math.round(s.heightIn * s.dpi);
  return [
    "^XA",
    "^MMT", // tear-off
    "^MTD", // direct thermal: no ribbon
    `^PW${w}`,
    `^LL${h}`,
    `^LH${Math.max(0, Math.round(s.offsetXDots))},${Math.max(0, Math.round(s.offsetYDots))}`,
    `^PR${s.speed}`,
    `^MD${Math.max(-30, Math.min(30, Math.round(s.darkness)))}`,
  ];
}

/** One thing drawn on a sticker, in printer dots. Text y is the top of the letters. */
export type LabelField =
  | { kind: "text"; x: number; y: number; font: number; text: string; box?: { width: number; align: "R" | "C" } }
  | { kind: "qr"; x: number; y: number; mag: number; data: string; size: number }
  | { kind: "line"; x: number; y: number; w: number; h: number; thick: number };

const text = (x: number, y: number, font: number, t: string, box?: { width: number; align: "R" | "C" }): LabelField =>
  ({ kind: "text", x, y, font, text: t, ...(box ? { box } : {}) });

function scale(s: LabelSettings) {
  const k = s.dpi / 203;
  return { px: (n: number) => Math.round(n * k), W: Math.round(s.widthIn * s.dpi), H: Math.round(s.heightIn * s.dpi), mag: Math.max(2, Math.round(4 * k)) };
}

function standardFields(d: LabelData, s: LabelSettings, baseUrl: string): LabelField[] {
  const { px, W, mag } = scale(s);
  const m = px(10);

  const url = stickerUrl(baseUrl, d.code);
  const q = qrModules(url) * mag;

  // right column: price; code with the date beside it; the badge with the whole width, its font
  // shrinking to fit a long one ("CGC 10 Pristine")
  const x0 = m + q + px(8);
  const rw = W - x0 - m;
  const price = formatStickerPrice(d.priceCents);
  const ph = Math.max(px(24), Math.min(px(60), Math.floor(rw / (price.length * 0.6))));
  const small = px(22);
  const codeY = m + ph + px(4);
  const badgeY = codeY + small + px(4);
  const badgeText = zplText(d.badge);
  const badgeF = Math.max(px(16), Math.min(small, Math.floor(rw / (Math.max(1, badgeText.length) * ADVANCE))));
  const badge = truncate(badgeText, fitChars(rw, badgeF));

  // bottom: two lines of name, one of set and number
  const tw = W - 2 * m;
  const nameF = px(24);
  const detailF = px(20);
  const nameY = Math.max(m + q + px(6), badgeY + small + px(4));
  const nameLines = wrap(zplText(d.name), fitChars(tw, nameF), 2);
  const detailY = nameY + 2 * nameF + px(2);
  const detail = truncate(zplText(d.detail), fitChars(tw, detailF));

  return [
    { kind: "qr", x: m, y: m, mag, data: url, size: q },
    text(x0, m, ph, price),
    text(x0, codeY, small, d.code),
    text(x0, codeY, small, zplText(d.pricedOn), { width: rw, align: "R" }),
    ...(badge ? [text(x0, badgeY + (small - badgeF), badgeF, badge)] : []),
    ...nameLines.map((line, i) => text(m, nameY + i * nameF, nameF, line)),
    ...(detail ? [text(m, detailY, detailF, detail)] : []),
  ];
}

/** Where the fold layout's parts go: front strip [0, front), edge band, back [backX, W). */
export function foldGeometry(s: LabelSettings, baseUrl: string) {
  const { px, W, mag } = scale(s);
  const m = px(10);
  const q = qrModules(stickerUrl(baseUrl, "XXXXXX")) * mag;
  const gap = Math.max(0, Math.round(s.foldGapIn * s.dpi));
  // the back must keep room for the QR; the front gets what is left if it was set too wide
  const front = Math.max(px(40), Math.min(Math.round(s.foldFrontIn * s.dpi), W - gap - q - 2 * m));
  return { front, gap, backX: front + gap };
}

function foldFields(d: LabelData, s: LabelSettings, baseUrl: string): LabelField[] {
  const { px, W, H, mag } = scale(s);
  const m = px(10);
  const { front, gap, backX } = foldGeometry(s, baseUrl);
  const out: LabelField[] = [];

  // front: price, condition under it, centered in the strip; nothing else covers the card
  const fw = front - 2 * px(4);
  const price = formatStickerPrice(d.priceCents);
  const pf = Math.max(px(20), Math.min(px(64), Math.floor(fw / (price.length * 0.6))));
  // a long grade ("CGC 9.5 Pristine") takes two lines rather than losing its words
  const longest = Math.max(1, ...zplText(d.badge).split(" ").map((w) => w.length));
  const bf = Math.max(px(16), Math.min(px(22), Math.floor(fw / (longest * ADVANCE))));
  const badgeLines = wrap(zplText(d.badge), fitChars(fw, bf), 2);
  const blockH = pf + (badgeLines.length ? px(6) + badgeLines.length * bf : 0);
  const top = Math.max(0, Math.round((H - blockH) / 2));
  out.push(text(0, top, pf, price, { width: front, align: "C" }));
  badgeLines.forEach((line, i) => out.push(text(0, top + pf + px(6) + i * bf, bf, line, { width: front, align: "C" })));

  // fold marks: short ticks at the top and bottom of the edge band, to line it up with the toploader
  const tick = px(14);
  for (const x of gap > 0 ? [front, backX - 1] : [front]) {
    out.push({ kind: "line", x, y: 0, w: 1, h: tick, thick: 1 });
    out.push({ kind: "line", x, y: H - tick, w: 1, h: tick, thick: 1 });
  }

  // back: QR with code, date and price beside it; name and set below, two lines each
  const url = stickerUrl(baseUrl, d.code);
  const q = qrModules(url) * mag;
  const bx = backX + px(4);
  out.push({ kind: "qr", x: bx, y: m, mag, data: url, size: q });
  const x0 = bx + q + px(4);
  const rw = W - x0 - px(2);
  if (rw >= px(30)) {
    // codes are all capitals: size them wider than mixed text so all six letters fit
    const cf = Math.max(px(14), Math.min(px(22), Math.floor(rw / (d.code.length * 0.7))));
    const priceSmall = formatStickerPrice(d.priceCents);
    const sf = Math.max(px(14), Math.min(px(22), Math.floor(rw / (priceSmall.length * 0.6))));
    out.push(text(x0, m, cf, d.code));
    out.push(text(x0, m + cf + px(4), cf, zplText(d.pricedOn)));
    out.push(text(x0, m + 2 * (cf + px(4)), sf, priceSmall));
  }
  const tw = W - bx - px(2);
  const nameF = px(20);
  const detailF = px(17);
  let y = m + q + px(4);
  for (const line of wrap(zplText(d.name), fitChars(tw, nameF), 2)) {
    out.push(text(bx, y, nameF, line));
    y += nameF;
  }
  y += px(2);
  for (const line of wrap(zplText(d.detail), fitChars(tw, detailF), 2)) {
    if (y + detailF > H) break;
    out.push(text(bx, y, detailF, line));
    y += detailF;
  }
  return out;
}

/** The fields of one sticker in the chosen layout. */
export function labelFields(d: LabelData, s: LabelSettings, baseUrl: string): LabelField[] {
  return s.layout === "fold" ? foldFields(d, s, baseUrl) : standardFields(d, s, baseUrl);
}

function fieldZpl(f: LabelField): string {
  switch (f.kind) {
    case "qr":
      return `${qrFO(f.x, f.y)}^BQN,2,${f.mag}^FD${qrField(f.data)}^FS`;
    case "line":
      return `^FO${f.x},${f.y}^GB${f.w},${f.h},${f.thick}^FS`;
    case "text":
      return f.box
        ? `^FO${f.x},${f.y}^A0N,${f.font},${f.font}^FB${f.box.width},1,0,${f.box.align}^FD${f.text}^FS`
        : `^FO${f.x},${f.y}^A0N,${f.font},${f.font}^FD${f.text}^FS`;
  }
}

export function labelZpl(d: LabelData, s: LabelSettings, baseUrl: string): string {
  return [...header(s), ...labelFields(d, s, baseUrl).map(fieldZpl), "^PQ1", "^XZ"].join("\n");
}

export function batchZpl(labels: LabelData[], s: LabelSettings, baseUrl: string): string {
  return labels.map((d) => labelZpl(d, s, baseUrl)).join("\n");
}

/** A border, the size and DPI in words, and a sample QR, to check alignment and scanning. */
export function testLabelZpl(s: LabelSettings, baseUrl: string): string {
  const k = s.dpi / 203;
  const px = (n: number) => Math.round(n * k);
  const W = Math.round(s.widthIn * s.dpi);
  const H = Math.round(s.heightIn * s.dpi);
  const m = px(10);
  const url = stickerUrl(baseUrl, "TEST00");
  const mag = Math.max(2, Math.round(4 * k));
  const q = qrModules(url) * mag;
  return [
    ...header(s),
    `^FO0,0^GB${W},${H},${px(3)}^FS`,
    `${qrFO(m, m)}^BQN,2,${mag}^FD${qrField(url)}^FS`,
    `^FO${m + q + px(8)},${m}^A0N,${px(28)},${px(28)}^FDTEST^FS`,
    `^FO${m + q + px(8)},${m + px(34)}^A0N,${px(20)},${px(20)}^FD${s.widthIn} x ${s.heightIn} in^FS`,
    `^FO${m + q + px(8)},${m + px(58)}^A0N,${px(20)},${px(20)}^FD${s.dpi} dpi^FS`,
    `^FO${m},${H - m - px(20)}^A0N,${px(20)},${px(20)}^FDScan me: /u/TEST00^FS`,
    ...(s.layout === "fold" ? foldTestMarks(s, baseUrl) : []),
    "^PQ1",
    "^XZ",
  ].join("\n");
}

/** Fold layout: lines at the edge band so the test sticker shows where it should bend. */
function foldTestMarks(s: LabelSettings, baseUrl: string): string[] {
  const H = Math.round(s.heightIn * s.dpi);
  const { front, backX } = foldGeometry(s, baseUrl);
  return [...new Set([front, backX - 1])].map((x) => `^FO${x},0^GB1,${H},1^FS`);
}

/** Makes the printer measure the new roll's label length and gaps. Run after loading labels. */
export const CALIBRATE_ZPL = "~JC";
