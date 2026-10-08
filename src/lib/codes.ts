/**
 * Sticker codes. Every physical unit gets one: six Crockford base32 characters (30 bits),
 * printed on its sticker and inside its QR code. Codes are generated on the server for
 * imports and on the phone for offline buys, so this file has no server-only imports.
 */

export const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_LENGTH = 6;

type RandomBytes = (n: number) => Uint8Array;

const cryptoBytes: RandomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

export function newUnitCode(random: RandomBytes = cryptoBytes): string {
  const bytes = random(CODE_LENGTH);
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[(bytes[i] ?? 0) % 32];
  return out;
}

/** Uppercases, drops spaces and dashes, maps O to 0 and I/L to 1. Null if it is not a code. */
export function normalizeCode(input: string): string | null {
  const s = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (s.length !== CODE_LENGTH) return null;
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return null;
  return s;
}

/** The unit code in a scanned QR payload or typed text: a sticker link on any host, or a bare code. */
export function extractCode(scanned: string): string | null {
  const text = scanned.trim();
  const link = /\/U\/([0-9A-Z]{6})(?:[/?#]|$)/i.exec(text);
  if (link?.[1]) return normalizeCode(link[1]);
  return normalizeCode(text);
}

/**
 * The link inside a sticker's QR code. All uppercase, so the QR can use alphanumeric mode
 * (smaller, easier to scan). Hosts are case-insensitive and the /u/ route accepts any case.
 */
export function stickerUrl(baseUrl: string, code: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/u/${code}`.toUpperCase();
}
