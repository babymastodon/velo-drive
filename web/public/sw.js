// sw.js — minimal offline service worker for the VeloDrive PWA.
//
// The Vite build hashes asset file names, so a static precache list does not
// apply here. Instead this SW does
// RUNTIME caching: navigations are network-first with a cached-index fallback,
// and same-origin GET assets are cache-first with a background refresh. The app
// shell + hashed assets therefore become available offline after the first
// successful load.
//
// Registration is guarded in main.ts so the SW is NEVER registered under the
// test harness (avoids caching nondeterminism in the Playwright runs).

const CACHE_NAME = "velodrive-runtime-v1";
const OFFLINE_FALLBACK = "./index.html";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("velodrive-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: network-first, fall back to the cached app shell when offline.
  if (request.mode === "navigate" || request.destination === "document") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
          const response = await fetch(request);
          if (response && response.ok) {
            cache.put(OFFLINE_FALLBACK, response.clone());
          }
          return response;
        } catch (err) {
          const cached = await cache.match(OFFLINE_FALLBACK);
          if (cached) return cached;
          throw err;
        }
      })(),
    );
    return;
  }

  // Other same-origin GETs: cache-first with a background refresh.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) {
        event.waitUntil(
          fetch(request)
            .then((response) => {
              if (response && response.ok) cache.put(request, response.clone());
            })
            .catch(() => {}),
        );
        return cached;
      }
      const response = await fetch(request);
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })(),
  );
});
