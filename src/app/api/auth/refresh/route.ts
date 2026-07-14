import { NextRequest, NextResponse } from "next/server";
import {
  validateSession,
  signToken,
  setAuthCookie,
  setSessionCookie,
  getSessionToken,
  removeSessionCookie,
} from "@/lib/auth";

/**
 * Re-establish the short-lived auth cookie from a long-lived session.
 *
 * iOS PWAs aggressively purge cookies when the app process is killed.
 * The client calls this on every app open with the session token from
 * its cookie or localStorage backup; a valid session gets a fresh JWT
 * cookie and a slid session expiry, so active users never see the
 * login page. Sessions are revocable server-side (logout deletes them).
 */
export async function POST(request: NextRequest) {
  let bodyToken: string | undefined;
  try {
    const body = await request.json();
    if (typeof body?.token === "string") bodyToken = body.token;
  } catch {
    // No/invalid JSON body — fall back to the session cookie
  }

  const token = bodyToken || (await getSessionToken());
  if (!token) {
    return NextResponse.json({ error: "No session" }, { status: 401 });
  }

  const session = await validateSession(token);
  if (!session) {
    await removeSessionCookie();
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  }

  const authToken = await signToken({ sub: session.username });
  await setAuthCookie(authToken);
  // Re-set the session cookie so its maxAge slides with the session
  await setSessionCookie(token);

  return NextResponse.json({ success: true, sessionToken: token });
}
