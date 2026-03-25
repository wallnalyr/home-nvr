/// <reference lib="webworker" />

const CACHE_NAME = "camera-monitor-v3";

// Install: skip waiting to activate immediately
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

// Activate: clean old caches and take control
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: only cache static assets — never intercept page navigations or RSC requests
self.addEventListener("fetch", (event) => {
  // Skip non-GET requests
  if (event.request.method !== "GET") return;

  // Never intercept page navigations — let the server handle them directly.
  // iOS Safari's Cache API has bugs with Vary header matching that cause
  // cached HTML to be returned for RSC data requests (and vice versa),
  // resulting in null response errors.
  if (event.request.mode === "navigate") return;

  // Never intercept Next.js RSC data requests (client-side navigation payloads)
  if (event.request.headers.get("RSC")) return;

  // Skip API and streaming requests
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/go2rtc/")) {
    return;
  }

  // Only cache static assets (_next/static, images, etc.)
  // Network-first with cache fallback
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && response.type === "basic") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => {
          // Always return a valid Response — never undefined
          return cached || new Response("Offline", { status: 503, statusText: "Service Unavailable" });
        })
      )
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

  const targetUrl = event.notification.data?.url || "/events";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clientList) => {
        // Try to focus existing window and navigate
        for (const client of clientList) {
          if ("focus" in client) {
            await client.focus();
            client.postMessage({
              type: "NAVIGATE_TO_EVENT",
              url: targetUrl,
            });
            return;
          }
        }
        // Open new window
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
