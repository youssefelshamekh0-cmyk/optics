/* نظرة — caches public assets plus one private dashboard shell for offline reloads.
   API responses are never cached by the service worker. The private shell is purged on logout. */
const CACHE = "nazra-shell-v2";
const PRIVATE_CACHE = "nazra-private-shell-v1";
const OFFLINE_URL = "/offline.html";
const PRIVATE_SHELL_KEY = new Request(new URL("/__nazra_private_dashboard_shell__", self.location.origin).href);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE)
    .then((cache) => cache.addAll([OFFLINE_URL, "/icons/icon-192.png"]))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key !== CACHE && key !== PRIVATE_CACHE).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "CLEAR_PRIVATE_SHELL") {
    event.waitUntil(caches.delete(PRIVATE_CACHE));
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then(async (response) => {
      // Only cache the dashboard document, never login/redirect pages or API data.
      if (response.ok && !response.redirected && new URL(response.url).pathname === "/dashboard") {
        const cache = await caches.open(PRIVATE_CACHE);
        await cache.put(PRIVATE_SHELL_KEY, response.clone());
      }
      return response;
    }).catch(async () => {
      const privateCache = await caches.open(PRIVATE_CACHE);
      return (await privateCache.match(PRIVATE_SHELL_KEY)) || (await caches.match(OFFLINE_URL));
    }));
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    })));
  }
});
