import { NextResponse } from "next/server";
import { getFrigateStats } from "@/lib/frigate-client";

export async function GET() {
  try {
    const stats = await getFrigateStats();
    return NextResponse.json(stats);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch stats";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
