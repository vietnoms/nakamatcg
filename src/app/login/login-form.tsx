"use client";

import { useActionState } from "react";
import { Button, Input } from "@/components/ui";
import { login } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      <Input
        name="passcode"
        type="password"
        autoComplete="current-password"
        placeholder="Passcode"
        autoFocus
        required
        className="py-2.5 text-base"
      />
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      <Button type="submit" disabled={pending} className="py-2.5 text-base">
        {pending ? "Signing in..." : "Sign in"}
      </Button>
    </form>
  );
}
