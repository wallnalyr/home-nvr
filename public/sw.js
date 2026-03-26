/// <reference lib="webworker" />

const CACHE_NAME = "camera-monitor-v2";
const STATIC_ASSETS = ["/", "/login"];

// Install: cache app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch: network-first for API, cache-first for static
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== "GET") return;

  // Skip API and auth requests
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/go2rtc/")) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful responses
        if (response.ok && response.type === "basic") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// Push notification handler
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    // Failed to parse push data — show generic notification
  }

  const title = data.title || "Camera Monitor";
  const body = data.body || "New event detected";

  const options = {
    body,
    icon: data.icon || "/icon-192x192.png",
    badge: "/badge-mono.png",
    tag: data.tag || "camera-event",
    renotify: true,
    data: data.data || {},
    vibrate: [200, 100, 200],
    actions: [
      { action: "open", title: "View" },
      { action: "dismiss", title: "Dismiss" },
    ],
  };

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options);
      // Increment app badge count
      if ("setAppBadge" in self.navigator) {
        try {
          const notifications = await self.registration.getNotifications();
          await self.navigator.setAppBadge(notifications.length);
        } catch {
          // Badge API not supported
        }
      }
    })()
  );
});

// Notification click handler
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  // Dismiss action — just close
  if (event.action === "dismiss") {
    return;
  }

  const eventUrl = event.notification.data?.url || "/events";
  const title = event.notification.title || "Event detected";
  const body = event.notification.body || "";
  const hashData = encodeURIComponent(JSON.stringify({ eventUrl, title, body }));
  const targetUrl = "/#notification=" + hashData;

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clientList) => {
        // Navigate existing window to live feed with notification hash.
        // Using navigate() instead of postMessage because iOS purges
        // backgrounded pages from memory — messages arrive before
        // React mounts the listener and get lost.
        for (const client of clientList) {
          if ("focus" in client && "navigate" in client) {
            await client.focus();
            await client.navigate(targetUrl);
            return;
          }
        }
        // No existing window — open the live feed
        return clients.openWindow(targetUrl);
      })
  );
});

// Notification close — badge stays as-is
self.addEventListener("notificationclose", () => {
  // Badge represents pending events, not notification count
});

// Handle messages from the app
self.addEventListener("message", (event) => {
  if (event.data === "closeNotifications") {
    // Close notification banners only — badge stays until user views events
    event.waitUntil(
      (async () => {
        const notifications = await self.registration.getNotifications();
        notifications.forEach((notification) => notification.close());
      })()
    );
  }

  if (event.data === "clearBadge") {
    // Clear app badge count (called when user views events tab)
    event.waitUntil(
      (async () => {
        if ("clearAppBadge" in self.navigator) {
          try {
            await self.navigator.clearAppBadge();
          } catch {
            // Badge API not supported
          }
        }
      })()
    );
  }
});
