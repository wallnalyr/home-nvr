/// <reference lib="webworker" />

const CACHE_NAME = "camera-monitor-v3";
const STATIC_ASSETS = ["/", "/login"];

// Tags that should be cleared on app open (not event notifications)
function isTransientTag(tag) {
  return !tag || tag === "test" || tag.endsWith("-offline");
}

function isEventTag(tag) {
  return tag && !isTransientTag(tag);
}

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
        // Cache successful non-redirect responses
        if (response.ok && response.type === "basic" && !response.redirected) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

async function updateBadge() {
  if (!("setAppBadge" in self.navigator)) return;
  try {
    const notifications = await self.registration.getNotifications();
    const eventCount = notifications.filter((n) => isEventTag(n.tag)).length;
    if (eventCount > 0) {
      await self.navigator.setAppBadge(eventCount);
    } else {
      await self.navigator.clearAppBadge();
    }
  } catch {
    // Badge API not supported
  }
}

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
      await updateBadge();
    })()
  );
});

// Notification click handler
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  // Dismiss action — just close
  if (event.action === "dismiss") {
    event.waitUntil(updateBadge());
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
            await updateBadge();
            return;
          }
        }
        // No existing window — open the live feed
        return clients.openWindow(targetUrl);
      })
  );
});

// Notification close
self.addEventListener("notificationclose", (event) => {
  event.waitUntil(updateBadge());
});

// Handle messages from the app
self.addEventListener("message", (event) => {
  if (event.data === "closeTransientNotifications") {
    // Close offline + test notifications on app open, keep event notifications.
    // Badge updates to reflect only remaining event notifications.
    event.waitUntil(
      (async () => {
        const notifications = await self.registration.getNotifications();
        for (const notification of notifications) {
          if (isTransientTag(notification.tag)) {
            notification.close();
          }
        }
        await updateBadge();
      })()
    );
  }

  if (event.data === "clearAllNotifications") {
    // Clear everything — called when user views the events page.
    event.waitUntil(
      (async () => {
        const notifications = await self.registration.getNotifications();
        notifications.forEach((notification) => notification.close());
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
