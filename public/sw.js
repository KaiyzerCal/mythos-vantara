const CACHE_NAME = "mavis-v1";
const STATIC_ASSETS = ["/", "/index.html", "/manifest.json"];

// Install: cache static assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

// Activate: clear old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for API, cache-first for static
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never cache Supabase API calls or auth
  if (url.hostname.includes("supabase") || url.pathname.includes("/functions/")) {
    return; // fall through to network
  }

  // For navigation requests: serve cached index.html if offline
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match("/index.html").then((r) => r ?? new Response("Offline", { status: 503 }))
      )
    );
    return;
  }

  // Cache-first for static assets (JS/CSS/fonts/images)
  if (["style", "script", "font", "image"].includes(event.request.destination)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return res;
        }).catch(() => cached ?? new Response("", { status: 404 }));
      })
    );
    return;
  }
});

// Message: skip waiting
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
