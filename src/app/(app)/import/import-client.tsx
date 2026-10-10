"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Badge, Button, Card, Select } from "@/components/ui";
import { FIELDS, FIELD_LABELS, detectMapping, parseCsv, type Field, type Mapping } from "@/import/collectr";
import { bpsToPercent, percentToBps } from "@/lib/consignment";
import { formatCents, parseDollars } from "@/lib/money";
import type { ImportPlan, ImportResult } from "@/server/import";
import { commitImport, previewImport } from "./actions";

type Preview = ImportPlan & { skipped: { line: number; reason: string; name: string }[] };
type Result = ImportResult & { groupId: string | null };

const EXCLUDED_KEY = "nk:import:excluded-portfolios";
function loadExcluded(): string[] {
  try {
    return JSON.parse(localStorage.getItem(EXCLUDED_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}
function saveExcluded(names: string[]) {
  try {
    localStorage.setItem(EXCLUDED_KEY, JSON.stringify(names));
  } catch {
    // storage blocked: the choice just isn't remembered
  }
}

type Consignor = { id: string; name: string; feeBps: number };

export function ImportClient({ consignors }: { consignors: Consignor[] }) {
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [portfolios, setPortfolios] = useState<string[] | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // whose cards the file holds
  const [owner, setOwner] = useState<"own" | "consignor">("own");
  const [consignorId, setConsignorId] = useState<string>(consignors[0]?.id ?? "new");
  const [newName, setNewName] = useState("");
  const [newFee, setNewFee] = useState("15");
  const [newMin, setNewMin] = useState("");
  // what I paid: the costs in the file, or a whole collection bought at a % of market
  const [lot, setLot] = useState(false);
  const [lotPct, setLotPct] = useState("70");
  const lotNum = Number(lotPct);
  const lotReady = !lot || (lotPct.trim() !== "" && Number.isFinite(lotNum) && lotNum >= 1 && lotNum <= 200);
  const feePct = Number(newFee);
  const ownerReady =
    owner === "own" || consignorId !== "new" || (newName.trim() !== "" && newFee.trim() !== "" && Number.isFinite(feePct) && feePct >= 0 && feePct <= 100);

  const parsed = useMemo(() => (file ? parseCsv(file.text) : null), [file]);
  const missingColumns = mapping !== null && (mapping.name === null || (mapping.market === null && mapping.marketTotal === null));

  // every portfolio named in the file, with its row count, so a personal collection can be left out
  const allPortfolios = useMemo(() => {
    if (!parsed || !mapping || mapping.portfolio === null) return [];
    const counts = new Map<string, number>();
    for (const r of parsed.rows) {
      const p = (r[mapping.portfolio] ?? "").trim();
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [parsed, mapping]);

  const [dragging, setDragging] = useState(false);

  async function onFile(f: File | undefined) {
    setPreview(null);
    setResult(null);
    setError(null);
    if (!f) return;
    const text = await f.text();
    const { headers, rows } = parseCsv(text);
    const m = detectMapping(headers);
    setFile({ name: f.name, text });
    setMapping(m);
    // leave out the portfolios you left out last time
    const excluded = new Set(loadExcluded());
    const names = m.portfolio === null ? [] : [...new Set(rows.map((r) => (r[m.portfolio!] ?? "").trim()))];
    setPortfolios(names.some((n) => excluded.has(n)) ? names.filter((n) => !excluded.has(n)) : null);
  }

  function choosePortfolios(next: string[]) {
    setPreview(null);
    setPortfolios(next);
    saveExcluded(allPortfolios.map(([p]) => p).filter((p) => !next.includes(p)));
  }

  function input() {
    const who =
      owner === "own"
        ? { kind: "own" as const }
        : consignorId !== "new"
          ? { kind: "consignment" as const, groupId: consignorId }
          : { kind: "newConsignor" as const, name: newName.trim(), feeBps: percentToBps(feePct), minFeeCents: parseDollars(newMin) ?? 0 };
    return { text: file!.text, filename: file!.name, mapping: mapping!, portfolios, owner: who, lotPercent: owner === "own" && lot ? lotNum : null };
  }

  function runPreview() {
    setError(null);
    start(async () => {
      try {
        setPreview(await previewImport(input()));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Preview failed");
      }
    });
  }

  function runImport() {
    setError(null);
    start(async () => {
      try {
        setResult(await commitImport(input()));
        setPreview(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Import failed");
      }
    });
  }

  return (
    <div className="space-y-4">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void onFile(e.dataTransfer.files?.[0]);
        }}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center ${
          dragging ? "border-sky-500 bg-sky-50 dark:bg-sky-950/40" : "border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-zinc-400 dark:hover:border-zinc-500"
        }`}
      >
        <span className="text-sm font-medium">{file ? file.name : "Drop your Collectr CSV here, or click to choose it"}</span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {parsed ? `${parsed.rows.length} rows, ${parsed.headers.length} columns. Drop another file to replace it.` : "Nothing is saved until you press Import."}
        </span>
        <input type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} className="sr-only" />
      </label>

      {parsed && mapping && (
        <Card>
          <div className="mb-4 space-y-2 text-sm">
            <p className="font-medium">Whose cards are these?</p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["own", "Mine (groups from Collectr portfolios)"],
                  ["consignor", "A consignor's cards"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setPreview(null);
                    setOwner(k);
                  }}
                  className={`rounded-full border px-3 py-1.5 ${
                    owner === k
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950"
                      : "border-zinc-300 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {owner === "consignor" && (
              <div className="flex flex-wrap items-center gap-2 rounded-md bg-amber-50 p-3 dark:bg-amber-950/40">
                <Select
                  value={consignorId}
                  onChange={(e) => {
                    setPreview(null);
                    setConsignorId(e.target.value);
                  }}
                >
                  {consignors.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({bpsToPercent(c.feeBps)}% fee)
                    </option>
                  ))}
                  <option value="new">New consignor...</option>
                </Select>
                {consignorId === "new" && (
                  <>
                    <input
                      value={newName}
                      onChange={(e) => {
                        setPreview(null);
                        setNewName(e.target.value);
                      }}
                      placeholder="Their name, e.g. Alex"
                      className="w-44 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
                    />
                    <label className="flex items-center gap-1.5">
                      fee
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step="0.5"
                        value={newFee}
                        onChange={(e) => setNewFee(e.target.value)}
                        className="w-16 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-right dark:border-zinc-700 dark:bg-zinc-900"
                      />
                      %
                    </label>
                    <label className="flex items-center gap-1.5">
                      at least $
                      <input
                        inputMode="decimal"
                        value={newMin}
                        onChange={(e) => setNewMin(e.target.value)}
                        placeholder="0"
                        className="w-16 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-right dark:border-zinc-700 dark:bg-zinc-900"
                      />
                      a card
                    </label>
                  </>
                )}
                <p className="w-full text-xs text-amber-900 dark:text-amber-200">
                  Every card in this file goes into their group, with no cost (it isn&apos;t yours) and apart from your own copies.
                  Their cards sell like yours; the group page works out your fee and what you owe them.
                </p>
              </div>
            )}
          </div>
          {owner === "own" && (
            <div className="mb-4 space-y-2 text-sm">
              <p className="font-medium">What did you pay?</p>
              <div className="flex flex-wrap items-center gap-2">
                {(
                  [
                    [false, "The costs in Collectr"],
                    [true, "Bought as a lot"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => {
                      setPreview(null);
                      setLot(k);
                    }}
                    className={`rounded-full border px-3 py-1.5 ${
                      lot === k
                        ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950"
                        : "border-zinc-300 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                    }`}
                  >
                    {label}
                  </button>
                ))}
                {lot && (
                  <label className="flex items-center gap-1.5">
                    at
                    <input
                      type="number"
                      min={1}
                      max={200}
                      value={lotPct}
                      onChange={(e) => {
                        setPreview(null);
                        setLotPct(e.target.value);
                      }}
                      className="w-16 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-right dark:border-zinc-700 dark:bg-zinc-900"
                    />
                    % of market
                  </label>
                )}
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {lot
                  ? "Every new copy costs that share of its market price today, in place of the costs in the file (those are the seller's), so gain and loss starts from what you paid."
                  : "Each copy keeps its cost from Collectr. Copies with no cost (say, scanned into a display portfolio) take the cost of the same card in a portfolio you leave out below."}
              </p>
            </div>
          )}
          {allPortfolios.length > 1 && (
            <div className="mb-4">
              <p className="mb-2 text-sm font-medium">Which portfolios are you bringing?</p>
              <div className="flex flex-wrap gap-2">
                {allPortfolios.map(([name, n]) => {
                  const on = portfolios === null || portfolios.includes(name);
                  return (
                    <label
                      key={name}
                      className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${
                        on ? "border-zinc-900 dark:border-zinc-100 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950" : "border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 line-through"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={on}
                        onChange={() => {
                          const current = portfolios ?? allPortfolios.map(([p]) => p);
                          choosePortfolios(on ? current.filter((p) => p !== name) : [...current, name]);
                        }}
                      />
                      {name || "(no portfolio)"} <span className={on ? "text-zinc-300 dark:text-zinc-700" : "text-zinc-400 dark:text-zinc-500"}>{n}</span>
                    </label>
                  );
                })}
              </div>
              <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">Tap to leave a portfolio out. Remembered for your next import.</p>
            </div>
          )}

          <details open={missingColumns} className="text-sm">
            <summary className="cursor-pointer select-none text-zinc-500 dark:text-zinc-400">
              {missingColumns ? (
                <span className="font-medium text-amber-700 dark:text-amber-300">Pick the columns marked below</span>
              ) : (
                <span>Columns matched automatically (name, set, number, quantity, price, cost, grade). Check or change</span>
              )}
            </summary>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {FIELDS.map((f: Field) => (
                <label key={f} className="flex items-center justify-between gap-2">
                  <span className={f === "name" || f === "market" ? "font-medium" : "text-zinc-500 dark:text-zinc-400"}>
                    {FIELD_LABELS[f]}
                    {(f === "name" || f === "market") && mapping[f] === null && <span className="text-amber-700 dark:text-amber-300"> (needed)</span>}
                  </span>
                  <Select
                    value={mapping[f] ?? ""}
                    onChange={(e) => {
                      setPreview(null);
                      setMapping({ ...mapping, [f]: e.target.value === "" ? null : Number(e.target.value) });
                    }}
                    className="w-44"
                  >
                    <option value="">(none)</option>
                    {parsed.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Column ${i + 1}`}
                      </option>
                    ))}
                  </Select>
                </label>
              ))}
            </div>
          </details>

          <div className="mt-4 flex items-center gap-3">
            <Button onClick={runPreview} disabled={pending || mapping.name === null || !ownerReady || !lotReady}>
              {pending && !preview ? "Checking..." : "Preview"}
            </Button>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Shows what would change. Nothing is saved yet.</span>
          </div>
        </Card>
      )}

      {error && <p className="rounded-md bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-700 dark:text-red-300">{error}</p>}

      {preview && (
        <Card title="Preview">
          <div className="mb-3 flex flex-wrap gap-4 text-sm">
            <span>
              <b>{preview.newProducts}</b> new products
            </span>
            <span>
              <b>{preview.newUnits}</b> new copies (one sticker each)
            </span>
            <span>
              <b>{preview.priceChanges}</b> market price changes
            </span>
            {preview.ungrouped > 0 && (
              <span>
                <b>{preview.ungrouped}</b> copies already here get their portfolio&apos;s group
              </span>
            )}
            {preview.lotCostCents !== null && (
              <span>
                bought for <b>{formatCents(preview.lotCostCents)}</b>
                {preview.lotNoMarket > 0 && <span className="text-amber-700 dark:text-amber-300"> ({preview.lotNoMarket} copies have no market price, so no cost)</span>}
              </span>
            )}
            {preview.costsMatched > 0 && (
              <span>
                <b>{preview.costsMatched}</b> copies with no cost take it from the same card in your other portfolios
              </span>
            )}
            {preview.skipped.length > 0 && (
              <span className="text-amber-700 dark:text-amber-300">
                <b>{preview.skipped.length}</b> rows skipped
              </span>
            )}
          </div>
          <div className="max-h-96 overflow-auto rounded border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-950 text-left text-xs text-zinc-500 dark:text-zinc-400">
                <tr>
                  <th className="p-2">Card</th>
                  <th className="p-2">Set</th>
                  <th className="p-2 text-right">In file</th>
                  <th className="p-2 text-right">New copies</th>
                  <th className="p-2 text-right">Market</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.key} className="border-t border-zinc-200 dark:border-zinc-800">
                    <td className="p-2">
                      {r.name} {r.badge && <Badge>{r.badge}</Badge>} {r.isNewProduct && <Badge tone="blue">new</Badge>}
                    </td>
                    <td className="p-2 text-zinc-500 dark:text-zinc-400">
                      {r.setName} {r.cardNumber && `#${r.cardNumber}`}
                    </td>
                    <td className="p-2 text-right tabular-nums">{r.quantityInFile}</td>
                    <td className="p-2 text-right tabular-nums">{r.newUnits || ""}</td>
                    <td className="p-2 text-right tabular-nums">
                      {!r.isNewProduct && r.oldMarketCents !== r.newMarketCents && r.oldMarketCents !== null && (
                        <span className="mr-1 text-zinc-400 dark:text-zinc-500 line-through">{formatCents(r.oldMarketCents)}</span>
                      )}
                      {r.newMarketCents === null ? "-" : formatCents(r.newMarketCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.skipped.length > 0 && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-amber-700 dark:text-amber-300">Skipped rows</summary>
              <ul className="mt-1 list-disc pl-5 text-zinc-500 dark:text-zinc-400">
                {preview.skipped.map((s) => (
                  <li key={s.line}>
                    Row {s.line}: {s.reason} {s.name && `(${s.name})`}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="mt-4">
            <Button
              onClick={runImport}
              disabled={pending || (preview.newUnits === 0 && preview.newProducts === 0 && preview.priceChanges === 0 && preview.ungrouped === 0 && preview.costsMatched === 0)}
            >
              {pending ? "Importing..." : "Import"}
            </Button>
          </div>
        </Card>
      )}

      {result && (
        <Card>
          <p className="text-sm">
            Imported: {result.newProducts} new products, {result.newUnits} new copies, {result.priceChanges} price changes
            {result.newGroups > 0 && `, ${result.newGroups} new groups`}
            {result.grouped > 0 && `, ${result.grouped} earlier copies grouped`}
            {result.costsMatched > 0 && `, ${result.costsMatched} costs filled from your other portfolios`}.{" "}
            <Link href="/pricing" className="font-medium underline">
              Go price them
            </Link>
            {result.groupId && (
              <>
                {" · "}
                <Link href={`/groups/${result.groupId}`} className="font-medium underline">
                  Open the consignor&apos;s group
                </Link>
              </>
            )}
          </p>
        </Card>
      )}
    </div>
  );
}
