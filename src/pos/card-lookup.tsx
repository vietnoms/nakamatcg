"use client";

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { productKind } from "@/import/collectr";
import { tidyName, tidySet, type CatalogCandidate, type Game } from "@/lookup/match";
import type { LookupResult } from "@/server/identify";
import { money } from "./parts";
import { usePersistentState } from "./persist";

/** What a lookup fills into the Buy/Trade form. */
export type LookupFill = {
  kind: "raw" | "slab" | "sealed";
  name: string;
  setName: string;
  cardNumber: string;
  variant: string;
  grader: string;
  grade: string;
  cert: string;
  marketCents: number | null;
};

/** Phone photos are 3-12 MB; 1600 px JPEG is plenty to read a card and uploads fast on show-floor signal. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("could not encode"))), "image/jpeg", 0.85));
  } catch {
    return file;
  }
}

function CandidateRow({
  c,
  suggestedSubType,
  onPick,
}: {
  c: CatalogCandidate;
  suggestedSubType: string | null;
  onPick: (c: CatalogCandidate, subType: string, marketCents: number | null) => void;
}) {
  const printings = c.printings.length ? c.printings : [{ subType: "", marketCents: null }];
  return (
    <li className="flex gap-2 border-b border-zinc-100 py-2 last:border-0">
      {c.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={c.imageUrl} alt="" className="h-16 w-12 shrink-0 rounded object-cover" loading="lazy" />
      ) : (
        <div className="h-16 w-12 shrink-0 rounded bg-zinc-100" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{tidyName(c.name, c.number)}</div>
        <div className="truncate text-xs text-zinc-500">{[tidySet(c.setName), c.number && `#${c.number}`, c.rarity].filter(Boolean).join(" · ")}</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {printings.map((p) => (
            <button
              key={p.subType || "-"}
              type="button"
              onClick={() => onPick(c, p.subType, p.marketCents)}
              className={clsx(
                "rounded border px-2 py-1 text-xs",
                suggestedSubType === p.subType ? "border-green-600 bg-green-50 font-semibold text-green-800" : "border-zinc-300 bg-white",
              )}
            >
              {p.subType || "Use"} {p.marketCents === null ? "" : money(p.marketCents)}
            </button>
          ))}
        </div>
      </div>
    </li>
  );
}

/**
 * Photo or search lookup for a customer's card. Online only: the photo goes to the server
 * (CardSight, Claude as backup); prices come from the nightly TCGplayer catalog.
 */
