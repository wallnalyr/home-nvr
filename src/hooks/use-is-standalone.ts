"use client";

import { useSyncExternalStore } from "react";

function getStandaloneSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  const mq = window.matchMedia("(display-mode: standalone)");
  return (
    mq.matches ||
    (navigator as unknown as Record<string, unknown>).standalone === true
  );
}

function getServerSnapshot(): boolean {
  return false;
}

function subscribeStandalone(callback: () => void): () => void {
  const mq = window.matchMedia("(display-mode: standalone)");
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

export function useIsStandalone(): boolean {
  return useSyncExternalStore(
    subscribeStandalone,
    getStandaloneSnapshot,
    getServerSnapshot
  );
}
