// Copies the QR reader's WebAssembly into public/vendor so the phone loads it from our own
// origin (cached by the service worker for offline scanning), never from a CDN.
// Runs before `dev` and `build`.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/** The package root above a resolved entry file (packages may not export package.json). */
function packageRoot(entry, name) {
  let dir = path.dirname(entry);
  // dist folders carry their own small package.json ({"type": ...}): look for the one with the name
  for (;;) {
    const pj = path.join(dir, "package.json");
    if (existsSync(pj) && JSON.parse(readFileSync(pj, "utf8")).name === name) return dir;
    const up = path.dirname(dir);
    if (up === dir) throw new Error(`package root of ${name} not found`);
    dir = up;
  }
}

const require = createRequire(import.meta.url);
const detector = packageRoot(require.resolve("barcode-detector"), "barcode-detector");
const zxing = packageRoot(createRequire(path.join(detector, "package.json")).resolve("zxing-wasm"), "zxing-wasm");
const src = path.join(zxing, "dist", "reader", "zxing_reader.wasm");
const out = path.join("public", "vendor", "zxing");
mkdirSync(out, { recursive: true });
copyFileSync(src, path.join(out, "zxing_reader.wasm"));
console.log("copied zxing_reader.wasm to public/vendor/zxing");
