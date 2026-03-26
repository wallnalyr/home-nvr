import { NextRequest, NextResponse } from "next/server";

const FRIGATE_URL = process.env.FRIGATE_URL || "http://frigate:5000";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const clipUrl = `${FRIGATE_URL}/api/events/${encodeURIComponent(id)}/clip.mp4`;

  try {
    // Forward Range header to Frigate for native byte-range serving
    const headers: Record<string, string> = {};
    const range = request.headers.get("range");
    if (range) {
      headers["Range"] = range;
    }

    const res = await fetch(clipUrl, {
      headers,
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok && res.status !== 206) {
      return new NextResponse(null, { status: res.status });
    }

    if (!res.body) {
      return new NextResponse(null, { status: 502 });
    }

    const responseHeaders: Record<string, string> = {
      "Content-Type": "video/mp4",
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=3600",
    };

    const contentLength = res.headers.get("content-length");
    if (contentLength) {
      responseHeaders["Content-Length"] = contentLength;
    }
    const contentRange = res.headers.get("content-range");
    if (contentRange) {
      responseHeaders["Content-Range"] = contentRange;
    }

    // Create an explicit ReadableStream that pipes from the upstream response.
    // This works reliably in Next.js standalone (unlike passing res.body directly).
    const reader = res.body.getReader();
    const stream = new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
        } else {
          controller.enqueue(value);
        }
      },
      cancel() {
        reader.cancel();
      },
    });

    return new NextResponse(stream, {
      status: res.status,
      headers: responseHeaders,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch clip" },
      { status: 502 }
    );
  }
}
