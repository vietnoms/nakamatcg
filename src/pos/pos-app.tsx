"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { getMeta, setMeta, type LocalSettings } from "./db";
import { BuyPanel, HistoryPanel, SellPanel, TradePanel, type Ctx } from "./panels";
import { warmScanner } from "./scanner";
import { SignedOut, counts, deviceName, pull, push, recordVoid } from "./sync";

type Tab = "sell" | "buy" | "trade" | "history";
type Status = { online: boolean; signedOut: boolean; pending: number; errors: number; lastPull: string | null; offlineReady: boolean; busy: boolean };

/** Tells the service worker to keep this page and everything it loaded, for offline use. */
async function cachePageAssets(): Promise<void> {
  const sw = navigator.serviceWorker?.controller;
  if (!sw) return;
  const urls = new Set<string>(["/pos", "/vendor/zxing/zxing_reader.wasm", "/manifest.webmanifest", "/icons/icon.svg"]);
  document.querySelectorAll<HTMLScriptElement>("script[src]").forEach((s) => urls.add(new URL(s.src).pathname + new URL(s.src).search));
  document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href], link[rel="preload"][href]').forEach((l) => {
    const u = new URL(l.href);
    if (u.origin === location.origin) urls.add(u.pathname + u.search);
  });
  performance.getEntriesByType("resource").forEach((r) => {
    const u = new URL(r.name);
    if (u.origin === location.origin && u.pathname.startsWith("/_next/static/")) urls.add(u.pathname + u.search);
  });
  sw.postMessage({ type: "cache", urls: [...urls] });
}

async function isOfflineReady(): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller || !("caches" in window)) return false;
  const [page, wasm, last] = await Promise.all([caches.match("/pos", { ignoreSearch: true }), caches.match("/vendor/zxing/zxing_reader.wasm"), getMeta<string>("lastPull")]);
  return Boolean(page && wasm && last);
}

