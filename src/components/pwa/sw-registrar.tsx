"use client";

import { useEffect } from "react";
import { toast } from "sonner";

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

    // Handle notification tap — show a toast with a link to the event
    // instead of navigating away from the live feed
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "NOTIFICATION_TAP" && event.data.eventUrl) {
        toast(event.data.title, {
          description: event.data.body,
          duration: 10000,
          action: {
            label: "View Event",
            onClick: () => {
              window.location.href = event.data.eventUrl;
            },
          },
        });
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
