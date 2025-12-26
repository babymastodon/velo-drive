// service-worker.js

// Bump this when you deploy a new version so clients pick up new files
const CACHE_VERSION = "v57";
const CACHE_NAME = `velodrive-cache-${CACHE_VERSION}`;

// Files to make available offline
const PRECACHE_URLS = [
  "./",
  "./index.html",

  // Core JS
  "./workout.js",
  "./workout-chart.js",
  "./workout-picker.js",
  "./workout-builder.js",
  "./workout-engine.js",
  "./workout-metrics.js",
  "./workout-planner.js",
  "./planner-analysis.js",
  "./planner-backend.js",
  "./workout-library.js",
  "./builder-backend.js",
  "./ble-manager.js",
  "./beeper.js",
  "./storage.js",
  "./zwo.js",
  "./scrapers.js",
  "./settings.js",
  "./welcome.js",
  "./fit-file.js",
  "./theme.js",
  "./theme-init.js",

  // Styles
  "./workout-base.css",
  "./workout-picker.css",
  "./workout-planner.css",
  "./settings.css",
  "./welcome.css",

  // PWA bits
  "./velodrive.webmanifest",

  // Bundled default workouts
  "./workouts/Airforge.zwo",
  "./workouts/Basefire%20Waves.zwo",
  "./workouts/Ashen%20Surge.zwo",
  "./workouts/Breath%20of%20Power.zwo",
  "./workouts/Breath%20Spark.zwo",
  "./workouts/Crestline%20Endurance.zwo",
  "./workouts/Deep%20Current.zwo",
  "./workouts/Endurance%20Drift.zwo",
  "./workouts/Endurance%20Espresso.zwo",
  "./workouts/Endure%20the%20Climb.zwo",
  "./workouts/Endless%20Rhythm.zwo",
  "./workouts/Freeride.zwo",
  "./workouts/Hard%20Road%2C%20Steady%20Heart.zwo",
  "./workouts/Into%20the%20Black.zwo",
  "./workouts/Keep%20Turning.zwo",
  "./workouts/Long%20Rollers.zwo",
  "./workouts/Lungfire.zwo",
  "./workouts/Lullaby%20Legs.zwo",
  "./workouts/Mellow%20Matchsticks.zwo",
  "./workouts/Blackglass%20Gauntlet.zwo",
  "./workouts/Cinder%20Edge.zwo",
  "./workouts/Nocturne%20Strain.zwo",
  "./workouts/Obsidian%20Pulse.zwo",
  "./workouts/Open%20Road%20Pulse.zwo",
  "./workouts/Pillow%20Pops.zwo",
  "./workouts/Quick%20Turn.zwo",
  "./workouts/Relentless%20Rise.zwo",
  "./workouts/Rise%20Against%20the%20Odds.zwo",
  "./workouts/Rolling%20Crests.zwo",
  "./workouts/Short%20Resolve.zwo",
  "./workouts/Sleepy%20Spin.zwo",
  "./workouts/Snooze%20Cruise.zwo",
  "./workouts/Steel%20the%20Line.zwo",
  "./workouts/Steady%20Carousel.zwo",
  "./workouts/Velvet%20Cadence.zwo",
  "./workouts/Windline.zwo",

  // Icons
  "./icons/logo_sq.svg",
  "./icons/logo.svg",
  "./icons/icon16.png",
  "./icons/icon32.png",
  "./icons/icon48.png",
  "./icons/icon128.png",
  "./icons/icon192.png",
  "./icons/icon512.png",

  // images
  "./img/browser.svg",
  "./img/builder.svg",
  "./img/trainer.svg",
];

const OFFLINE_FALLBACK_PAGE = "./index.html";

// Install: pre-cache everything in PRECACHE_URLS
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const results = await Promise.allSettled(
        PRECACHE_URLS.map(async (url) => {
          const request = new Request(url, { cache: "reload" });
          const response = await fetch(request);
          if (!response || !response.ok) {
            throw new Error(`Precache failed: ${url}`);
          }
          await cache.put(request, response);
        }),
      );
      const failures = results.filter((result) => result.status === "rejected");
      if (failures.length) {
        console.warn(
          "[ServiceWorker] Precache skipped some assets:",
          failures.map((entry) => entry.reason?.message || entry.reason),
        );
      }
    })(),
  );
  // Activate this SW immediately
  self.skipWaiting();
});

// Activate: delete old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            (key) => key.startsWith("velodrive-cache-") && key !== CACHE_NAME,
          )
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

// Fetch:
// - For navigations: network-first, fallback to cached index.html when offline
// - For other GETs: cache-first, fallback to network
self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Handle navigations (address bar, links, etc.)
  if (request.mode === "navigate" || request.destination === "document") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(OFFLINE_FALLBACK_PAGE);
        try {
          const response = await fetch(request);
          if (response && response.ok) {
            cache.put(OFFLINE_FALLBACK_PAGE, response.clone());
            return response;
          }
          if (cached) return cached;
          return response;
        } catch (err) {
          if (cached) return cached;
          throw err;
        }
      })(),
    );
    return;
  }

  // Other same-origin GET requests:
  // - scripts/styles/workers: network-first to ensure updates on refresh
  // - other assets: cache-first with background refresh
  event.respondWith(
    (async () => {
      const destination = request.destination || "";
      const isCodeAsset =
        destination === "script" ||
        destination === "style" ||
        destination === "worker";
      if (isCodeAsset) {
        try {
          const response = await fetch(request);
          if (response && response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
          }
          return response;
        } catch (err) {
          const cached = await caches.match(request);
          if (cached) return cached;
          throw err;
        }
      }

      const cached = await caches.match(request);
      if (cached) {
        event.waitUntil(
          fetch(request)
            .then((response) => {
              if (response && response.ok) {
                return caches
                  .open(CACHE_NAME)
                  .then((cache) => cache.put(request, response.clone()));
              }
              return null;
            })
            .catch(() => null),
        );
        return cached;
      }

      return fetch(request);
    })(),
  );
});
