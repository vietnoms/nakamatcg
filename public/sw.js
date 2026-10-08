/*
 * Keeps the phone POS working with no signal. Only the POS is offline-capable; the laptop pages
 * are online-only.
 *
 *   /pos (navigation)      network first (4 s), cached copy when offline
 *   /_next/static/*        cache first: file names are content hashes, never change
 *   /vendor/*, /icons/*    cache first
 *   /api/*                 never cached: the app's own outbox handles being offline
 *
 * The page posts {type: "cache", urls} with every asset it loaded, so the first online visit
 * leaves everything needed for the next offline one.
 */
const VERSION = "v1";
const CACHE = `nakama-pos-${VERSION}`;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("nakama-pos-") && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

/** Cache only real pages and files: never a redirect to /login or an error page. */
async function put(cache, key, res) {
  if (res && res.ok && !res.redirected && res.type === "basic") await cache.put(key, res.clone());
  return res;
}

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== "cache" || !Array.isArray(data.urls)) return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      for (const url of data.urls) {
        try {
          const key = url.startsWith("/pos") ? "/pos" : url;
          if (key !== "/pos" && (await cache.match(key))) continue;
          await put(cache, key, await fetch(url, { credentials: "same-origin", cache: "no-cache" }));
        } catch (e) {
          // offline or gone: the next visit tries again
        }
      }
    })(),
  );
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate" && url.pathname === "/pos") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const res = await Promise.race([fetch(req), timeout(4000)]);
          return await put(cache, "/pos", res);
        } catch (e) {
          const hit = await cache.match("/pos");
          return hit || new Response("Offline and the POS was never loaded on this phone. Connect once and open it.", { status: 503, headers: { "Content-Type": "text/plain" } });
        }
      })(),
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/vendor/") || url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const hit = await cache.match(req, { ignoreVary: true });
        if (hit) return hit;
        const res = await fetch(req);
        return put(cache, req, res);
      })(),
    );
  }
});