export function PosApp() {
  const [settings, setSettings] = useState<LocalSettings | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  const [device, setDevice] = useState("");
  const [tab, setTab] = useState<Tab>("sell");
  const [scanning, setScanning] = useState(true);
  const [toast, setToast] = useState<{ text: string; dealId: string } | null>(null);
  const [status, setStatus] = useState<Status>({ online: true, signedOut: false, pending: 0, errors: 0, lastPull: null, offlineReady: false, busy: false });
  const syncing = useRef(false);
  const [installHint, setInstallHint] = useState<"ios" | "android" | null>(null);

  useEffect(() => {
    // outside the home-screen app, offline use and saved storage are not dependable: say how to install it
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem("nk:install-hint") === "dismissed";
    } catch {
      dismissed = false;
    }
    if (!standalone && !dismissed) setInstallHint(/iphone|ipad|ipod/i.test(navigator.userAgent) ? "ios" : "android");
  }, []);

  const loadLocal = useCallback(async () => {
    const s = await getMeta<LocalSettings>("settings");
    if (s) setSettings(s);
    const chosen = await getMeta<string | null>("eventId");
    setEventId(chosen === undefined ? (s?.activeEventId ?? null) : chosen);
  }, []);

  const refreshStatus = useCallback(async (patch: Partial<Status> = {}) => {
    const [c, last, ready] = await Promise.all([counts(), getMeta<string>("lastPull"), isOfflineReady()]);
    setStatus((s) => ({ ...s, ...c, lastPull: last ?? null, offlineReady: ready, online: navigator.onLine, ...patch }));
  }, []);

  const sync = useCallback(
    async (full = false) => {
      if (syncing.current) return;
      syncing.current = true;
      setStatus((s) => ({ ...s, busy: true }));
      try {
        await push();
        await pull(full);
        await push();
        await loadLocal();
        await refreshStatus({ signedOut: false, online: true, busy: false });
      } catch (e) {
        await refreshStatus({ signedOut: e instanceof SignedOut, online: e instanceof SignedOut ? true : false, busy: false });
      } finally {
        syncing.current = false;
      }
    },
    [loadLocal, refreshStatus],
  );

  useEffect(() => {
    void deviceName().then(setDevice);
    void loadLocal();
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then(() => navigator.serviceWorker.ready)
        .then(() => {
          void cachePageAssets();
          setTimeout(() => void refreshStatus(), 1500);
        })
        // no service worker (some in-app browsers): the POS still works online, the header says not offline-ready
        .catch(() => {});
      navigator.serviceWorker.addEventListener("controllerchange", () => void cachePageAssets());
    }
    warmScanner();
    void getMeta<string>("lastPull").then((last) => sync(!last));
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void sync();
    }, 20_000);
    const on = () => void sync();
    const off = () => setStatus((s) => ({ ...s, online: false }));
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      clearInterval(t);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [loadLocal, refreshStatus, sync]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!settings) {
    return (
      <main className="mx-auto max-w-md p-6 text-center text-sm text-zinc-600">
        {status.signedOut ? (
          <p>
            Signed out. <a className="underline" href="/login?next=/pos">Sign in</a> to download the inventory.
          </p>
        ) : status.online ? (
          <p>Downloading inventory...</p>
        ) : (
          <p>No inventory on this phone yet. Connect once to download it.</p>
        )}
      </main>
    );
  }

  const event = settings.events.find((e) => e.id === eventId);
  const ctx: Ctx = {
    settings,
    eventId,
    device,
    scanning,
    setScanning,
    onRecorded: (text, dealId) => {
      setToast({ text, dealId });
      void refreshStatus();
      void sync();
    },
  };

  const pill = status.signedOut
    ? { text: "Signed out", cls: "bg-red-600 text-white" }
    : !status.online
      ? { text: `Offline${status.pending ? ` · ${status.pending} to sync` : ""}`, cls: "bg-amber-500 text-white" }
      : status.pending
        ? { text: `${status.pending} to sync`, cls: "bg-amber-100 text-amber-800" }
        : { text: "Synced", cls: "bg-green-100 text-green-800" };

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/95 px-3 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="flex items-center gap-2 py-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{event?.name ?? "No show selected"}</div>
            <div className="text-xs text-zinc-500" title="Offline ready: this phone has the app and the inventory saved, so it keeps working with no signal.">
              {status.offlineReady ? "Offline ready" : <span className="text-amber-700">Not offline-ready yet (open it once with signal)</span>}
            </div>
          </div>
          {status.signedOut ? (
            <a href="/login?next=/pos" className={clsx("rounded-full px-2.5 py-1 text-xs font-medium", pill.cls)}>
              {pill.text}
            </a>
          ) : (
            <button type="button" onClick={() => void sync()} className={clsx("rounded-full px-2.5 py-1 text-xs font-medium", pill.cls)}>
              {status.busy ? "Syncing..." : pill.text}
            </button>
          )}
          {status.errors > 0 && (
            <button type="button" onClick={() => setTab("history")} className="rounded-full bg-red-600 px-2.5 py-1 text-xs font-medium text-white">
              {status.errors} error
            </button>
          )}
        </div>
        <nav className="grid grid-cols-4 text-sm">
          {(["sell", "buy", "trade", "history"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={clsx("border-b-2 py-2 capitalize", tab === t ? "border-zinc-900 font-semibold" : "border-transparent text-zinc-500")}
            >
              {t}
            </button>
          ))}
        </nav>
      </header>

      {installHint && (
        <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <span className="flex-1">
            <b>Add this to your home screen</b> so it opens with no signal and keeps its data:{" "}
            {installHint === "ios" ? "tap Share, then “Add to Home Screen”. Then open it from the new icon." : "open the browser menu, then “Install app” or “Add to Home screen”."}
          </span>
          <button
            type="button"
            className="font-semibold"
            onClick={() => {
              setInstallHint(null);
              try {
                localStorage.setItem("nk:install-hint", "dismissed");
              } catch {
                // fine
              }
            }}
          >
            OK
          </button>
        </div>
      )}

      <main className="flex-1 p-3 pb-28">
        {/* panels stay mounted so a half-built cart survives a tab switch */}
        <div hidden={tab !== "sell"}>
          <SellPanel ctx={{ ...ctx, scanning: scanning && tab === "sell" }} />
        </div>
        <div hidden={tab !== "buy"}>
          <BuyPanel ctx={ctx} />
        </div>
        <div hidden={tab !== "trade"}>
          <TradePanel ctx={{ ...ctx, scanning: scanning && tab === "trade" }} />
        </div>
        <div hidden={tab !== "history"}>
          {tab === "history" && (
            <HistoryPanel
              ctx={ctx}
              onSync={() => void sync()}
              onFullSync={() => void sync(true)}
              onEvent={(id) => {
                setEventId(id);
                void setMeta("eventId", id);
              }}
            />
          )}
        </div>
      </main>

      {toast && (
        <div className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+92px)] z-30 mx-auto flex max-w-md items-center gap-3 rounded-lg bg-zinc-900 px-4 py-3 text-sm text-white shadow-lg">
          <span className="flex-1">{toast.text}</span>
          <button
            type="button"
            className="font-semibold text-amber-300"
            onClick={() => {
              void recordVoid(toast.dealId, device).then(() => {
                setToast(null);
                void sync();
              });
            }}
          >
            Undo
          </button>
        </div>
      )}
    </div>
  );
}
