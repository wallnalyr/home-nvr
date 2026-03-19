import { NextRequest, NextResponse } from "next/server";
import { getFrigateRecordings } from "@/lib/frigate-client";

const ALLOWED_PARAMS = new Set(["after", "before"]);

type RouteContext = { params: Promise<{ camera: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { camera } = await context.params;
  const { searchParams } = request.nextUrl;

  const params: Record<string, string> = {};
  for (const [key, value] of searchParams.entries()) {
    if (ALLOWED_PARAMS.has(key)) {
      params[key] = value;
    }
  }

  try {
    const recordings = await getFrigateRecordings(camera, params);
    return NextResponse.json(recordings);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch recordings";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
