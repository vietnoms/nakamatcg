/**
 * Minimal client for Zebra Browser Print, the local service Zebra ships for printing from web
 * pages. Same requests as Zebra's own BrowserPrint-3.1.250.js: GET default?type=printer,
 * GET available, POST write with {device, data}, POST read with {device}. The body is a plain string, so the browser
 * sends it as text/plain and needs no CORS preflight. Browser only.
 */

export type ZebraDevice = {
  name: string;
  uid: string;
  connection: string;
  deviceType: string;
  version: number;
  provider: string;
  manufacturer: string;
};

const BASES = ["http://127.0.0.1:9100/", "https://127.0.0.1:9101/"];
let base: string | null = null;

async function call(path: string, init?: RequestInit): Promise<string> {
  const tries = base ? [base] : BASES;
  let last: unknown;
  for (const b of tries) {
    try {
      // a long batch can take a while to spool; a lookup should fail fast when nothing is listening
      const ms = path === "write" ? 120_000 : 4_000;
      const res = await fetch(b + path, { ...init, cache: "no-store", signal: AbortSignal.timeout(ms) });
      if (!res.ok) throw new Error(`Browser Print answered ${res.status}`);
      base = b;
      return await res.text();
    } catch (e) {
      last = e;
    }
  }
  throw new Error(
    `Can't reach Zebra Browser Print on this computer. Is it installed and running (Zebra icon in the tray)? ${
      last instanceof Error ? `(${last.message})` : ""
    }`,
  );
}

export async function defaultPrinter(): Promise<ZebraDevice | null> {
  const text = await call("default?type=printer");
  return text.trim() ? (JSON.parse(text) as ZebraDevice) : null;
}

export async function listPrinters(): Promise<ZebraDevice[]> {
  const text = await call("available");
  const all = JSON.parse(text) as { printer?: ZebraDevice[] };
  return all.printer ?? [];
}

export async function sendZpl(device: ZebraDevice, zpl: string): Promise<void> {
  await call("write", { method: "POST", body: JSON.stringify({ device: pick(device), data: zpl }) });
}

function pick(device: ZebraDevice) {
  const { name, uid, connection, deviceType, version, provider, manufacturer } = device;
  return { name, uid, connection, deviceType, version, provider, manufacturer };
}

/** Whatever the printer has sent back since the last read (Browser Print's read endpoint). */
export async function readPrinter(device: ZebraDevice): Promise<string> {
  return call("read", { method: "POST", body: JSON.stringify({ device: pick(device) }) });
}

/** Asks the printer for its host status (~HS) and collects the three-part answer. "" when it says nothing. */
export async function printerStatusText(device: ZebraDevice): Promise<string> {
  await readPrinter(device).catch(() => ""); // drop anything stale
  await sendZpl(device, "~HS");
  let text = "";
  for (let i = 0; i < 10 && (text.match(/\x03/g)?.length ?? 0) < 3; i++) {
    await new Promise((r) => setTimeout(r, 300));
    text += await readPrinter(device).catch(() => "");
  }
  return text;
}

/** ~PS: resume a paused printer. ~JA: cancel every job it is holding. */
export const RESUME_ZPL = "~PS";
export const CANCEL_ALL_ZPL = "~JA";
/** The plainest label there is: if this prints and the real stickers don't, the sticker layout is at fault. */
export const PLAIN_TEST_ZPL = "^XA^FO30,30^A0N,40,40^FDNAKAMA TEST^FS^FO30,90^A0N,25,25^FDplain ZPL, no settings^FS^XZ";
