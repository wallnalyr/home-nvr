import { NextRequest, NextResponse } from "next/server";
import { getFrigateEventSnapshot } from "@/lib/frigate-client";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const res = await getFrigateEventSnapshot(id);
    if (!res.ok) {
      return NextResponse.json(
        { error: "Snapshot not found" },
        { status: res.status }
      );
    }

    const buffer = await res.arrayBuffer();
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch snapshot" },
      { status: 502 }
    );
  }
}
