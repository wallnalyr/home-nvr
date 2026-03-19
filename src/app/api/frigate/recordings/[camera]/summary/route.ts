import { NextRequest, NextResponse } from "next/server";

const FRIGATE_URL = process.env.FRIGATE_URL || "http://frigate:5000";
const SERVER_TZ =
  process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

type RouteContext = { params: Promise<{ camera: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const { camera } = await context.params;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const url = new URL(
      `${FRIGATE_URL}/api/${encodeURIComponent(camera)}/recordings/summary`
    );
    url.searchParams.set("timezone", SERVER_TZ);

    const res = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) {
      return NextResponse.json(
        { error: `Frigate returned ${res.status}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch recording summary";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
