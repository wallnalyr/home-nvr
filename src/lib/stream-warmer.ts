/**
 * Stream Warmer — keeps go2rtc RTSP streams warm, caches snapshots,
 * and monitors camera health (online/offline).
 *
 * Runs server-side only. Periodically fetches a JPEG snapshot from go2rtc
 * for each enabled camera. This has two effects:
 * 1. Keeps the RTSP source active in go2rtc (no cold-start latency for viewers)
 * 2. Provides a cached snapshot for near-instant client display
 *
 * Camera health is determined by go2rtc's stream producer status. A camera
 * is online when go2rtc has at least one active producer (RTSP source
 * connected). This is the most reliable signal — it checks the actual
 * RTSP connection, not inferred from FPS stats or cached frames.
 */

const GO2RTC_URL = process.env.FRIGATE_INTERNAL_URL || "http://frigate:1984";
const SNAPSHOT_INTERVAL_MS = 10000;
const CAMERA_REFRESH_INTERVAL_MS = 30000;

// Camera is considered offline after 3 consecutive checks with no producers (~30s)
const OFFLINE_THRESHOLD = 3;
// Don't re-notify for the same camera going offline within 30 minutes
const OFFLINE_NOTIFY_COOLDOWN_MS = 30 * 60 * 1000;

interface CachedSnapshot {
  buffer: Buffer;
  contentType: string;
  timestamp: number;
}

export interface CameraHealth {
  online: boolean;
  lastSeen: number;       // timestamp of last successful producer check
  offlineSince: number | null;  // timestamp when camera went offline
  failCount: number;      // consecutive checks with no producer
  recoveryCount: number;  // consecutive checks with producer while offline
}

// Use globalThis to survive hot reloads in development
const globalForWarmer = globalThis as unknown as {
  __snapshotCache?: Map<string, CachedSnapshot>;
  __cameraHealth?: Map<string, CameraHealth>;
  __offlineNotifiedAt?: Map<string, number>;
  __warmerInterval?: ReturnType<typeof setInterval>;
  __cameraRefreshInterval?: ReturnType<typeof setInterval>;
  __warmerSlugs?: string[];
};

const snapshotCache =
  globalForWarmer.__snapshotCache ?? new Map<string, CachedSnapshot>();
globalForWarmer.__snapshotCache = snapshotCache;

const cameraHealth =
  globalForWarmer.__cameraHealth ?? new Map<string, CameraHealth>();
globalForWarmer.__cameraHealth = cameraHealth;

// Track when we last notified per camera to avoid spam
const offlineNotifiedAt =
  globalForWarmer.__offlineNotifiedAt ?? new Map<string, number>();
globalForWarmer.__offlineNotifiedAt = offlineNotifiedAt;

let activeSlugs: string[] = globalForWarmer.__warmerSlugs ?? [];

// --- Snapshot cache (keeps streams warm, no health logic) ---

