import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <h1 className="mb-1 text-2xl font-semibold">Nakama Cards</h1>
      <p className="mb-6 text-sm text-zinc-500">Inventory, stickers, and show sales.</p>
      <LoginForm next={next ?? "/"} />
    </main>
  );
}
