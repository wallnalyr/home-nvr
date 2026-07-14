import { NextResponse } from "next/server";
import {
  removeAuthCookie,
  removeSessionCookie,
  getSessionToken,
  revokeSession,
} from "@/lib/auth";

export async function POST() {
  // Revoke server-side so any localStorage backup of the session
  // token is also invalidated.
  const sessionToken = await getSessionToken();
  if (sessionToken) {
    await revokeSession(sessionToken);
  }
  await removeAuthCookie();
  await removeSessionCookie();
  return NextResponse.json({ success: true });
}
