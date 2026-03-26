import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { webpush, VAPID_PUBLIC_KEY } from "@/lib/webpush";

export async function POST() {
  const results: Record<string, unknown> = {};

  // Step 1: Check VAPID keys
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  results.vapid = {
    publicKeySet: !!VAPID_PUBLIC_KEY,
    publicKeyLength: VAPID_PUBLIC_KEY?.length ?? 0,
    privateKeySet: !!vapidPrivate,
    privateKeyLength: vapidPrivate?.length ?? 0,
    subject: process.env.VAPID_SUBJECT || "(not set)",
  };

  if (!VAPID_PUBLIC_KEY || !vapidPrivate) {
    results.error = "VAPID keys not configured — push notifications cannot work";
    return NextResponse.json(results, { status: 500 });
  }

  // Step 2: Check subscriptions
  const subscriptions = await prisma.pushSubscription.findMany({
    select: {
      id: true,
      endpoint: true,
      userAgent: true,
      createdAt: true,
    },
  });

  results.subscriptions = {
    count: subscriptions.length,
    endpoints: subscriptions.map((s) => ({
      id: s.id,
      endpoint: s.endpoint.slice(0, 80) + "...",
      userAgent: s.userAgent?.slice(0, 60) || "(unknown)",
      createdAt: s.createdAt.toISOString(),
    })),
  };

  if (subscriptions.length === 0) {
    results.error =
      "No push subscriptions registered. Go to Settings > Notifications and enable push notifications first.";
    return NextResponse.json(results, { status: 400 });
  }

  // Step 3: Send test notification to all subscribers
  const fullSubs = await prisma.pushSubscription.findMany();
  const sendResults: Array<{ id: string; success: boolean; error?: string }> = [];

  for (const sub of fullSubs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify({
          title: "Test Notification",
          body: `Push notifications are working! (${new Date().toLocaleTimeString([], { timeZone: process.env.TZ })})`,
          icon: "/icon-192x192.png",
          badge: "/badge-mono.png",
          tag: "test",
          data: { url: "/settings" },
        })
      );
      sendResults.push({ id: sub.id, success: true });
    } catch (error: unknown) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      const message = (error as { message?: string }).message || "Unknown error";

      sendResults.push({
        id: sub.id,
        success: false,
        error: `HTTP ${statusCode}: ${message}`,
      });

      // Clean up expired subscriptions
      if (statusCode === 410 || statusCode === 404) {
        await prisma.pushSubscription.delete({ where: { id: sub.id } });
      }
    }
  }

  results.sendResults = sendResults;
  results.summary = {
    sent: sendResults.filter((r) => r.success).length,
    failed: sendResults.filter((r) => !r.success).length,
    total: sendResults.length,
  };

  return NextResponse.json(results);
}
