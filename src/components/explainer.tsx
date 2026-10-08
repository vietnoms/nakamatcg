"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";

/**
 * A "How this works" box at the top of a page. Open until you close it once; remembered per page
 * in this browser (localStorage), so it stays out of the way after the first read.
 */
export function Explainer({ id, title, children, className }: { id: string; title: string; children: React.ReactNode; className?: string }) {
  const key = `nk:explainer:${id}`;
  const [open, setOpen] = useState(true);

  useEffect(() => {
    try {
      if (localStorage.getItem(key) === "closed") setOpen(false);
    } catch {
      // storage blocked: keep it open
    }
  }, [key]);

  function toggle() {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(key, next ? "open" : "closed");
    } catch {
      // fine
    }
  }

  return (
    <section className={clsx("rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/40 text-sm text-sky-950 dark:text-sky-50", className)}>
      <button type="button" onClick={toggle} className="flex w-full items-center gap-2 px-3 py-2 text-left font-medium" aria-expanded={open}>
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-600 text-xs font-bold text-white">?</span>
        <span className="flex-1">{title}</span>
        <span className="text-xs text-sky-700 dark:text-sky-300">{open ? "Hide" : "Show"}</span>
      </button>
      {open && <div className="space-y-2 border-t border-sky-200 dark:border-sky-800 px-3 py-2.5 leading-relaxed [&_li]:ml-4 [&_ol]:list-decimal [&_ul]:list-disc">{children}</div>}
    </section>
  );
}
