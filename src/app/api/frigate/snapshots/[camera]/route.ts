import { NextRequest, NextResponse } from "next/server";
import { getFrigateSnapshot } from "@/lib/frigate-client";

type RouteContext = { params: Promise<{ camera: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const { camera } = await context.params;

  try {
    const res = await getFrigateSnapshot(camera);
    if (!res.ok) {
      // Return empty 404 (not JSON) so <img> tags fail silently
      return new NextResponse(null, { status: 404 });
    }

    const buffer = await res.arrayBuffer();
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "no-cache",
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
