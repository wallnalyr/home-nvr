import { NextResponse } from "next/server";
import { VAPID_PUBLIC_KEY } from "@/lib/webpush";

export async function GET() {
  if (!VAPID_PUBLIC_KEY) {
    return NextResponse.json(
      { error: "VAPID keys not configured" },
      { status: 500 }
    );
  }
  return NextResponse.json({ key: VAPID_PUBLIC_KEY });
}
