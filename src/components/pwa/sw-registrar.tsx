"use client";

import { useEffect } from "react";
import { toast } from "sonner";

function closeTransientNotifications() {
  if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage("closeTransientNotifications");
  }
}

function showNotificationToast() {
  const hash = window.location.hash;
  if (!hash.startsWith("#notification=")) return;

  try {
    const data = JSON.parse(decodeURIComponent(hash.slice("#notification=".length)));
    if (data.eventUrl) {
      toast(data.title || "Event detected", {
        description: data.body || "",
        duration: 10000,
        action: {
          label: "View Event",
          onClick: () => {
            window.location.href = data.eventUrl;
          },
        },
      });
    }
  } catch { /* ignore malformed hash */ }

  history.replaceState(null, "", window.location.pathname);
}

export function SWRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch(() => {
      // SW registration failed — non-critical
    });

    // On app open: close offline/test notifications, keep event notifications
    const initialTimeout = setTimeout(() => {
      closeTransientNotifications();
    }, 1000);

    // Show toast if opened from a notification (data is in URL hash)
    showNotificationToast();

    // Close transient notifications when app becomes visible again
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        closeTransientNotifications();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearTimeout(initialTimeout);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return null;
}
