"use client";

import { useEffect } from "react";
import { toast } from "sonner";

function closeNotifications() {
  if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage("closeNotifications");
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

    // Close notification banners when app opens (badge stays until events tab is viewed)
    const initialTimeout = setTimeout(() => {
      closeNotifications();
    }, 1000);

    // Show toast if opened from a notification (data is in URL hash)
    showNotificationToast();

    // Close notification banners when app becomes visible again
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        closeNotifications();
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
