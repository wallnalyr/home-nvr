import { TZDate } from "@date-fns/tz";

/**
 * Server timezone, injected into the page by the root layout.
 * Falls back to the browser's timezone if not set.
 */
function getTimeZone(): string {
  // Server-side: read from process.env
  if (typeof window === "undefined") {
    return (
      process.env.TZ ||
      Intl.DateTimeFormat().resolvedOptions().timeZone
    );
  }
  // Client-side: read from injected global, fall back to browser TZ
  const win = window as unknown as { __SERVER_TZ__?: string };
  return (
    win.__SERVER_TZ__ ||
    Intl.DateTimeFormat().resolvedOptions().timeZone
  );
}

/** IANA timezone string for the server (e.g. "America/New_York") */
export const SERVER_TZ = getTimeZone();

/** Create a Date in the server's timezone from a Unix epoch seconds timestamp */
export function tzDate(epochSeconds: number): TZDate {
  return new TZDate(epochSeconds * 1000, SERVER_TZ);
}

/** Create a Date in the server's timezone from an existing Date object */
export function tzFromDate(date: Date): TZDate {
  return new TZDate(date.getTime(), SERVER_TZ);
}
