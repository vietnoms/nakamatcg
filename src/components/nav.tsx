"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/import", label: "Import" },
  { href: "/pricing", label: "Pricing" },
  { href: "/groups", label: "Groups" },
  { href: "/labels", label: "Stickers" },
  { href: "/pos", label: "POS" },
  { href: "/summary", label: "Sales" },
  { href: "/gains", label: "Gains" },
  { href: "/settings", label: "Settings" },
];

export function Nav() {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <>
      {NAV.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          // the POS is its own full-screen app: a plain link, no client-side prefetch
          prefetch={n.href === "/pos" ? false : undefined}
          className={clsx(
            "shrink-0 rounded px-2.5 py-1.5 text-sm",
            active(n.href) ? "bg-zinc-900 dark:bg-zinc-100 font-medium text-white dark:text-zinc-950" : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800",
          )}
        >
          {n.label}
        </Link>
      ))}
    </>
  );
}
