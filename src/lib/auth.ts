import { createHash, randomBytes } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "development-secret-change-me"
);
const COOKIE_NAME = "auth-token";
const TOKEN_EXPIRY = "7d";

const SESSION_COOKIE_NAME = "session-token";
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days, sliding

export async function signToken(payload: { sub: string }): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload;
  } catch {
    return null;
  }
}

export async function setAuthCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: "/",
  });
}

export async function removeAuthCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function getAuthToken(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAME)?.value;
}

export async function getAuthPayload() {
  const token = await getAuthToken();
  if (!token) return null;
  return verifyToken(token);
}

// --- Long-lived, revocable sessions (survive iOS PWA cookie purges) ---
//
// The session token is an opaque 256-bit random value. Only its sha256
// hash is stored server-side, so a database leak does not expose usable
// tokens. The client keeps a copy in localStorage as a backup for when
// iOS purges cookies; logout revokes the session server-side, which
// also invalidates any localStorage copy.

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  username: string,
  userAgent?: string | null
): Promise<string> {
  // Opportunistic cleanup of expired sessions from abandoned devices
  await prisma.authSession.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });

  const token = randomBytes(32).toString("base64url");
  await prisma.authSession.create({
    data: {
      tokenHash: hashSessionToken(token),
      username,
      userAgent: userAgent || null,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return token;
}

/**
 * Validates a session token. On success, slides the expiry window
 * forward and returns the session. Expired sessions are deleted.
 */
export async function validateSession(token: string) {
  const tokenHash = hashSessionToken(token);
  const session = await prisma.authSession.findUnique({ where: { tokenHash } });
  if (!session) return null;

  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.authSession.delete({ where: { tokenHash } }).catch(() => {});
    return null;
  }

  try {
    return await prisma.authSession.update({
      where: { tokenHash },
      data: {
        lastUsedAt: new Date(),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
  } catch {
    // Session was revoked between lookup and update
    return null;
  }
}

export async function revokeSession(token: string): Promise<void> {
  await prisma.authSession.deleteMany({
    where: { tokenHash: hashSessionToken(token) },
  });
}

export async function setSessionCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_MS / 1000,
    // Only sent to auth endpoints — keeps the long-lived token off
    // every other request.
    path: "/api/auth",
  });
}

export async function getSessionToken(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE_NAME)?.value;
}

export async function removeSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, "", { maxAge: 0, path: "/api/auth" });
}
