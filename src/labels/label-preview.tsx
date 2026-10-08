"use client";

import { encode } from "uqr";
import { stickerUrl } from "@/lib/codes";
import { formatStickerPrice } from "@/lib/money";
import type { LabelData, LabelSettings } from "./zpl";
import { wrap, zplText } from "./zpl";

/**
 * An on-screen approximation of the sticker (same proportions and fields, browser fonts), to
 * catch a wrong price or name before printing. The printed ZPL is the source of truth.
 */
export function LabelPreview({ data, settings, baseUrl, scale = 2.4 }: { data: LabelData; settings: LabelSettings; baseUrl: string; scale?: number }) {
  // work in 203-dpi dots like the ZPL layout, then scale for the screen
  const W = settings.widthIn * 203;
  const H = settings.heightIn * 203;
  const qr = encode(stickerUrl(baseUrl, data.code), { ecc: "M", border: 0 });
  const mag = 4;
  const q = qr.size * mag;
  const m = 10;
  const x0 = m + q + 8;
  const price = formatStickerPrice(data.priceCents);
  const ph = Math.max(24, Math.min(60, Math.floor((W - x0 - m) / (price.length * 0.6))));
  const nameLines = wrap(zplText(data.name), Math.floor((W - 2 * m) / (24 * 0.56)), 2);
  const nameY = Math.max(m + q + 6, m + ph + 4 + 22 + 4 + 22 + 4);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full rounded border border-zinc-300 bg-white shadow-sm"
      style={{ maxWidth: W * scale * 0.5, fontFamily: "'Arial Narrow', Arial, sans-serif", fontWeight: 700 }}
    >
      {qr.data.map((row, y) =>
        row.map((on, x) => (on ? <rect key={`${x}-${y}`} x={m + x * mag} y={m + y * mag} width={mag} height={mag} fill="#000" /> : null)),
      )}
      <text x={x0} y={m + ph * 0.85} fontSize={ph}>
        {price}
      </text>
      <text x={x0} y={m + ph + 4 + 18} fontSize={22}>
        {data.code}
      </text>
      <text x={x0} y={m + ph + 4 + 22 + 4 + 18} fontSize={22}>
        {zplText(data.badge)}
      </text>
      <text x={W - m} y={m + ph + 4 + 22 + 4 + 18} fontSize={22} textAnchor="end">
        {data.pricedOn}
      </text>
      {nameLines.map((line, i) => (
        <text key={i} x={m} y={nameY + i * 24 + 20} fontSize={24}>
          {line}
        </text>
      ))}
      <text x={m} y={nameY + 48 + 2 + 17} fontSize={20}>
        {zplText(data.detail)}
      </text>
    </svg>
  );
}
