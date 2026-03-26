import { NextRequest, NextResponse } from "next/server";
import { getFrigateEvents } from "@/lib/frigate-client";

const ALLOWED_PARAMS = new Set([
  "camera",
  "label",
  "zone",
  "after",
  "before",
  "has_clip",
  "has_snapshot",
  "limit",
  "event_id",
  "favorites",
  "min_score",
  "max_score",
]);

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const params: Record<string, string> = {};
  for (const [key, value] of searchParams.entries()) {
    if (ALLOWED_PARAMS.has(key)) {
      params[key] = value;
    }
  }

  try {
    const events = await getFrigateEvents(params);
    return NextResponse.json(events);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch events";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
