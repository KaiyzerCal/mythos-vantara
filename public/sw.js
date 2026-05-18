const CACHE_NAME = "mavis-v2";

// Install: take over immediately
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

// Activate: clear ALL old caches so stale JS/CSS chunks don't shadow new builds
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Fetch: network-only for navigations and assets. Let the browser/Vite handle caching.
// (Previous cache-first-for-scripts strategy caused stale chunks to be served
// after deploys, which made route components fail to load.)
self.addEventListener("fetch", (event) => {
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => new Response("Offline", { status: 503 }))
    );
  }
  // Everything else: do not intercept.
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
