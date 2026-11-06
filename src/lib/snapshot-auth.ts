/**
 * Shared authorization for the kiosk snapshot endpoints
 * (/api/snapshot and /api/snapshot/[slug]).
 *
 * Both routes are public paths in middleware because callers have no
 * browser session — instead every request must present the snapshot API
 * key (generated under Settings → System) via `?key=`, `X-Api-Key`, or
 * `Authorization: Bearer`. The key is scoped to these endpoints only.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifySnapshotKey } from "@/lib/api-key";
import { createRateLimiter } from "@/lib/rate-limit";

// 10 bad keys per minute per IP, then 429. The key is 256-bit random, so
// this is defense in depth against noisy scanners, not the primary guard.
// On globalThis so the two snapshot routes (separate Next bundles, each
// with its own module instance) share one failure budget per IP.
const globalForSnapshotAuth = globalThis as unknown as {
  __snapshotAuthLimiter?: ReturnType<typeof createRateLimiter>;
};
const authFailures =
  globalForSnapshotAuth.__snapshotAuthLimiter ??
  createRateLimiter({ max: 10, windowMs: 60_000 });
globalForSnapshotAuth.__snapshotAuthLimiter = authFailures;

function clientId(request: NextRequest): string {
  // Behind Traefik the first X-Forwarded-For entry is the real client.
  const fwd = request.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || "unknown";
}

function presentedKey(request: NextRequest): string | null {
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return (
    request.headers.get("x-api-key") ||
    request.nextUrl.searchParams.get("key")
  );
}

/** Returns an error response to send, or null when the request is authorized. */
export async function authorizeSnapshotRequest(
  request: NextRequest,
): Promise<NextResponse | null> {
  const ip = clientId(request);
  if (authFailures.isBlocked(ip)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const key = presentedKey(request);
  if (!key || !(await verifySnapshotKey(key))) {
    authFailures.record(ip);
    // Identical response for missing, wrong, and not-yet-configured keys
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  authFailures.clear(ip);
  return null;
}
