"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Badge, Button, Card } from "@/components/ui";
import { defaultPrinter, sendZpl, type ZebraDevice } from "@/labels/browser-print";
import { labelDataFor } from "@/labels/label-data";
import { LabelPreview } from "@/labels/label-preview";
import { CALIBRATE_ZPL, batchZpl, testLabelZpl, type LabelSettings } from "@/labels/zpl";
import { formatCents } from "@/lib/money";
import type { LabelQueueItem } from "@/server/inventory";
import { markPrintedAction, reprintCodes } from "./actions";

/** Labels per write: a failure part-way through loses at most one batch, and the queue stays right. */
const BATCH = 20;

export function LabelsClient({
  queue: initial,
  settings,
  baseUrl,
  pricedOn,
}: {
  queue: LabelQueueItem[];
  settings: LabelSettings;
  baseUrl: string;
  pricedOn: string;
}) {
  const [queue, setQueue] = useState(initial);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initial.map((q) => q.unitId)));
  const [printer, setPrinter] = useState<ZebraDevice | null>(null);
  const [printerError, setPrinterError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reprintText, setReprintText] = useState("");
  const [pending, start] = useTransition();

  async function findPrinter() {
    setPrinterError(null);
    try {
      const p = await defaultPrinter();
      setPrinter(p);
      if (!p) setPrinterError("Browser Print is running but has no default printer. Open its settings and pick the Zebra.");
    } catch (e) {
      setPrinter(null);
      setPrinterError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void findPrinter();
  }, []);

  const chosen = useMemo(() => queue.filter((q) => selected.has(q.unitId)), [queue, selected]);
  const [search, setSearch] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const shown = useMemo(() => {
    const n = search.trim().toLowerCase();
    return n ? queue.filter((x) => `${x.code} ${x.name} ${x.setName} ${x.cardNumber}`.toLowerCase().includes(n)) : queue;
  }, [queue, search]);
  const labels = useMemo(() => chosen.map((q) => ({ unitId: q.unitId, data: labelDataFor(q, pricedOn) })), [chosen, pricedOn]);

  function print() {
    if (!printer || labels.length === 0 || !baseUrl) return;
    setError(null);
    start(async () => {
      let done = 0;
      try {
        for (let i = 0; i < labels.length; i += BATCH) {
          const part = labels.slice(i, i + BATCH);
          setProgress(`Printing ${done + 1}-${done + part.length} of ${labels.length}...`);
          await sendZpl(printer, batchZpl(part.map((l) => l.data), settings, baseUrl));
          const ids = part.map((l) => l.unitId);
          await markPrintedAction(ids);
          done += part.length;
          const gone = new Set(ids);
          setQueue((q) => q.filter((x) => !gone.has(x.unitId)));
        }
        setProgress(`Printed ${done} stickers.`);
      } catch (e) {
        setError(`${e instanceof Error ? e.message : String(e)} Printed ${done} before the error; the rest are still in the queue.`);
        setProgress(null);
      }
    });
  }

  function download() {
    const zpl = batchZpl(labels.map((l) => l.data), settings, baseUrl);
    const url = URL.createObjectURL(new Blob([zpl], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `stickers-${labels.length}.zpl`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function markSelectedPrinted() {
    if (!confirm(`Mark ${chosen.length} stickers as printed without sending them to the printer?`)) return;
    start(async () => {
      const ids = chosen.map((c) => c.unitId);
      await markPrintedAction(ids);
      const gone = new Set(ids);
      setQueue((q) => q.filter((x) => !gone.has(x.unitId)));
    });
  }

  async function sendRaw(zpl: string) {
    if (!printer) return;
    setError(null);
    try {
      await sendZpl(printer, zpl);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const allOn = shown.length > 0 && shown.every((x) => selected.has(x.unitId));
  const previewItem = queue.find((x) => x.unitId === previewId) ?? chosen[0];
  const first = previewItem ? labelDataFor(previewItem, pricedOn) : undefined;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Find in the queue: code, name, set"
          className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1.5 text-sm outline-none focus:border-zinc-900 dark:focus:border-zinc-100"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={print} disabled={pending || !printer || labels.length === 0 || !baseUrl}>
            {pending && progress ? progress : `Print ${labels.length} sticker${labels.length === 1 ? "" : "s"}`}
          </Button>
          <Button variant="secondary" onClick={download} disabled={labels.length === 0 || !baseUrl}>
            Download .zpl
          </Button>
          <Button variant="ghost" onClick={markSelectedPrinted} disabled={pending || chosen.length === 0}>
            Mark printed
          </Button>
          {!pending && progress && <span className="text-sm text-green-700 dark:text-green-300">{progress}</span>}
        </div>
        {error && <p className="rounded-md bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-700 dark:text-red-300">{error}</p>}

        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-950 text-left text-xs text-zinc-500 dark:text-zinc-400">
              <tr>
                <th className="w-8 p-2">
                  <input
                    type="checkbox"
                    checked={allOn}
                    onChange={() =>
                      setSelected((s) => {
                        const n = new Set(s);
                        for (const x of shown) {
                          if (allOn) n.delete(x.unitId);
                          else n.add(x.unitId);
                        }
                        return n;
                      })
                    }
                  />
                </th>
                <th className="p-2">Code</th>
                <th className="p-2">Card</th>
                <th className="p-2 text-right">Price</th>
                <th className="p-2">Why</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((q) => (
                <tr
                  key={q.unitId}
                  onClick={() => setPreviewId(q.unitId)}
                  className={`cursor-pointer border-t border-zinc-200 dark:border-zinc-800 ${previewItem?.unitId === q.unitId ? "bg-sky-50 dark:bg-sky-950/40" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                >
                  <td className="p-2">
                    <input
                      type="checkbox"
                      checked={selected.has(q.unitId)}
                      onChange={() =>
                        setSelected((s) => {
                          const n = new Set(s);
                          if (n.has(q.unitId)) n.delete(q.unitId);
                          else n.add(q.unitId);
                          return n;
                        })
                      }
                    />
                  </td>
                  <td className="p-2 font-mono text-xs">{q.code}</td>
                  <td className="p-2">
                    {q.name} <span className="text-xs text-zinc-500 dark:text-zinc-400">{[q.setName, q.cardNumber && `#${q.cardNumber}`].filter(Boolean).join(" ")}</span>
                  </td>
                  <td className="p-2 text-right tabular-nums">{formatCents(q.priceCents)}</td>
                  <td className="p-2">
                    {q.stickeredPriceCents === null ? (
                      <Badge>new</Badge>
                    ) : q.stickeredPriceCents !== q.priceCents ? (
                      <Badge tone="amber">was {formatCents(q.stickeredPriceCents)}</Badge>
                    ) : (
                      <Badge tone="blue">reprint</Badge>
                    )}
                  </td>
                </tr>
              ))}
              {queue.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-zinc-500 dark:text-zinc-400">
                    Every priced card has an up-to-date sticker.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-4">
        <Card title="Printer">
          {printer ? (
            <p className="text-sm">
              <Badge tone="green">ready</Badge> {printer.name} <span className="text-zinc-500 dark:text-zinc-400">({printer.connection})</span>
            </p>
          ) : (
            <p className="text-sm text-red-700 dark:text-red-300">{printerError ?? "Looking for the printer..."}</p>
          )}
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            {settings.widthIn} x {settings.heightIn} in, {settings.dpi} dpi, {settings.layout === "fold" ? "fold-over layout" : "standard layout"}. Change in Settings.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void findPrinter()}>
              Find printer
            </Button>
            <Button variant="secondary" disabled={!printer || !baseUrl} onClick={() => void sendRaw(testLabelZpl(settings, baseUrl))}>
              Test sticker
            </Button>
            <Button
              variant="secondary"
              disabled={!printer}
              onClick={() => {
                if (confirm("Calibrate? The printer feeds a few blank labels to measure the new roll.")) void sendRaw(CALIBRATE_ZPL);
              }}
            >
              Calibrate roll
            </Button>
          </div>
        </Card>

        {first && baseUrl && (
          <Card title="Preview (click a row to see its sticker)">
            <LabelPreview data={first} settings={settings} baseUrl={baseUrl} />
          </Card>
        )}

        <Card title="Reprint by code">
          <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">A sticker got damaged or lost? Type its code(s) to put them back in the queue.</p>
          <textarea
            value={reprintText}
            onChange={(e) => setReprintText(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 p-2 font-mono text-sm"
            placeholder="K7M2QX 9XW4HT"
          />
          <Button
            variant="secondary"
            className="mt-2"
            disabled={!reprintText.trim() || pending}
            onClick={() =>
              start(async () => {
                const r = await reprintCodes(reprintText);
                setReprintText("");
                alert(`Queued ${r.queued}.${r.unknown.length ? ` Unknown: ${r.unknown.join(", ")}` : ""} Reload to see them.`);
              })
            }
          >
            Queue reprint
          </Button>
        </Card>
      </div>
    </div>
  );
}
