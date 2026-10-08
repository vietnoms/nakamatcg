"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Badge, Button, Card, Select } from "@/components/ui";
import { FIELDS, FIELD_LABELS, detectMapping, parseCsv, type Field, type Mapping } from "@/import/collectr";
import { formatCents } from "@/lib/money";
import type { ImportPlan, ImportResult } from "@/server/import";
import { commitImport, previewImport } from "./actions";

type Preview = ImportPlan & { skipped: { line: number; reason: string; name: string }[] };

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

export function ImportClient() {
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [portfolios, setPortfolios] = useState<string[] | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

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
    return { text: file!.text, filename: file!.name, mapping: mapping!, portfolios };
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
          dragging ? "border-sky-500 bg-sky-50" : "border-zinc-300 bg-white hover:border-zinc-400"
        }`}
      >
        <span className="text-sm font-medium">{file ? file.name : "Drop your Collectr CSV here, or click to choose it"}</span>
        <span className="text-xs text-zinc-500">
          {parsed ? `${parsed.rows.length} rows, ${parsed.headers.length} columns. Drop another file to replace it.` : "Nothing is saved until you press Import."}
        </span>
        <input type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} className="sr-only" />
      </label>

      {parsed && mapping && (
        <Card>
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
                        on ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-500 line-through"
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
                      {name || "(no portfolio)"} <span className={on ? "text-zinc-300" : "text-zinc-400"}>{n}</span>
                    </label>
                  );
                })}
              </div>
              <p className="mt-1.5 text-xs text-zinc-500">Tap to leave a portfolio out. Remembered for your next import.</p>
            </div>
          )}

          <details open={missingColumns} className="text-sm">
            <summary className="cursor-pointer select-none text-zinc-600">
              {missingColumns ? (
                <span className="font-medium text-amber-700">Pick the columns marked below</span>
              ) : (
                <span>Columns matched automatically (name, set, number, quantity, price, cost, grade). Check or change</span>
              )}
            </summary>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {FIELDS.map((f: Field) => (
                <label key={f} className="flex items-center justify-between gap-2">
                  <span className={f === "name" || f === "market" ? "font-medium" : "text-zinc-600"}>
                    {FIELD_LABELS[f]}
                    {(f === "name" || f === "market") && mapping[f] === null && <span className="text-amber-700"> (needed)</span>}
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
            <Button onClick={runPreview} disabled={pending || mapping.name === null}>
              {pending && !preview ? "Checking..." : "Preview"}
            </Button>
            <span className="text-xs text-zinc-500">Shows what would change. Nothing is saved yet.</span>
          </div>
        </Card>
      )}

      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

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
            {preview.skipped.length > 0 && (
              <span className="text-amber-700">
                <b>{preview.skipped.length}</b> rows skipped
              </span>
            )}
          </div>
          <div className="max-h-96 overflow-auto rounded border border-zinc-100">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-zinc-50 text-left text-xs text-zinc-500">
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
                  <tr key={r.key} className="border-t border-zinc-100">
                    <td className="p-2">
                      {r.name} {r.badge && <Badge>{r.badge}</Badge>} {r.isNewProduct && <Badge tone="blue">new</Badge>}
                    </td>
                    <td className="p-2 text-zinc-500">
                      {r.setName} {r.cardNumber && `#${r.cardNumber}`}
                    </td>
                    <td className="p-2 text-right tabular-nums">{r.quantityInFile}</td>
                    <td className="p-2 text-right tabular-nums">{r.newUnits || ""}</td>
                    <td className="p-2 text-right tabular-nums">
                      {!r.isNewProduct && r.oldMarketCents !== r.newMarketCents && r.oldMarketCents !== null && (
                        <span className="mr-1 text-zinc-400 line-through">{formatCents(r.oldMarketCents)}</span>
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
              <summary className="cursor-pointer text-amber-700">Skipped rows</summary>
              <ul className="mt-1 list-disc pl-5 text-zinc-600">
                {preview.skipped.map((s) => (
                  <li key={s.line}>
                    Row {s.line}: {s.reason} {s.name && `(${s.name})`}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="mt-4">
            <Button onClick={runImport} disabled={pending || (preview.newUnits === 0 && preview.newProducts === 0 && preview.priceChanges === 0)}>
              {pending ? "Importing..." : "Import"}
            </Button>
          </div>
        </Card>
      )}

      {result && (
        <Card>
          <p className="text-sm">
            Imported: {result.newProducts} new products, {result.newUnits} new copies, {result.priceChanges} price changes.{" "}
            <Link href="/pricing" className="font-medium underline">
              Go price them
            </Link>
          </p>
        </Card>
      )}
    </div>
  );
}
