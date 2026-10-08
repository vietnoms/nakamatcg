/**
 * ZPL for price stickers. Pure: the laptop builds the text and Browser Print sends it to the
 * Zebra. Layout (designed at 203 dpi for 1.5 x 1 in, scaled for other DPI):
 *
 *   +-----------+------------------+
 *   | QR code   | $125             |
 *   | (sticker  | K7M2QX           |
 *   |  link)    | PSA 10    10/09  |
 *   | Umbreon VMAX (alt art)       |
 *   | Evolving Skies 215/203       |
 *   +------------------------------+
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
};

export const DEFAULT_LABEL: LabelSettings = {
  widthIn: 1.5,
  heightIn: 1,
  dpi: 203,
  darkness: 0,
  offsetXDots: 0,
  offsetYDots: 0,
  speed: 3,
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

export function labelZpl(d: LabelData, s: LabelSettings, baseUrl: string): string {
  const k = s.dpi / 203;
  const px = (n: number) => Math.round(n * k);
  const W = Math.round(s.widthIn * s.dpi);
  const m = px(10);

  const url = stickerUrl(baseUrl, d.code);
  const mag = Math.max(2, Math.round(4 * k));
  const q = qrModules(url) * mag;

  // right column: price, code, badge and date
  const x0 = m + q + px(8);
  const rw = W - x0 - m;
  const price = formatStickerPrice(d.priceCents);
  const ph = Math.max(px(24), Math.min(px(60), Math.floor(rw / (price.length * 0.6))));
  const small = px(22);
  const codeY = m + ph + px(4);
  const badgeY = codeY + small + px(4);
  const badge = truncate(zplText(d.badge), Math.max(1, fitChars(rw, small) - 6));

  // bottom: two lines of name, one of set and number
  const tw = W - 2 * m;
  const nameF = px(24);
  const detailF = px(20);
  const nameY = Math.max(m + q + px(6), badgeY + small + px(4));
  const nameLines = wrap(zplText(d.name), fitChars(tw, nameF), 2);
  const detailY = nameY + 2 * nameF + px(2);
  const detail = truncate(zplText(d.detail), fitChars(tw, detailF));

  const f = (x: number, y: number, font: number, text: string) =>
    `^FO${x},${y}^A0N,${font},${font}^FD${text}^FS`;

  return [
    ...header(s),
    `${qrFO(m, m)}^BQN,2,${mag}^FD${qrField(url)}^FS`,
    f(x0, m, ph, price),
    f(x0, codeY, small, d.code),
    f(x0, badgeY, small, badge),
    `^FO${x0},${badgeY}^A0N,${small},${small}^FB${rw},1,0,R^FD${zplText(d.pricedOn)}^FS`,
    ...nameLines.map((line, i) => f(m, nameY + i * nameF, nameF, line)),
    detail ? f(m, detailY, detailF, detail) : "",
    "^PQ1",
    "^XZ",
  ]
    .filter(Boolean)
    .join("\n");
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
    "^PQ1",
    "^XZ",
  ].join("\n");
}

/** Makes the printer measure the new roll's label length and gaps. Run after loading labels. */
export const CALIBRATE_ZPL = "~JC";
