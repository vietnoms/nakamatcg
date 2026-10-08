import Link from "next/link";
import { logout } from "@/app/login/actions";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/import", label: "Import" },
  { href: "/pricing", label: "Pricing" },
  { href: "/labels", label: "Labels" },
  { href: "/pos", label: "POS" },
  { href: "/summary", label: "Sales" },
  { href: "/settings", label: "Settings" },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/95 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-4 py-2">
          <span className="mr-3 shrink-0 font-semibold">Nakama</span>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="shrink-0 rounded px-2.5 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100">
              {n.label}
            </Link>
          ))}
          <form action={logout} className="ml-auto shrink-0">
            <button className="rounded px-2.5 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100">Sign out</button>
          </form>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </>
  );
}
