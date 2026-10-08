import { logout } from "@/app/login/actions";
import { Nav } from "@/components/nav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-900/95 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-4 py-2">
          <span className="mr-3 shrink-0 font-semibold">Nakama</span>
          <Nav />
          <form action={logout} className="ml-auto shrink-0">
            <button className="rounded px-2.5 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800">Sign out</button>
          </form>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </>
  );
}
