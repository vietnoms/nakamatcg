"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Input, Select } from "@/components/ui";
import { parseDollars } from "@/lib/money";
import { createEventAction, setActiveEvent, setStartingCashAction } from "./actions";

type Ev = { id: string; name: string; startsOn: string; startingCashCents: number };

export function EventControls({ events, activeId, currentId }: { events: Ev[]; activeId: string | null; currentId: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ name: "", startsOn: today, endsOn: today, cash: "" });
  const current = events.find((e) => e.id === currentId);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={currentId ?? "none"} onChange={(e) => router.push(`/summary?event=${e.target.value}`)}>
        {events.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name} ({e.startsOn}){e.id === activeId ? " - active" : ""}
          </option>
        ))}
        <option value="none">(no show)</option>
      </Select>
      {current && current.id !== activeId && (
        <Button variant="secondary" disabled={pending} onClick={() => start(() => setActiveEvent(current.id))}>
          Make active
        </Button>
      )}
      {current && (
        <Button
          variant="ghost"
          onClick={() => {
            const v = prompt("Starting cash in the box, in dollars", (current.startingCashCents / 100).toString());
            const c = v === null ? null : parseDollars(v);
            if (c !== null) start(() => setStartingCashAction(current.id, c));
          }}
        >
          Starting cash
        </Button>
      )}
      <Button variant="secondary" onClick={() => setOpen(!open)}>
        New show
      </Button>
      {open && (
        <form
          className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-white p-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const id = await createEventAction({
                name: form.name,
                startsOn: form.startsOn,
                endsOn: form.endsOn,
                startingCashCents: parseDollars(form.cash) ?? 0,
              });
              setOpen(false);
              router.push(`/summary?event=${id}`);
            });
          }}
        >
          <Input required placeholder="Show name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-48" />
          <Input type="date" value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} />
          <span className="text-sm text-zinc-500">to</span>
          <Input type="date" value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} />
          <Input placeholder="Starting cash $" value={form.cash} onChange={(e) => setForm({ ...form, cash: e.target.value })} className="w-36" />
          <Button type="submit" disabled={pending}>
            Create and make active
          </Button>
        </form>
      )}
    </div>
  );
}