export function CardLookup({ onFill }: { onFill: (f: LookupFill) => void }) {
  const [game, setGame] = usePersistentState<Game>("nk:lookup:game", "pokemon");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<CatalogCandidate[] | null>(null);
  const [online, setOnline] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  // typed price search, a moment after typing stops
  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) return setFound(null);
    const t = setTimeout(() => {
      void fetch(`/api/catalog/search?q=${encodeURIComponent(text)}&game=${game}`)
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((b: { results: CatalogCandidate[] }) => setFound(b.results))
        .catch(() => setFound([]));
    }, 350);
    return () => clearTimeout(t);
  }, [q, game]);

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setFound(null);
    try {
      const body = new FormData();
      body.append("image", await shrink(file), "card.jpg");
      body.append("game", game);
      const res = await fetch("/api/identify", { method: "POST", body });
      if (res.status === 401) throw new Error("Signed out. Sign in again from the POS header.");
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
      setResult((await res.json()) as LookupResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function pick(c: CatalogCandidate, subType: string, marketCents: number | null) {
    const graded = result?.read?.graded ?? null;
    const name = tidyName(c.name, c.number);
    onFill({
      kind: graded ? "slab" : productKind({ grader: "", grade: "", cardNumber: c.number, name, category: "" }),
      name,
      setName: tidySet(c.setName),
      cardNumber: c.number,
      variant: subType && subType !== "Normal" ? subType : "",
      grader: graded?.company ?? "",
      grade: graded?.grade ?? "",
      cert: graded?.cert ?? "",
      // a slab is worth its graded sales, not the raw price; leave it empty when there are none
      marketCents: graded ? (result?.graded?.medianCents ?? null) : marketCents,
    });
    setResult(null);
    setFound(null);
    setQ("");
  }

  const read = result?.read;
  return (
    <div className="space-y-2 rounded-md bg-zinc-50 p-2">
      <div className="flex items-center gap-2">
        <div className="inline-flex rounded-md border border-zinc-300 bg-white p-0.5 text-xs">
          {(
            [
              ["pokemon", "Pokémon"],
              ["one_piece", "One Piece"],
            ] as const
          ).map(([g, label]) => (
            <button key={g} type="button" onClick={() => setGame(g)} className={clsx("rounded px-2 py-1", game === g ? "bg-zinc-900 text-white" : "text-zinc-600")}>
              {label}
            </button>
          ))}
        </div>
        <label className={clsx("ml-auto rounded-md px-3 py-1.5 text-sm font-medium text-white", online && !busy ? "bg-sky-600" : "bg-zinc-300")}>
          {busy ? "Reading card..." : "Take photo"}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            disabled={!online || busy}
            onChange={(e) => void onPhoto(e.target.files?.[0])}
          />
        </label>
      </div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        disabled={!online}
        placeholder={online ? "Or search prices: name, set, number" : "Photo and price search need signal; fill in below"}
        className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm disabled:bg-zinc-100"
      />
      {error && <p className="text-xs text-red-700">{error}</p>}

      {result && (
        <div className="rounded-md border border-zinc-200 bg-white p-2 text-sm">
          {read ? (
            <p className="text-xs text-zinc-600">
              Read by {result.source === "cardsight" ? "CardSight" : "Claude"} ({result.confidence}):{" "}
              <b>{[read.name, read.setName, read.number && `#${read.number}`, read.graded && `${read.graded.company} ${read.graded.grade}`].filter(Boolean).join(" · ")}</b>
            </p>
          ) : (
            <p className="text-xs text-amber-700">Couldn&apos;t read the card. Try again closer, with less glare, or search by name.</p>
          )}
          {result.graded && (
            <p className="mt-1 rounded bg-green-50 px-2 py-1 text-xs text-green-900">
              {result.graded.company} {result.graded.grade}: recent sales median <b>{money(result.graded.medianCents)}</b> ({result.graded.sales} sales
              {result.graded.lastSale ? `, last ${result.graded.lastSale.slice(0, 10)}` : ""})
            </p>
          )}
          {read?.graded && !result.graded && <p className="mt-1 text-xs text-amber-700">No graded sales price found; prices below are raw. Enter the slab&apos;s value yourself.</p>}
          {result.candidates.length > 0 ? (
            <ul className="mt-1">
              {result.candidates.map((c) => (
                <CandidateRow key={c.productId} c={c} suggestedSubType={result.suggested?.productId === c.productId ? result.suggested.subType : null} onPick={pick} />
              ))}
            </ul>
          ) : (
            read && (
              <div className="mt-1 space-y-1">
                <p className="text-xs text-zinc-500">No match in the price catalog. Search by name above, or use what was read and add the price yourself.</p>
                <button
                  type="button"
                  className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs"
                  onClick={() => {
                    onFill({
                      kind: read.graded ? "slab" : "raw",
                      name: read.name,
                      setName: read.setName,
                      cardNumber: read.number,
                      variant: "",
                      grader: read.graded?.company ?? "",
                      grade: read.graded?.grade ?? "",
                      cert: read.graded?.cert ?? "",
                      marketCents: read.graded ? (result.graded?.medianCents ?? null) : null,
                    });
                    setResult(null);
                  }}
                >
                  Use what was read
                </button>
              </div>
            )
          )}
          {result.notes.length > 0 && <p className="mt-1 text-[11px] text-zinc-400">{result.notes.join(" · ")}</p>}
          <button type="button" className="mt-1 text-xs text-zinc-500 underline" onClick={() => setResult(null)}>
            Close
          </button>
        </div>
      )}

      {found && !result && (
        <div className="rounded-md border border-zinc-200 bg-white p-2">
          {found.length === 0 ? (
            <p className="text-xs text-zinc-500">No match in the price catalog.</p>
          ) : (
            <ul>
              {found.map((c) => (
                <CandidateRow key={c.productId} c={c} suggestedSubType={null} onPick={pick} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
