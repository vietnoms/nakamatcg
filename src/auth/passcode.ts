/**
 * The login passcode is stored only as an scrypt hash (APP_PASSCODE_HASH), made by
 * `pnpm passcode:hash`. Format: scrypt:N:r:p:<salt b64url>:<hash b64url>. Colons, not dollar
 * signs: Next expands $NAME inside .env files.
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;

export function hashPasscode(passcode: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(passcode, salt, KEYLEN, { N, r: R, p: P });
  return ["scrypt", N, R, P, salt.toString("base64url"), hash.toString("base64url")].join(":");
}

export function verifyPasscode(passcode: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64 ?? "", "base64url");
  if (expected.length === 0) return false;
  const actual = scryptSync(passcode, Buffer.from(saltB64 ?? "", "base64url"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(actual, expected);
}
