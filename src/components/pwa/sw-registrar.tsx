"use client";

import { useEffect } from "react";

function closeNotifications() {
  if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage("closeNotifications");
  }
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

    // Close notification banners when app becomes visible again
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        closeNotifications();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Handle navigation messages from service worker (notification click)
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "NAVIGATE_TO_EVENT" && event.data.url) {
        window.location.href = event.data.url;
      }
    };
    navigator.serviceWorker.addEventListener("message", handleMessage);

    return () => {
      clearTimeout(initialTimeout);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      navigator.serviceWorker.removeEventListener("message", handleMessage);
    };
  }, []);

  return null;
}
