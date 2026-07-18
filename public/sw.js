const CACHE_NAME = "annvero-pwa-v2";
const OFFLINE_URL = "/";
const NAV_NETWORK_TIMEOUT_MS = 3000;

const PRECACHE_URLS = [
  OFFLINE_URL,
  "/login",
  "/annvero-icon.png",
  "/icons/icon-192x192.png",
  "/icons/icon-512x512.png",
];

function shouldBypass(url) {
  if (url.origin !== self.location.origin) return true;
  if (url.pathname.startsWith("/api/")) return true;
  if (url.pathname.startsWith("/_next/webpack-hmr")) return true;
  // Public auth ekranı: SW navigation'ı geciktirmesin / timeout bekletmesin
  if (url.pathname === "/login" || url.pathname.startsWith("/login/")) return true;
  if (url.pathname === "/auth/callback" || url.pathname.startsWith("/auth/")) {
    return true;
  }
  return false;
}

function fetchWithTimeout(request, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(request, { signal: controller.signal }).finally(() => {
    clearTimeout(timer);
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (shouldBypass(url)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetchWithTimeout(request, NAV_NETWORK_TIMEOUT_MS);
        } catch {
          const cache = await caches.open(CACHE_NAME);
          return (
            (await cache.match(OFFLINE_URL)) ||
            (await cache.match("/login")) ||
            Response.error()
          );
        }
      })()
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;

        return fetch(request).then((response) => {
          if (!response || response.status !== 200) return response;

          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        });
      })
    );
  }
});

self.addEventListener("push", (event) => {
  let payload = {
    title: "ANNVERO",
    body: "",
    url: "/dashboard/ofis-takip/resmi-bildirimler/gib",
  };

  try {
    if (event.data) {
      payload = { ...payload, ...event.data.json() };
    }
  } catch {
    payload.body = event.data?.text() || payload.body;
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/icon-192x192.png",
      badge: "/icons/icon-192x192.png",
      data: { url: payload.url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || "/dashboard";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
