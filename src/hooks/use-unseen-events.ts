"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "lastSeenEventTime";

function getLastSeenTime(): number {
  if (typeof window === "undefined") return 0;
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored ? Number(stored) : 0;
}

// External store for cross-component reactivity
let listeners: Array<() => void> = [];
let cachedValue = 0;

function subscribe(listener: () => void) {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

function getSnapshot(): number {
  return cachedValue;
}

function getServerSnapshot(): number {
  return 0;
}

function notifyListeners() {
  cachedValue = getLastSeenTime();
  for (const listener of listeners) {
    listener();
  }
}

// Initialize on first load
if (typeof window !== "undefined") {
  cachedValue = getLastSeenTime();
  // Listen for storage changes from other tabs
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) notifyListeners();
  });
}

export function useLastSeenEventTime() {
  const lastSeenTime = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const markEventsSeen = useCallback((latestEventTime: number) => {
    const current = getLastSeenTime();
    if (latestEventTime > current) {
      localStorage.setItem(STORAGE_KEY, String(latestEventTime));
      notifyListeners();
    }

    // Clear PWA app badge
    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage("clearBadge");
    }
    if ("clearAppBadge" in navigator) {
      (navigator as Navigator & { clearAppBadge: () => Promise<void> })
        .clearAppBadge()
        .catch(() => {});
    }
  }, []);

  return { lastSeenTime, markEventsSeen };
}

/**
 * Count events that are newer than the last seen time.
 */
export function countUnseenEvents(
  events: Array<{ start_time: number }>,
  lastSeenTime: number
): number {
  if (lastSeenTime === 0) return 0; // First visit — don't show badge
  return events.filter((e) => e.start_time > lastSeenTime).length;
}
