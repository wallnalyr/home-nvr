import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { signToken, setAuthCookie } from "@/lib/auth";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";

// Support plaintext ADMIN_PASSWORD (hashed at runtime) or pre-hashed ADMIN_PASSWORD_HASH
let ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || "";
if (!ADMIN_PASSWORD_HASH && process.env.ADMIN_PASSWORD) {
  ADMIN_PASSWORD_HASH = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 12);
}

// Simple in-memory rate limiting
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(ip: string): boolean {
  const now = Date.now();

  // Periodically clean up expired entries to prevent memory leak
  if (loginAttempts.size > 1000) {
    for (const [key, record] of loginAttempts) {
      if (now > record.resetAt) loginAttempts.delete(key);
    }
  }

  const record = loginAttempts.get(ip);

  if (!record || now > record.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }

  if (record.count >= MAX_ATTEMPTS) {
    return false;
  }

  record.count++;
  return true;
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";

  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: "Too many login attempts. Try again later." },
      { status: 429 }
    );
  }

  try {
    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username and password required" },
        { status: 400 }
      );
    }

    if (username !== ADMIN_USERNAME) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    if (!ADMIN_PASSWORD_HASH) {
      return NextResponse.json(
        { error: "Admin password not configured" },
        { status: 500 }
      );
    }

    const valid = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
    if (!valid) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    const token = await signToken({ sub: username });
    await setAuthCookie(token);

    // Reset rate limit on success
    loginAttempts.delete(ip);

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
