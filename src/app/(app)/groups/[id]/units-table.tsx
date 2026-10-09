"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Button, Select } from "@/components/ui";
import { formatCents } from "@/lib/money";
import type { GroupUnit } from "@/server/groups";
import { moveUnitsAction } from "../actions";

const STATUS: Record<string, string> = { in_stock: "In stock", sold: "Sold", traded_out: "Traded", removed: "Removed" };

/** A group's cards: tick some (or all in stock) and move them to another group. */
export function UnitsTable({ units, groups, currentId }: { units: GroupUnit[]; groups: { id: string; name: string }[]; currentId: string | null }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<string>("");
  const [q, setQ] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? units.filter((u) => `${u.code} ${u.name} ${u.setName} ${u.cardNumber}`.toLowerCase().includes(needle)) : units;
  }, [units, q]);
  const others = groups.filter((g) => g.id !== currentId);
  const allShown = shown.length > 0 && shown.every((u) => picked.has(u.id));

  function toggle(id: string) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  }

  function move() {
    const to = target === "none" ? null : target;
    const name = to === null ? "no group" : others.find((g) => g.id === to)?.name;
    start(async () => {
      const n = await moveUnitsAction([...picked], to);
      setNote(`Moved ${n} card${n === 1 ? "" : "s"} to ${name}.`);
      setPicked(new Set());
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter: code, name, set"
          className="w-56 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <span className="ml-auto text-zinc-500 dark:text-zinc-400">{picked.size} ticked</span>
        <Select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Move to...</option>
          {others.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
          {currentId !== null && <option value="none">No group</option>}
        </Select>
        <Button disabled={pending || picked.size === 0 || !target} onClick={move}>
          Move
        </Button>
      </div>
      {note && <p className="text-green-700 dark:text-green-300">{note}</p>}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="text-left text-xs text-zinc-500 dark:text-zinc-400">
            <tr>
              <th className="w-8 py-1.5">
                <input
                  type="checkbox"
                  aria-label="Tick all shown"
                  checked={allShown}
                  onChange={() => setPicked(allShown ? new Set() : new Set(shown.map((u) => u.id)))}
                />
              </th>
              <th className="py-1.5">Code</th>
              <th className="py-1.5">Card</th>
              <th className="py-1.5">Cond.</th>
              <th className="py-1.5">Status</th>
              <th className="py-1.5 text-right">Price</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((u) => (
              <tr key={u.id} onClick={() => toggle(u.id)} className="cursor-pointer border-t border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800">
                <td className="py-1.5">
                  <input type="checkbox" checked={picked.has(u.id)} onChange={() => toggle(u.id)} onClick={(e) => e.stopPropagation()} aria-label={`Tick ${u.code}`} />
                </td>
                <td className="py-1.5 font-mono">{u.code}</td>
                <td className="py-1.5">
                  {u.name} <span className="text-zinc-500 dark:text-zinc-400">{[u.setName, u.cardNumber && `#${u.cardNumber}`].filter(Boolean).join(" ")}</span>
                </td>
                <td className="py-1.5">{u.badge}</td>
                <td className="py-1.5">{STATUS[u.status] ?? u.status}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {u.priceCents !== null ? formatCents(u.priceCents) : u.marketCents !== null ? <span className="text-zinc-500 dark:text-zinc-400">{formatCents(u.marketCents)} mkt</span> : "-"}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-zinc-500 dark:text-zinc-400">
                  No cards here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
