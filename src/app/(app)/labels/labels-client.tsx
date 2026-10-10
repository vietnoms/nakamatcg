"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Badge, Button, Card, Select } from "@/components/ui";
import { CANCEL_ALL_ZPL, PLAIN_TEST_ZPL, RESUME_ZPL, defaultPrinter, printerStatusText, sendZpl, type ZebraDevice } from "@/labels/browser-print";
import { parseHostStatus, statusProblems } from "@/labels/status";
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
  // the printer's own answer to a status check: null = not checked yet
  const [health, setHealth] = useState<{ ok: boolean; lines: string[] } | null>(null);
  const [checking, setChecking] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
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
      else void checkPrinter(p);
    } catch (e) {
      setPrinter(null);
      setPrinterError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void findPrinter();
  }, []);

  const [search, setSearch] = useState("");
  // "" = every group; "none" = cards in no group; else a group id
  // starts from ?group= so a group picked on another page carries over
  const [group, setGroupState] = useState(useSearchParams().get("group") ?? "");
  function setGroup(g: string) {
    setGroupState(g);
    const u = new URL(window.location.href);
    if (g) u.searchParams.set("group", g);
    else u.searchParams.delete("group");
    window.history.replaceState(null, "", u);
  }
  const [previewId, setPreviewId] = useState<string | null>(null);
  const groups = useMemo(() => {
    const by = new Map<string, { id: string; name: string; n: number }>();
    for (const q of queue) {
      const id = q.groupId ?? "none";
      const g = by.get(id) ?? { id, name: q.groupName ?? "No group", n: 0 };
      g.n++;
      by.set(id, g);
    }
    return [...by.values()].sort((a, b) => (a.id === "none" ? 1 : b.id === "none" ? -1 : a.name.localeCompare(b.name)));
  }, [queue]);
  const shown = useMemo(() => {
    const n = search.trim().toLowerCase();
    return queue.filter(
      (x) => (!group || (x.groupId ?? "none") === group) && (!n || `${x.code} ${x.name} ${x.setName} ${x.cardNumber}`.toLowerCase().includes(n)),
    );
  }, [queue, search, group]);
  // print what is ticked AND on screen: a group or search filter never prints cards it hides
  const chosen = useMemo(() => shown.filter((q) => selected.has(q.unitId)), [shown, selected]);
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
        setProgress(`Sent ${done} stickers to the printer.`);
        setTimeout(() => void checkPrinter(), 1500);
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

  /** Asks the printer what state it is in, and says what stops it in plain words. */
  async function checkPrinter(p: ZebraDevice | null = printer) {
    if (!p) return;
    setChecking(true);
    try {
      const status = parseHostStatus(await printerStatusText(p));
      if (!status) {
        setHealth({
          ok: false,
          lines: [
            "The printer didn't answer the status check, so it can't say what's wrong.",
            "Look at its light: flashing or red means paused or an error. Make sure the lid is shut and labels are loaded, press the pause/feed button once, then try Plain test.",
          ],
        });
      } else {
        const problems = statusProblems(status);
        setHealth({ ok: problems.length === 0, lines: problems });
      }
    } catch (e) {
      setHealth({ ok: false, lines: [e instanceof Error ? e.message : String(e)] });
    } finally {
      setChecking(false);
    }
  }

  async function sendRaw(zpl: string, what?: string) {
    if (!printer) return;
    setError(null);
    setSent(null);
    try {
      await sendZpl(printer, zpl);
      if (what) {
        setSent(`${what} sent.`);
        // give it a moment to start, then ask whether anything is holding it
        setTimeout(() => void checkPrinter(), 1500);
      }
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
        <div className="flex flex-wrap gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find in the queue: code, name, set"
            className="min-w-0 flex-1 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1.5 text-sm outline-none focus:border-zinc-900 dark:focus:border-zinc-100"
          />
          {groups.length > 1 && (
            <Select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Group">
              <option value="">All groups ({queue.length})</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.n})
                </option>
              ))}
            </Select>
          )}
        </div>
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
                    {!group && q.groupName && <span className="ml-1 rounded bg-zinc-100 px-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{q.groupName}</span>}
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
            <div className="space-y-2 text-sm">
              <p>
                {checking ? (
                  <Badge>checking...</Badge>
                ) : health === null ? (
                  <Badge>found</Badge>
                ) : health.ok ? (
                  <Badge tone="green">ready</Badge>
                ) : (
                  <Badge tone="red">needs attention</Badge>
                )}{" "}
                {printer.name} <span className="text-zinc-500 dark:text-zinc-400">({printer.connection})</span>
              </p>
              {health && !health.ok && (
                <ul className="list-disc space-y-1 rounded-md bg-red-50 py-2 pr-2 pl-6 text-red-900 dark:bg-red-950/40 dark:text-red-100">
                  {health.lines.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              )}
              {sent && <p className="text-xs text-zinc-500 dark:text-zinc-400">{sent} Nothing came out? Press Check printer.</p>}
            </div>
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
            <Button variant="secondary" disabled={!printer || !baseUrl} onClick={() => void sendRaw(testLabelZpl(settings, baseUrl), "Test sticker")}>
              Test sticker
            </Button>
            <Button variant="secondary" disabled={!printer || checking} onClick={() => void checkPrinter()}>
              {checking ? "Checking..." : "Check printer"}
            </Button>
            <Button variant="secondary" disabled={!printer} onClick={() => void sendRaw(RESUME_ZPL, "Resume")}>
              Resume
            </Button>
            <Button variant="secondary" disabled={!printer} onClick={() => void sendRaw(PLAIN_TEST_ZPL, "Plain test")} title="The simplest possible label, ignoring your sticker settings">
              Plain test
            </Button>
            <Button
              variant="secondary"
              disabled={!printer}
              onClick={() => {
                if (confirm("Clear stuck jobs? The printer forgets every sticker it is holding; the queue here is unchanged, so you can print them again.")) void sendRaw(CANCEL_ALL_ZPL, "Clear");
              }}
            >
              Clear stuck jobs
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
