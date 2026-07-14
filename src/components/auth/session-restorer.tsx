"use client";

import { useEffect } from "react";

const SESSION_KEY = "session-token-backup";
const LEGACY_KEY = "auth-token-backup";

/**
 * Keeps the session alive across iOS PWA cookie purges.
 *
 * On every mount, calls /api/auth/refresh with the localStorage backup
 * of the session token (the session cookie is used server-side as a
 * fallback). A valid session re-establishes the auth cookie and slides
 * the session expiry, so the backup can never go stale while the app
 * is being used. If this runs on the login page and the refresh
 * succeeds, the user is sent straight back into the app.
 */
export function SessionRestorer() {
  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      localStorage.removeItem(LEGACY_KEY);
      const backup = localStorage.getItem(SESSION_KEY);

      try {
        const res = await fetch("/api/auth/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(backup ? { token: backup } : {}),
        });
        if (cancelled) return;

        if (res.ok) {
          const data = await res.json();
          if (data.sessionToken) {
            localStorage.setItem(SESSION_KEY, data.sessionToken);
          }
          if (window.location.pathname === "/login") {
            // Loop guard: if we already auto-redirected once and landed
            // back on /login, cookies aren't sticking (e.g. Secure cookie
            // over plain HTTP) — show the form instead of looping.
            if (sessionStorage.getItem("session-restore-redirected")) {
              sessionStorage.removeItem("session-restore-redirected");
              return;
            }
            sessionStorage.setItem("session-restore-redirected", "1");
            window.location.replace("/");
          } else {
            sessionStorage.removeItem("session-restore-redirected");
          }
        } else if (res.status === 401) {
          localStorage.removeItem(SESSION_KEY);
        }
      } catch {
        // Network error — leave the backup in place for the next attempt
      }
    }

    refresh();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
