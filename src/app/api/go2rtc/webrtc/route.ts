import { NextRequest, NextResponse } from "next/server";

const GO2RTC_URL = process.env.FRIGATE_INTERNAL_URL || "http://frigate:1984";

export async function POST(request: NextRequest) {
  const src = request.nextUrl.searchParams.get("src");
  if (!src) {
    return NextResponse.json({ error: "Missing src parameter" }, { status: 400 });
  }

  try {
    const body = await request.text();
    const res = await fetch(
      `${GO2RTC_URL}/api/webrtc?src=${encodeURIComponent(src)}`,
      {
        method: "POST",
        headers: { "Content-Type": request.headers.get("content-type") || "application/sdp" },
        body,
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!res.ok) {
      return new NextResponse(null, { status: res.status });
    }

    const responseBody = await res.text();
    return new NextResponse(responseBody, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("content-type") || "application/sdp",
      },
    });
  } catch {
    return NextResponse.json({ error: "go2rtc unavailable" }, { status: 502 });
  }
}
