"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Badge, Button, Card, Select } from "@/components/ui";
import { FIELDS, FIELD_LABELS, detectMapping, parseCsv, type Field, type Mapping } from "@/import/collectr";
import { formatCents } from "@/lib/money";
import type { ImportPlan, ImportResult } from "@/server/import";
import { commitImport, previewImport } from "./actions";

type Preview = ImportPlan & { skipped: { line: number; reason: string; name: string }[] };

export function ImportClient() {
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [portfolios, setPortfolios] = useState<string[] | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const parsed = useMemo(() => (file ? parseCsv(file.text) : null), [file]);

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

  async function onFile(f: File | undefined) {
    setPreview(null);
    setResult(null);
    setError(null);
    if (!f) return;
    const text = await f.text();
    const { headers } = parseCsv(text);
    setFile({ name: f.name, text });
    setMapping(detectMapping(headers));
    setPortfolios(null);
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
      <Card>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => void onFile(e.target.files?.[0])}
          className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-zinc-900 file:px-3 file:py-2 file:text-white"
        />
        {parsed && (
          <p className="mt-2 text-sm text-zinc-500">
            {parsed.rows.length} rows, {parsed.headers.length} columns
          </p>
        )}
      </Card>

      {parsed && mapping && (
        <Card title="Columns (detected from the header; fix any that are wrong)">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {FIELDS.map((f: Field) => (
              <label key={f} className="flex items-center justify-between gap-2 text-sm">
                <span className={f === "name" ? "font-medium" : "text-zinc-600"}>{FIELD_LABELS[f]}</span>
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

          {allPortfolios.length > 1 && (
            <div className="mt-4 border-t border-zinc-100 pt-3">
              <p className="mb-2 text-sm font-medium">Portfolios to import (leave your personal collection out)</p>
              <div className="flex flex-wrap gap-3">
                {allPortfolios.map(([name, n]) => {
                  const on = portfolios === null || portfolios.includes(name);
                  return (
                    <label key={name} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => {
                          setPreview(null);
                          const current = portfolios ?? allPortfolios.map(([p]) => p);
                          setPortfolios(on ? current.filter((p) => p !== name) : [...current, name]);
                        }}
                      />
                      {name || "(no portfolio)"} <span className="text-zinc-400">({n})</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-4 flex gap-2">
            <Button onClick={runPreview} disabled={pending || mapping.name === null}>
              {pending && !preview ? "Checking..." : "Preview"}
            </Button>
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