async function fetchSnapshot(slug: string): Promise<void> {
  try {
    const res = await fetch(
      `${GO2RTC_URL}/api/frame.jpeg?src=${encodeURIComponent(slug)}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return;

    const buffer = Buffer.from(await res.arrayBuffer());
    snapshotCache.set(slug, {
      buffer,
      contentType: res.headers.get("content-type") || "image/jpeg",
      timestamp: Date.now(),
    });
  } catch {
    // go2rtc unavailable or timeout — keep existing cached frame
  }
}

// --- Health detection via go2rtc stream producers ---

async function checkStreamHealth(): Promise<void> {
  let streams: Record<string, { producers?: unknown[] }>;
  try {
    const res = await fetch(`${GO2RTC_URL}/api/streams`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return;
    streams = await res.json();
  } catch {
    // go2rtc unavailable — skip health check this cycle
    return;
  }

  const now = Date.now();

  for (const slug of activeSlugs) {
    const stream = streams[slug];
    const health = cameraHealth.get(slug) || {
      online: true,
      lastSeen: now,
      offlineSince: null,
      failCount: 0,
      recoveryCount: 0,
    };

    // A stream has active producers when the RTSP source is connected.
    // No stream entry at all means go2rtc hasn't loaded the config yet — skip.
    if (!stream) {
      cameraHealth.set(slug, health);
      continue;
    }

    const hasProducers = Array.isArray(stream.producers) && stream.producers.length > 0;

    if (hasProducers) {
      recordSuccess(slug, health, now);
    } else {
      recordFailure(slug, health, now);
    }
  }
}

function recordSuccess(slug: string, health: CameraHealth, now: number): void {
  if (!health.online) {
    // Camera was offline — require consecutive successes before recovery
    health.recoveryCount++;
    health.failCount = 0;
    if (health.recoveryCount >= OFFLINE_THRESHOLD) {
      health.online = true;
      health.offlineSince = null;
      health.recoveryCount = 0;
      offlineNotifiedAt.delete(slug);
      console.log(`[StreamWarmer] Camera "${slug}" is back online`);
      sendOnlineNotification(slug).catch((err) => {
        console.error("[StreamWarmer] Online notification failed:", err);
      });
    }
  } else {
    health.failCount = 0;
  }
  health.lastSeen = now;
  cameraHealth.set(slug, health);
}

function recordFailure(slug: string, health: CameraHealth, now: number): void {
  health.failCount++;
  health.recoveryCount = 0;

  if (health.failCount >= OFFLINE_THRESHOLD && health.online) {
    health.online = false;
    health.offlineSince = now;
    console.log(
      `[StreamWarmer] Camera "${slug}" is offline (${health.failCount} consecutive checks with no producer)`
    );
    sendOfflineNotification(slug).catch((err) => {
      console.error("[StreamWarmer] Offline notification failed:", err);
    });
  }

  cameraHealth.set(slug, health);
}

// --- Notifications ---

async function sendOfflineNotification(slug: string): Promise<void> {
  const now = Date.now();
  const lastNotified = offlineNotifiedAt.get(slug) || 0;
  if (now - lastNotified < OFFLINE_NOTIFY_COOLDOWN_MS) {
    console.log(`[StreamWarmer] Offline notification for "${slug}" suppressed (cooldown)`);
    return;
  }

  try {
    const { prisma } = await import("@/lib/db");

    const camera = await prisma.camera.findFirst({
      where: { slug, enabled: true, notifyEnabled: true },
    });
    if (!camera) return;

    const { webpush } = await import("@/lib/webpush");
    const subscriptions = await prisma.pushSubscription.findMany();
    if (subscriptions.length === 0) return;

    const payload = JSON.stringify({
      title: `${camera.name} is offline`,
      body: `Camera went offline at ${new Date().toLocaleTimeString([], { timeZone: process.env.TZ })}`,
      icon: "/icon-192x192.png",
      badge: "/badge-mono.png",
      tag: `${slug}-offline`,
      data: {
        url: "/",
        eventId: `offline-${slug}-${now}`,
        camera: slug,
        objectType: "camera_offline",
      },
    });

    let sentCount = 0;
    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload
        );
        sentCount++;
      } catch (error: unknown) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 410 || statusCode === 404) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } });
        }
      }
    }

    offlineNotifiedAt.set(slug, now);
    console.log(
      `[StreamWarmer] Sent ${sentCount} offline notification(s) for "${slug}"`
    );
  } catch (err) {
    console.error("[StreamWarmer] Failed to send offline notification:", err);
  }
}

async function sendOnlineNotification(slug: string): Promise<void> {
  try {
    const { prisma } = await import("@/lib/db");

    const camera = await prisma.camera.findFirst({
      where: { slug, enabled: true, notifyEnabled: true },
    });
    if (!camera) return;

    const { webpush } = await import("@/lib/webpush");
    const subscriptions = await prisma.pushSubscription.findMany();
    if (subscriptions.length === 0) return;

    const payload = JSON.stringify({
      title: `${camera.name} is back online`,
      body: `Camera recovered at ${new Date().toLocaleTimeString([], { timeZone: process.env.TZ })}`,
      icon: "/icon-192x192.png",
      badge: "/badge-mono.png",
      tag: `${slug}-offline`,
      data: {
        url: "/",
        eventId: `online-${slug}-${Date.now()}`,
        camera: slug,
        objectType: "camera_online",
      },
    });

    let sentCount = 0;
    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload
        );
        sentCount++;
      } catch (error: unknown) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 410 || statusCode === 404) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } });
        }
      }
    }

    console.log(
      `[StreamWarmer] Sent ${sentCount} online notification(s) for "${slug}"`
    );
  } catch (err) {
    console.error("[StreamWarmer] Failed to send online notification:", err);
  }
}

// --- Camera list management ---

async function refreshCameraList(): Promise<void> {
  try {
    const { prisma } = await import("@/lib/db");
    const cameras = await prisma.camera.findMany({
      where: { enabled: true },
      select: { slug: true },
    });
    activeSlugs = cameras.map((c) => c.slug);
    globalForWarmer.__warmerSlugs = activeSlugs;

    // Remove cached snapshots and health for cameras that no longer exist
    for (const key of snapshotCache.keys()) {
      if (!activeSlugs.includes(key)) {
        snapshotCache.delete(key);
      }
    }
    for (const key of cameraHealth.keys()) {
      if (!activeSlugs.includes(key)) {
        cameraHealth.delete(key);
        offlineNotifiedAt.delete(key);
      }
    }
  } catch {
    // DB error — keep existing camera list
  }
}

// --- Main loop ---

async function warmAll(): Promise<void> {
  await Promise.all([
    // Snapshot cache (keeps streams warm)
    Promise.allSettled(activeSlugs.map(fetchSnapshot)),
    // Health check (producer status)
    checkStreamHealth(),
  ]);
}

export function getCachedSnapshot(slug: string): CachedSnapshot | null {
  return snapshotCache.get(slug) ?? null;
}

export function getCameraHealth(slug: string): CameraHealth | null {
  return cameraHealth.get(slug) ?? null;
}

export function getAllCameraHealth(): Record<string, CameraHealth> {
  const result: Record<string, CameraHealth> = {};
  for (const [slug, health] of cameraHealth) {
    result[slug] = health;
  }
  return result;
}

export async function startStreamWarmer(): Promise<void> {
  // Don't start duplicate intervals
  if (globalForWarmer.__warmerInterval) return;

  console.log("[StreamWarmer] Starting...");

  await refreshCameraList();
  // Fire initial warm without awaiting (non-blocking)
  warmAll().catch(() => {});

  console.log(
    `[StreamWarmer] Warming ${activeSlugs.length} camera stream(s)`
  );

  const warmerInterval = setInterval(() => {
    warmAll().catch(() => {});
  }, SNAPSHOT_INTERVAL_MS);
  globalForWarmer.__warmerInterval = warmerInterval;

  const cameraInterval = setInterval(() => {
    refreshCameraList().catch(() => {});
  }, CAMERA_REFRESH_INTERVAL_MS);
  globalForWarmer.__cameraRefreshInterval = cameraInterval;
}

/** Notify the warmer to re-fetch the camera list (e.g. after add/delete). */
export function refreshWarmerCameras(): void {
  refreshCameraList().catch(() => {});
}
