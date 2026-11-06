import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeSnapshotRequest } from "@/lib/snapshot-auth";
import { getCachedSnapshot } from "@/lib/stream-warmer";

/**
 * Snapshot image endpoint for external displays (kiosks, countertop hubs).
 * API-key authenticated — see snapshot-auth.ts. Discover cameras via
 * GET /api/snapshot.
 *
 * Proxies Frigate's /api/<camera>/latest.jpg (a frame the detection
 * pipeline already holds in memory — effectively live, cheap to serve),
 * falling back to the stream warmer's cached go2rtc frame (≤10s old)
 * when Frigate can't provide one.
 */

const FRIGATE_URL = process.env.FRIGATE_URL || "http://frigate:5000";

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const denied = await authorizeSnapshotRequest(request);
  if (denied) return denied;

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
