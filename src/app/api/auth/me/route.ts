import { NextResponse } from "next/server";
import { getAuthPayload } from "@/lib/auth";

export async function GET() {
  const payload = await getAuthPayload();
  if (!payload) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ username: payload.sub });
}
