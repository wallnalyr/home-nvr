import { NextRequest, NextResponse } from "next/server";
import { verifyToken, signToken, setAuthCookie } from "@/lib/auth";

/**
 * Restore a session from a localStorage-backed token.
 * iOS PWAs aggressively clear cookies — this lets the client
 * re-establish the httpOnly cookie from a stored token.
 */
export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json();
    if (!token || typeof token !== "string") {
      return NextResponse.json({ error: "Token required" }, { status: 400 });
    }

    const payload = await verifyToken(token);
    if (!payload?.sub) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    // Issue a fresh token and set the cookie
    const freshToken = await signToken({ sub: payload.sub as string });
    await setAuthCookie(freshToken);

    return NextResponse.json({ success: true, token: freshToken });
  } catch {
    return NextResponse.json({ error: "Restore failed" }, { status: 401 });
  }
}
