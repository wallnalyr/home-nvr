/**
 * Stream Warmer — keeps go2rtc RTSP streams warm, caches snapshots,
 * and monitors camera health (online/offline).
 *
 * Runs server-side only. Periodically fetches a JPEG snapshot from go2rtc
 * for each enabled camera. This has two effects:
 * 1. Keeps the RTSP source active in go2rtc (no cold-start latency for viewers)
 * 2. Provides a cached snapshot for near-instant client display
 *
 * Camera health: tracks consecutive failures per camera. After
 * OFFLINE_THRESHOLD consecutive failures, marks the camera offline and
 * sends a push notification. When the camera recovers, marks it online.
 */

const GO2RTC_URL = process.env.FRIGATE_INTERNAL_URL || "http://frigate:1984";
const FRIGATE_URL = process.env.FRIGATE_URL || "http://frigate:5000";
const SNAPSHOT_INTERVAL_MS = 10000;
const CAMERA_REFRESH_INTERVAL_MS = 30000;

// Camera is considered offline after 3 consecutive failures (~30s)
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
  lastSeen: number;       // timestamp of last successful snapshot
  offlineSince: number | null;  // timestamp when camera went offline
  failCount: number;      // consecutive failures
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

async function fetchSnapshot(slug: string): Promise<void> {
  const now = Date.now();
  const health = cameraHealth.get(slug) || {
    online: true,
    lastSeen: now,
    offlineSince: null,
    failCount: 0,
  };

  try {
    const res = await fetch(
      `${GO2RTC_URL}/api/frame.jpeg?src=${encodeURIComponent(slug)}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) {
      recordFailure(slug, health, now);
      return;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    snapshotCache.set(slug, {
      buffer,
      contentType: res.headers.get("content-type") || "image/jpeg",
      timestamp: now,
    });

    // Camera recovered — reset notification cooldown so the next
    // offline event notifies immediately
    if (!health.online) {
      console.log(`[StreamWarmer] Camera "${slug}" is back online`);
      offlineNotifiedAt.delete(slug);
    }
    health.online = true;
    health.lastSeen = now;
    health.offlineSince = null;
    health.failCount = 0;
    cameraHealth.set(slug, health);
  } catch {
    recordFailure(slug, health, now);
  }
}

function recordFailure(slug: string, health: CameraHealth, now: number): void {
  health.failCount++;

  if (health.failCount >= OFFLINE_THRESHOLD && health.online) {
    // Transition to offline
    health.online = false;
    health.offlineSince = now;
    console.log(
      `[StreamWarmer] Camera "${slug}" is offline (${health.failCount} consecutive failures)`
    );
    // Fire notification asynchronously
    sendOfflineNotification(slug).catch((err) => {
      console.error("[StreamWarmer] Offline notification failed:", err);
    });
  }

  cameraHealth.set(slug, health);
}

async function sendOfflineNotification(slug: string): Promise<void> {
  const now = Date.now();
  const lastNotified = offlineNotifiedAt.get(slug) || 0;
  if (now - lastNotified < OFFLINE_NOTIFY_COOLDOWN_MS) {
    console.log(`[StreamWarmer] Offline notification for "${slug}" suppressed (cooldown)`);
    return;
  }

  try {
    const { prisma } = await import("@/lib/db");

    // Look up camera for display name and notification setting
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

async function warmAll(): Promise<void> {
  // Fetch snapshots (keeps streams warm + caches frames)
  await Promise.allSettled(activeSlugs.map(fetchSnapshot));

  // Cross-check with Frigate stats — go2rtc may serve cached frames
  // for dead cameras, but Frigate's camera_fps drops to 0.
  await checkFrigateStats();
}

async function checkFrigateStats(): Promise<void> {
  try {
    const res = await fetch(`${FRIGATE_URL}/api/stats`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return;

    const stats = await res.json();
    const now = Date.now();

    for (const slug of activeSlugs) {
      const cameraStat = stats[slug];
      if (!cameraStat) continue;

      const health = cameraHealth.get(slug);
      if (!health) continue;

      // camera_fps === 0 means Frigate can't read frames from the source
      const cameraFps = cameraStat.camera_fps ?? -1;
      if (cameraFps === 0 && health.online) {
        // Frigate says camera is down but go2rtc snapshot succeeded (cached frame).
        // Increment failure count to trigger offline detection.
        recordFailure(slug, health, now);
      }
    }
  } catch {
    // Frigate API unavailable — rely on go2rtc snapshot check alone
  }
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
