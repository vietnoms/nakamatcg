"use server";

import { and, eq, gt, sql } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyPasscode } from "@/auth/passcode";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/auth/session";
import { getDb } from "@/db/client";
import { loginAttempts } from "@/db/schema";

const MAX_FAILURES = 10;
const WINDOW = sql`now() - interval '15 minutes'`;

function safeNext(next: unknown): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export async function login(_prev: { error: string } | null, form: FormData): Promise<{ error: string } | null> {
  const passcode = String(form.get("passcode") ?? "");
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const db = getDb();

  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.ip, ip), eq(loginAttempts.ok, false), gt(loginAttempts.at, WINDOW)));
  if ((row?.n ?? 0) >= MAX_FAILURES) return { error: "Too many wrong tries. Wait 15 minutes." };

  const stored = process.env.APP_PASSCODE_HASH ?? "";
  if (!stored) return { error: "APP_PASSCODE_HASH is not set on the server." };
  const ok = verifyPasscode(passcode, stored);
  await db.insert(loginAttempts).values({ ip, ok });
  if (!ok) return { error: "Wrong passcode." };

  (await cookies()).set(SESSION_COOKIE, await signSession(), sessionCookieOptions);
  redirect(safeNext(form.get("next")));
}

export async function logout(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
