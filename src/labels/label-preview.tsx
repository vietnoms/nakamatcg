"use client";

import { encode } from "uqr";
import type { LabelData, LabelSettings } from "./zpl";
import { foldGeometry, labelFields } from "./zpl";

/**
 * An on-screen approximation of the sticker (same fields and positions as the ZPL, browser
 * fonts), to catch a wrong price or name before printing. The printed ZPL is the source of truth.
 */
export function LabelPreview({ data, settings, baseUrl, scale = 2.4 }: { data: LabelData; settings: LabelSettings; baseUrl: string; scale?: number }) {
  const W = Math.round(settings.widthIn * settings.dpi);
  const H = Math.round(settings.heightIn * settings.dpi);
  const fields = labelFields(data, settings, baseUrl);
  const fold = settings.layout === "fold" ? foldGeometry(settings, baseUrl) : null;

  return (
    <div style={{ maxWidth: W * scale * 0.5 * (203 / settings.dpi) }} className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full rounded border border-zinc-300 bg-white shadow-sm dark:border-zinc-700"
        style={{ fontFamily: "'Arial Narrow', Arial, sans-serif", fontWeight: 700 }}
      >
        {fold && fold.gap > 0 && <rect x={fold.front} y={0} width={fold.gap} height={H} fill="#eee" />}
        {fields.map((f, i) => {
          if (f.kind === "qr") {
            const qr = encode(f.data, { ecc: "M", border: 0 });
            return (
              <g key={i}>
                {qr.data.map((row, y) =>
                  row.map((on, x) => (on ? <rect key={`${x}-${y}`} x={f.x + x * f.mag} y={f.y + y * f.mag} width={f.mag} height={f.mag} fill="#000" /> : null)),
                )}
              </g>
            );
          }
          if (f.kind === "line") return <rect key={i} x={f.x} y={f.y} width={Math.max(f.w, f.thick)} height={Math.max(f.h, f.thick)} fill="#000" />;
          const anchor = f.box?.align === "C" ? "middle" : f.box?.align === "R" ? "end" : "start";
          const x = f.box?.align === "C" ? f.x + f.box.width / 2 : f.box?.align === "R" ? f.x + f.box.width : f.x;
          return (
            <text key={i} x={x} y={f.y + f.font * 0.85} fontSize={f.font} textAnchor={anchor} fill="#000">
              {f.text}
            </text>
          );
        })}
      </svg>
      {fold && (
        <div className="mt-1 flex text-[11px] text-zinc-500 dark:text-zinc-400">
          <span style={{ width: `${(fold.front / W) * 100}%` }} className="text-center">
            front
          </span>
          <span style={{ width: `${(fold.gap / W) * 100}%` }} />
          <span className="flex-1 text-center">back (wraps around the edge)</span>
        </div>
      )}
    </div>
  );
}
