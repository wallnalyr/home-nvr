import { NextRequest, NextResponse } from "next/server";
import { jwtVerify, SignJWT } from "jose";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "development-secret-change-me"
);

// Refresh the JWT when less than this many seconds remain
const REFRESH_THRESHOLD = 60 * 60 * 24; // 1 day

const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/system/health",
  "/manifest.json",
  "/manifest.webmanifest",
  "/sw.js",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function isStaticAsset(pathname: string): boolean {
  return (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/icon") ||
    pathname.startsWith("/apple") ||
    pathname.startsWith("/badge") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".ico") ||
    pathname.endsWith(".svg")
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isStaticAsset(pathname) || isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get("auth-token")?.value;

  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);

    // If authenticated user tries to access login, redirect to home
    if (pathname === "/login") {
      return NextResponse.redirect(new URL("/", request.url));
    }

    const response = NextResponse.next();

    // Rolling refresh: if the token is close to expiring, issue a fresh one.
    // This keeps the user logged in as long as they use the app at least
    // once within the refresh window, preventing the 7-day hard cutoff
    // that breaks iOS PWAs.
    if (payload.exp) {
      const remaining = payload.exp - Math.floor(Date.now() / 1000);
      if (remaining < REFRESH_THRESHOLD && payload.sub) {
        const freshToken = await new SignJWT({ sub: payload.sub })
          .setProtectedHeader({ alg: "HS256" })
          .setIssuedAt()
          .setExpirationTime("7d")
          .sign(JWT_SECRET);

        response.cookies.set("auth-token", freshToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          maxAge: 60 * 60 * 24 * 7,
          path: "/",
        });
      }
    }

    return response;
  } catch {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
