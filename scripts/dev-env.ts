/**
 * Writes .env.local for LOCAL development only, pointing at `pnpm db:dev`. Refuses to touch an
 * existing .env.local. The local passcode is "local-dev-passcode"; production gets its own
 * hash from `pnpm passcode:hash`, set in Vercel.
 */
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { hashPasscode } from "../src/auth/passcode";

const DEV_PASSCODE = "local-dev-passcode";

if (existsSync(".env.local")) {
  console.error(".env.local already exists; leaving it alone.");
  process.exit(1);
}

const lines = [
  "# local development only (scripts/dev-env.ts); passcode: " + DEV_PASSCODE,
  "DATABASE_URL=postgres://postgres:local-dev-db@127.0.0.1:54330/nakamatcg",
  `APP_PASSCODE_HASH=${hashPasscode(DEV_PASSCODE)}`,
  `SESSION_SECRET=${randomBytes(32).toString("base64url")}`,
  "PUBLIC_BASE_URL=http://localhost:3000",
  "APP_TZ=America/Los_Angeles",
  "",
];
writeFileSync(".env.local", lines.join("\n"));
console.log("wrote .env.local for local development");
