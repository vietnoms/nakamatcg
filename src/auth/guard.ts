import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE, isValidSession } from "./session";

/** For server actions: the proxy already guards the page, this guards the action itself. */
export async function requireSession(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await isValidSession(token))) throw new Error("Signed out. Reload the page and sign in.");
}
