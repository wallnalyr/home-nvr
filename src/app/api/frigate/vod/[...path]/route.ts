import { NextRequest, NextResponse } from "next/server";

const FRIGATE_URL = process.env.FRIGATE_URL || "http://frigate:5000";

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;

  // Prevent path traversal — reject segments that could escape /vod/
  if (path.some((s) => s === ".." || s.startsWith("/") || s === ".")) {
    return new NextResponse(null, { status: 400 });
  }

  const vodPath = path.join("/");

  try {
    const frigateUrl = `${FRIGATE_URL}/vod/${vodPath}`;
    const res = await fetch(frigateUrl, {
      headers: {
        Accept: request.headers.get("accept") || "*/*",
      },
    });

    if (!res.ok) {
      return new NextResponse(null, { status: res.status });
    }

    const contentType = res.headers.get("content-type") || "application/octet-stream";

    // For m3u8 playlists, rewrite absolute /vod/ paths to our proxy path
    if (contentType.includes("mpegurl") || vodPath.endsWith(".m3u8")) {
      let body = await res.text();
      body = body.replace(/\/vod\//g, "/api/frigate/vod/");
      return new NextResponse(body, {
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Cache-Control": "no-cache",
        },
      });
    }

    // For ts segments and other binary data, stream directly
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600",
    };
    const contentLength = res.headers.get("content-length");
    if (contentLength) {
      headers["Content-Length"] = contentLength;
    }
    return new NextResponse(res.body, { headers });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch VOD content" },
      { status: 502 }
    );
  }
}
