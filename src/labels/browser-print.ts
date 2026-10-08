/**
 * Minimal client for Zebra Browser Print, the local service Zebra ships for printing from web
 * pages. Same requests as Zebra's own BrowserPrint-3.1.250.js: GET default?type=printer,
 * GET available, POST write with {device, data}. The body is a plain string, so the browser
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
  const { name, uid, connection, deviceType, version, provider, manufacturer } = device;
  await call("write", {
    method: "POST",
    body: JSON.stringify({ device: { name, uid, connection, deviceType, version, provider, manufacturer }, data: zpl }),
  });
}
