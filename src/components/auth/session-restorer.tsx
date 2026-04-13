"use client";

import { useEffect } from "react";

const STORAGE_KEY = "auth-token-backup";

/**
 * On mount, checks if the session cookie is intact. If iOS has purged it,
 * attempts to restore from the localStorage backup token.
 */
export function SessionRestorer() {
  useEffect(() => {
    let cancelled = false;

    async function tryRestore() {
      try {
        const res = await fetch("/api/auth/me", {
          credentials: "include",
        });
        if (res.ok) return;
      } catch {
        return;
      }

      const backup = localStorage.getItem(STORAGE_KEY);
      if (!backup || cancelled) return;

      try {
        const res = await fetch("/api/auth/restore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: backup }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.token) {
            localStorage.setItem(STORAGE_KEY, data.token);
          }
          window.location.reload();
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch {
        // Network error — leave backup in place for next attempt
      }
    }

    tryRestore();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
