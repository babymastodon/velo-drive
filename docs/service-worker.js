// service-worker.js

// Bump this when you deploy a new version so clients pick up new files
const CACHE_VERSION = "v48";
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
  "./workouts/Basefire%20Waves.zwo",
  "./workouts/Breath%20of%20Power.zwo",
  "./workouts/Crestline%20Endurance.zwo",
  "./workouts/Endurance%20Drift.zwo",
  "./workouts/Endurance%20Espresso.zwo",
  "./workouts/Freeride.zwo",
  "./workouts/Into%20the%20Black.zwo",
  "./workouts/Keep%20Turning.zwo",
  "./workouts/Long%20Rollers.zwo",
  "./workouts/Lullaby%20Legs.zwo",
  "./workouts/Mellow%20Matchsticks.zwo",
  "./workouts/Pillow%20Pops.zwo",
  "./workouts/Rise%20Against%20the%20Odds.zwo",
  "./workouts/Rolling%20Crests.zwo",
  "./workouts/Sleepy%20Spin.zwo",
  "./workouts/Snooze%20Cruise.zwo",

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
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)),
  );
  // Activate this SW immediately
  self.skipWaiting();
});

// Activate: delete old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => key.startsWith("velodrive-cache-") && key !== CACHE_NAME,
            )
            .map((key) => caches.delete(key)),
        ),
      ),
  );
  self.clients.claim();
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
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // On successful navigation, update the cached shell
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(OFFLINE_FALLBACK_PAGE, copy);
          });
          return response;
        })
        .catch(() => {
          // Offline → fallback to cached app shell
          return caches.match(OFFLINE_FALLBACK_PAGE);
        }),
    );
    return;
  }

  // Other same-origin GET requests: cache-first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      // Not in cache → go to network
      return fetch(request);
    }),
  );
});
