import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod/v4";

const KNOWN_PUSH_DOMAINS = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.apple.com",
  "web.push.apple.com",
  "wns.windows.com",
];

const subscribeSchema = z.object({
  endpoint: z.string().url().refine(
    (url) => {
      try {
        const hostname = new URL(url).hostname;
        return KNOWN_PUSH_DOMAINS.some(
          (d) => hostname === d || hostname.endsWith(`.${d}`)
        );
      } catch {
        return false;
      }
    },
    "Endpoint must be a known push service"
  ),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const data = subscribeSchema.parse(body);

    const sub = await prisma.pushSubscription.upsert({
      where: { endpoint: data.endpoint },
      update: {
        p256dh: data.keys.p256dh,
        auth: data.keys.auth,
        userAgent: request.headers.get("user-agent") || undefined,
      },
      create: {
        endpoint: data.endpoint,
        p256dh: data.keys.p256dh,
        auth: data.keys.auth,
        userAgent: request.headers.get("user-agent") || undefined,
      },
    });

    console.log(
      `[Push] Subscription saved: ${sub.id} (${data.endpoint.slice(0, 60)}...)`
    );

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid subscription data", details: error.issues },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Failed to save subscription" },
      { status: 500 }
    );
  }
}
