import { NextResponse } from "next/server";
import { getAllCameraHealth } from "@/lib/stream-warmer";

export async function GET() {
  return NextResponse.json(getAllCameraHealth());
}
