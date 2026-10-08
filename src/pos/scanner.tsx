"use client";

import { useEffect, useRef, useState } from "react";
import { BarcodeDetector as Ponyfill, prepareZXingModule } from "barcode-detector/ponyfill";

type Detector = { detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]> };

let wasmReady = false;
function prepare() {
  if (wasmReady) return;
  wasmReady = true;
  // self-hosted (scripts/copy-vendor.mjs) so scanning works offline
  prepareZXingModule({
    overrides: { locateFile: (p: string, prefix: string) => (p.endsWith(".wasm") ? `/vendor/zxing/${p}` : prefix + p) },
  });
}

async function makeDetector(): Promise<Detector> {
  const Native = (globalThis as { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats(): Promise<string[]> } })
    .BarcodeDetector;
  if (Native) {
    try {
      if ((await Native.getSupportedFormats()).includes("qr_code")) return new Native({ formats: ["qr_code"] });
    } catch {
      // fall through to the WebAssembly reader
    }
  }
  prepare();
  return new Ponyfill({ formats: ["qr_code"] }) as unknown as Detector;
}

/** Fetches the reader's .wasm once so the service worker caches it while we are online. */
export function warmScanner(): void {
  void fetch("/vendor/zxing/zxing_reader.wasm").catch(() => {});
}

/**
 * Continuous QR scanning from the back camera. Calls onScan for each new code; the same code is
 * ignored for 2.5 s so holding a card in view does not add it twice.
 */
export function Scanner({ onScan, active }: { onScan: (text: string) => void; active: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [torch, setTorch] = useState<{ on: boolean; track: MediaStreamTrack } | null>(null);
  const last = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const handler = useRef(onScan);
  handler.current = onScan;

  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (stopped || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        // a flashlight button where the phone allows it (Android Chrome; iPhones do not expose it)
        const track = stream.getVideoTracks()[0];
        const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
        if (track && caps.torch) setTorch({ on: false, track });
        const detector = await makeDetector();
        setError(null);
        const tick = async () => {
          if (stopped || !video.current) return;
          try {
            if (video.current.readyState >= 2) {
              for (const code of await detector.detect(video.current)) {
                const now = Date.now();
                if (code.rawValue === last.current.text && now - last.current.at < 2500) continue;
                last.current = { text: code.rawValue, at: now };
                handler.current(code.rawValue);
              }
            }
          } catch {
            // a frame that fails to decode is normal; keep going
          }
          timer = setTimeout(() => void tick(), 120);
        };
        void tick();
      } catch (e) {
        setError(
          e instanceof DOMException && e.name === "NotAllowedError"
            ? "Camera blocked. Allow camera access for this site in the browser settings."
            : `Camera unavailable: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    })();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      setTorch(null);
    };
  }, [active]);

  async function toggleTorch() {
    if (!torch) return;
    try {
      await torch.track.applyConstraints({ advanced: [{ torch: !torch.on } as MediaTrackConstraintSet] });
      setTorch({ ...torch, on: !torch.on });
    } catch {
      setTorch(null);
    }
  }

  return (
    <div className="relative overflow-hidden rounded-lg bg-black">
      <video ref={video} playsInline muted className="aspect-[16/10] w-full object-cover" />
      <div className="pointer-events-none absolute inset-x-[22%] inset-y-6 rounded-lg border-2 border-white/70" />
      <p className="pointer-events-none absolute inset-x-0 top-1.5 text-center text-xs font-medium text-white/80">Hold a sticker&apos;s QR code in the box</p>
      {torch && (
        <button
          type="button"
          onClick={() => void toggleTorch()}
          className={`absolute right-2 bottom-2 rounded-full px-3 py-1.5 text-xs font-semibold ${torch.on ? "bg-amber-300 text-zinc-900" : "bg-black/60 text-white"}`}
        >
          {torch.on ? "Light on" : "Light"}
        </button>
      )}
      {error && <p className="absolute inset-x-0 bottom-0 bg-red-600/90 p-2 text-center text-sm text-white">{error}</p>}
    </div>
  );
}

/** A short beep (iPhones cannot vibrate from the web). */
export function beep(ok = true): void {
  try {
    const Ctx = (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext) as typeof AudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = ok ? 1320 : 220;
    g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (ok ? 0.08 : 0.3));
    o.onended = () => void ctx.close();
  } catch {
    // no audio: fine
  }
  navigator.vibrate?.(ok ? 40 : [80, 60, 80]);
}
