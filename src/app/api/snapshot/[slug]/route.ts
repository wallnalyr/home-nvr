import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifySnapshotKey } from "@/lib/api-key";
import { createRateLimiter } from "@/lib/rate-limit";
import { getCachedSnapshot } from "@/lib/stream-warmer";

/**
 * Snapshot endpoint for external displays (kiosks, countertop hubs).
 *
 * Listed as a public path in middleware because callers have no browser
 * session — instead EVERY request must present the snapshot API key
 * (generated under Settings → System), via `?key=`, `X-Api-Key`, or
 * `Authorization: Bearer`. The key is scoped to this endpoint only.
 *
 * Proxies Frigate's /api/<camera>/latest.jpg (a frame the detection
 * pipeline already holds in memory — effectively live, cheap to serve),
 * falling back to the stream warmer's cached go2rtc frame (≤10s old)
 * when Frigate can't provide one.
 */

const FRIGATE_URL = process.env.FRIGATE_URL || "http://frigate:5000";

// 10 bad keys per minute per IP, then 429. The key is 256-bit random, so
// this is defense in depth against noisy scanners, not the primary guard.
const authFailures = createRateLimiter({ max: 10, windowMs: 60_000 });

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

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
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

  const { slug } = await context.params;
  const camera = await prisma.camera.findUnique({
    where: { slug },
    select: { slug: true, enabled: true },
  });
  if (!camera || !camera.enabled) {
    return NextResponse.json({ error: "Camera not found" }, { status: 404 });
  }

  // Optional height, clamped; Frigate scales the frame server-side.
  const hParam = Number(request.nextUrl.searchParams.get("h"));
  const height =
    Number.isInteger(hParam) && hParam > 0
      ? Math.min(Math.max(hParam, 90), 2160)
      : null;

  try {
    const url =
      `${FRIGATE_URL}/api/${encodeURIComponent(camera.slug)}/latest.jpg` +
      (height ? `?h=${height}` : "");
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      return new NextResponse(res.body, {
        status: 200,
        headers: {
          "Content-Type": res.headers.get("content-type") || "image/jpeg",
          "Cache-Control": "no-cache, no-store",
        },
      });
    }
  } catch {
    // Frigate unreachable — fall through to the warmer cache
  }

  const cached = getCachedSnapshot(camera.slug);
  if (cached) {
    return new NextResponse(new Uint8Array(cached.buffer), {
      status: 200,
      headers: {
        "Content-Type": cached.contentType,
        "Cache-Control": "no-cache, no-store",
        "X-Snapshot-Age": String(Date.now() - cached.timestamp),
      },
    });
  }

  return NextResponse.json({ error: "Snapshot unavailable" }, { status: 502 });
}
