/**
 * Minimal in-memory fixed-window rate limiter, used to slow brute-force
 * attempts against the snapshot API key. Single-process state is fine here —
 * the app runs as one Node server.
 */

interface WindowEntry {
  count: number;
  windowStart: number;
}

export interface RateLimiter {
  /** True when this id has exhausted its allowance for the current window. */
  isBlocked(id: string): boolean;
  /** Record one counted attempt (e.g. an auth failure) for this id. */
  record(id: string): void;
  /** Clear an id (e.g. after a successful auth). */
  clear(id: string): void;
}

const MAX_TRACKED_IDS = 10000;

export function createRateLimiter(options: {
  max: number;
  windowMs: number;
}): RateLimiter {
  const { max, windowMs } = options;
  const entries = new Map<string, WindowEntry>();

  const currentCount = (id: string, now: number): number => {
    const entry = entries.get(id);
    if (!entry || now - entry.windowStart >= windowMs) return 0;
    return entry.count;
  };

  return {
    isBlocked(id: string): boolean {
      return currentCount(id, Date.now()) >= max;
    },

    record(id: string): void {
      const now = Date.now();
      const entry = entries.get(id);
      if (!entry || now - entry.windowStart >= windowMs) {
        // Cap memory: drop everything if an attacker rotates ids. Resetting
        // all windows is acceptable — it only grants one extra window.
        if (!entries.has(id) && entries.size >= MAX_TRACKED_IDS) {
          entries.clear();
        }
        entries.set(id, { count: 1, windowStart: now });
      } else {
        entry.count++;
      }
    },

    clear(id: string): void {
      entries.delete(id);
    },
  };
}
