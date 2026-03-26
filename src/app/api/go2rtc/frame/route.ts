import { NextRequest, NextResponse } from "next/server";
import { getCachedSnapshot } from "@/lib/stream-warmer";

const GO2RTC_URL = process.env.FRIGATE_INTERNAL_URL || "http://frigate:1984";

export async function HEAD(request: NextRequest) {
  const src = request.nextUrl.searchParams.get("src");
  if (!src) {
    return new NextResponse(null, { status: 400 });
  }

  // Check server-side cache first
  const cached = getCachedSnapshot(src);
  if (cached) {
    return new NextResponse(null, { status: 200 });
  }

  try {
    const res = await fetch(
      `${GO2RTC_URL}/api/frame.jpeg?src=${encodeURIComponent(src)}`,
      { method: "HEAD", signal: AbortSignal.timeout(5000) }
    );
    return new NextResponse(null, { status: res.ok ? 200 : res.status });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}

export async function GET(request: NextRequest) {
  const src = request.nextUrl.searchParams.get("src");
  if (!src) {
    return NextResponse.json({ error: "Missing src parameter" }, { status: 400 });
  }

  // Serve from server-side snapshot cache (populated by stream warmer)
  const cached = getCachedSnapshot(src);
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

  // Cache miss — proxy to go2rtc directly
  try {
    const res = await fetch(
      `${GO2RTC_URL}/api/frame.jpeg?src=${encodeURIComponent(src)}`,
      {
        headers: {
          Accept: request.headers.get("accept") || "image/jpeg",
        },
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!res.ok) {
      return new NextResponse(null, { status: res.status });
    }

    return new NextResponse(res.body, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("content-type") || "image/jpeg",
        "Cache-Control": "no-cache, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "go2rtc unavailable" }, { status: 502 });
  }
}
