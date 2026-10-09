"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Input } from "@/components/ui";
import { bpsToPercent, percentToBps } from "@/lib/consignment";
import { parseDollars } from "@/lib/money";
import { createGroupAction, deleteGroupAction, updateGroupAction } from "./actions";

type Value = { name: string; kind: "own" | "consignment"; feeBps: number | null; minFeeCents: number | null; note: string };

/** Make a group, or edit one (with its id). Consignment groups carry the fee terms. */
export function GroupForm({ id, initial }: { id?: string; initial?: Value }) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState<Value["kind"]>(initial?.kind ?? "own");
  const [fee, setFee] = useState(initial?.feeBps != null ? String(bpsToPercent(initial.feeBps)) : "15");
  const [minFee, setMinFee] = useState(initial?.minFeeCents ? (initial.minFeeCents / 100).toFixed(2) : "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const feePct = Number(fee);
  const feeOk = kind === "own" || (fee.trim() !== "" && Number.isFinite(feePct) && feePct >= 0 && feePct <= 100);

  function value() {
    return {
      name,
      kind,
      feeBps: kind === "consignment" ? percentToBps(feePct) : null,
      minFeeCents: kind === "consignment" ? (parseDollars(minFee) ?? 0) : null,
      note,
    };
  }

  function save() {
    setError(null);
    setSaved(false);
    start(async () => {
      try {
        if (id) {
          await updateGroupAction(id, value());
          setSaved(true);
        } else {
          const newId = await createGroupAction(value());
          router.push(`/groups/${newId}`);
        }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save");
      }
    });
  }

  function remove() {
    if (!id || !confirm(`Delete the group "${initial?.name}"? Its cards stay, in no group.`)) return;
    start(async () => {
      try {
        await deleteGroupAction(id);
        router.push("/groups");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not delete");
      }
    });
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          Name
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "consignment" ? "Alex's cards" : "Binder 2"} className="w-56" />
        </label>
        <div className="inline-flex rounded-md border border-zinc-300 p-0.5 dark:border-zinc-700">
          {(
            [
              ["own", "Mine"],
              ["consignment", "Consignment"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`rounded px-3 py-1 ${kind === k ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950" : "text-zinc-600 dark:text-zinc-400"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {kind === "consignment" && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">
            My fee
            <Input type="number" inputMode="decimal" min={0} max={100} step="0.5" value={fee} onChange={(e) => setFee(e.target.value)} className="w-20 text-right" />% of each sale
          </label>
          <label className="flex items-center gap-2">
            at least $
            <Input inputMode="decimal" value={minFee} onChange={(e) => setMinFee(e.target.value)} placeholder="0" className="w-20 text-right" />
            per card
          </label>
        </div>
      )}
      {kind === "consignment" && (
        <label className="flex items-center gap-2">
          Note
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Phone, Venmo, terms..." className="flex-1" />
        </label>
      )}
      <div className="flex items-center gap-3">
        <Button disabled={pending || !name.trim() || !feeOk} onClick={save}>
          {id ? "Save" : "Create group"}
        </Button>
        {id && (
          <Button variant="ghost" disabled={pending} onClick={remove}>
            Delete group
          </Button>
        )}
        {saved && <span className="text-green-700 dark:text-green-300">Saved</span>}
        {error && <span className="text-red-600 dark:text-red-400">{error}</span>}
      </div>
    </div>
  );
}
