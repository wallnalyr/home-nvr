/**
 * Stream Warmer — keeps go2rtc RTSP streams warm, caches snapshots,
 * and monitors camera health (online/offline).
 *
 * Runs server-side only. Periodically fetches a JPEG snapshot from go2rtc
 * for each enabled camera. This has two effects:
 * 1. Keeps the RTSP source active in go2rtc (no cold-start latency for viewers)
 * 2. Provides a cached snapshot for near-instant client display
 *
 * Camera health is determined by two signals:
 * 1. go2rtc stream producer status (is the RTSP source connected?)
 * 2. Frigate camera FPS (is actual video data being decoded?)
 * A camera can be "connected" (producers active) but stale (0 FPS) when
 * the RTSP server accepts connections but sends no valid video data.
 */

const GO2RTC_URL = process.env.FRIGATE_INTERNAL_URL || "http://frigate:1984";
const SNAPSHOT_INTERVAL_MS = 10000;
const CAMERA_REFRESH_INTERVAL_MS = 30000;

// Camera is considered offline after 3 consecutive checks with no producers (~30s)
const OFFLINE_THRESHOLD = 3;
// Stream is stale (connected but no video data) after 6 consecutive checks (~60s)
const STALE_THRESHOLD = 6;
// Don't re-notify for the same camera going offline within 30 minutes
const OFFLINE_NOTIFY_COOLDOWN_MS = 30 * 60 * 1000;
// Try to restart a dead go2rtc stream every 60 seconds
const STREAM_RESTART_INTERVAL_MS = 60000;
// Only notify after camera has been offline for this long (gives restarts time to work)
const OFFLINE_NOTIFY_DELAY_MS = 3 * 60 * 1000; // 3 minutes

interface CachedSnapshot {
  buffer: Buffer;
  contentType: string;
  timestamp: number;
}

export interface CameraHealth {
  online: boolean;
  lastSeen: number; // timestamp of last successful producer check
  offlineSince: number | null; // timestamp when camera went offline
  failCount: number; // consecutive checks with no producer
  staleCount: number; // consecutive checks with producer but 0 FPS
  recoveryCount: number; // consecutive checks with producer while offline
  restartAttempts: number; // escalation counter (reset on recovery)
}

// Use globalThis to survive hot reloads in development
const globalForWarmer = globalThis as unknown as {
  __snapshotCache?: Map<string, CachedSnapshot>;
  __cameraHealth?: Map<string, CameraHealth>;
  __offlineNotifiedAt?: Map<string, number>;
  __lastRestartAttempt?: Map<string, number>;
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

// Track when we last tried to restart a stream
const lastRestartAttempt =
  globalForWarmer.__lastRestartAttempt ?? new Map<string, number>();
globalForWarmer.__lastRestartAttempt = lastRestartAttempt;

let activeSlugs: string[] = globalForWarmer.__warmerSlugs ?? [];

// --- Snapshot cache (keeps streams warm, no health logic) ---

async function fetchSnapshot(slug: string): Promise<void> {
  try {
    const res = await fetch(
      `${GO2RTC_URL}/api/frame.jpeg?src=${encodeURIComponent(slug)}`,
      { signal: AbortSignal.timeout(5000) },
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

  // Fetch Frigate stats to verify cameras are actually decoding frames.
  // A camera can have active go2rtc producers (RTSP connected) but deliver
  // no valid video data — Frigate's camera_fps catches this.
  let frigateStats: Record<string, { camera_fps?: number }> | null = null;
  try {
    const { getFrigateStats } = await import("@/lib/frigate-client");
    const stats = await getFrigateStats();
    frigateStats = stats?.cameras ?? null;
  } catch {
    // Frigate unavailable — skip FPS check, still use producer status
  }

  const now = Date.now();

  for (const slug of activeSlugs) {
    const stream = streams[slug];
    const health = cameraHealth.get(slug) || {
      online: true,
      lastSeen: now,
      offlineSince: null,
      failCount: 0,
      staleCount: 0,
      recoveryCount: 0,
      restartAttempts: 0,
    };

    // A stream has active producers when the RTSP source is connected.
    // No stream entry at all means go2rtc hasn't loaded the config yet — skip.
    if (!stream) {
      cameraHealth.set(slug, health);
      continue;
    }

    const hasProducers =
      Array.isArray(stream.producers) && stream.producers.length > 0;

    if (hasProducers) {
      // Producers exist — but is actual video data flowing?
      // Check Frigate's reported FPS for this camera.
      const cameraFps = frigateStats?.[slug]?.camera_fps;
      if (frigateStats && cameraFps !== undefined && cameraFps <= 0) {
        // Connected but no frames decoding — stale stream
        recordStale(slug, health, now);
      } else {
        // Either FPS is healthy, or Frigate stats unavailable (don't penalize)
        recordSuccess(slug, health, now);
      }
    } else {
      recordFailure(slug, health, now);
    }

    // If offline, periodically attempt recovery with escalation
    if (!health.online) {
      const lastRestart = lastRestartAttempt.get(slug) || 0;
      if (now - lastRestart >= STREAM_RESTART_INTERVAL_MS) {
        lastRestartAttempt.set(slug, now);
        health.restartAttempts++;

        if (health.restartAttempts <= 1) {
          // First attempt: config push (least invasive)
          restartStream(slug).catch(() => {});
        } else {
          // Subsequent attempts: tear down go2rtc stream + config push
          resetStream(slug).catch(() => {});
        }
      }
    }
  }
}

/**
 * Restart a go2rtc stream by pushing a fresh Frigate config.
 * This triggers a Frigate restart which reinitializes go2rtc with
 * all stream definitions — the same thing a server restart does.
 *
 * We batch this: if multiple cameras are offline, one config push
 * restarts all streams. The flag prevents redundant pushes within
 * the same cycle.
 */
let configPushPending = false;

async function restartStream(slug: string): Promise<void> {
  if (configPushPending) return;
  configPushPending = true;

  try {
    const { regenerateFrigateConfig } =
      await import("@/lib/frigate-config-gen");
    await regenerateFrigateConfig();
    console.log(
      `[StreamWarmer] Pushed config to restart streams (triggered by "${slug}")`,
    );
  } catch (err) {
    console.error("[StreamWarmer] Config push for stream restart failed:", err);
  } finally {
    configPushPending = false;
  }
}

/**
 * Hard-reset a go2rtc stream by deleting it and pushing a fresh config.
 * Unlike restartStream(), this tears down go2rtc's upstream RTSP connection
 * to the camera, forcing a completely new session. Used when a config push
 * alone doesn't recover a stale stream (e.g. camera accepts connections
 * but sends no valid video data).
 */
async function resetStream(slug: string): Promise<void> {
  try {
    // Delete the main stream (and sub stream if it exists)
    const streams = [`src=${encodeURIComponent(slug)}`];
    // Check if a sub stream exists
    try {
      const res = await fetch(`${GO2RTC_URL}/api/streams`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const all = await res.json();
        if (all[`${slug}_sub`]) {
          streams.push(`src=${encodeURIComponent(`${slug}_sub`)}`);
        }
      }
    } catch {
      // Can't check — just delete the main stream
    }

    for (const param of streams) {
      await fetch(`${GO2RTC_URL}/api/streams?${param}`, {
        method: "DELETE",
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});
    }

    console.log(
      `[StreamWarmer] Deleted go2rtc stream(s) for "${slug}", pushing config to re-add`,
    );

    // Re-add via config push (regenerates all go2rtc stream definitions)
    const { regenerateFrigateConfig } =
      await import("@/lib/frigate-config-gen");
    await regenerateFrigateConfig();
  } catch (err) {
    console.error(`[StreamWarmer] Stream reset failed for "${slug}":`, err);
  }
}

function recordSuccess(slug: string, health: CameraHealth, now: number): void {
  if (!health.online) {
    // Camera was offline — require consecutive successes before recovery
    health.recoveryCount++;
    health.failCount = 0;
    health.staleCount = 0;
    if (health.recoveryCount >= OFFLINE_THRESHOLD) {
      health.online = true;
      health.offlineSince = null;
      health.recoveryCount = 0;
      health.restartAttempts = 0;
      // Only send "back online" notification if we previously sent an offline one
      const wasNotified = offlineNotifiedAt.has(slug);
      offlineNotifiedAt.delete(slug);
      lastRestartAttempt.delete(slug);
      console.log(`[StreamWarmer] Camera "${slug}" is back online`);
      if (wasNotified) {
        sendOnlineNotification(slug).catch((err) => {
          console.error("[StreamWarmer] Online notification failed:", err);
        });
      }
    }
  } else {
    health.failCount = 0;
    health.staleCount = 0;
  }
  health.lastSeen = now;
  cameraHealth.set(slug, health);
}

function recordStale(slug: string, health: CameraHealth, now: number): void {
  health.staleCount++;
  health.failCount = 0;

  if (health.staleCount >= STALE_THRESHOLD && health.online) {
    health.online = false;
    health.offlineSince = now;
    console.log(
      `[StreamWarmer] Camera "${slug}" has a stale stream (connected but 0 FPS for ${health.staleCount} checks)`,
    );
  }

  // Notification follows the same delay logic as recordFailure
  if (!health.online && health.offlineSince) {
    const downDuration = now - health.offlineSince;
    if (downDuration >= OFFLINE_NOTIFY_DELAY_MS) {
      const lastNotified = offlineNotifiedAt.get(slug) || 0;
      if (now - lastNotified >= OFFLINE_NOTIFY_COOLDOWN_MS) {
        sendOfflineNotification(slug).catch((err) => {
          console.error("[StreamWarmer] Offline notification failed:", err);
        });
      }
    }
  }

  cameraHealth.set(slug, health);
}

function recordFailure(slug: string, health: CameraHealth, now: number): void {
  health.failCount++;
  health.staleCount = 0;
  health.recoveryCount = 0;

  if (health.failCount >= OFFLINE_THRESHOLD && health.online) {
    // Mark offline for UI immediately — notification is delayed
    health.online = false;
    health.offlineSince = now;
    console.log(
      `[StreamWarmer] Camera "${slug}" is offline (${health.failCount} consecutive checks with no producer)`,
    );
  }

  // Only notify after the camera has been down long enough for restart
  // attempts to have had a chance to fix it
  if (!health.online && health.offlineSince) {
    const downDuration = now - health.offlineSince;
    if (downDuration >= OFFLINE_NOTIFY_DELAY_MS) {
      const lastNotified = offlineNotifiedAt.get(slug) || 0;
      if (now - lastNotified >= OFFLINE_NOTIFY_COOLDOWN_MS) {
        sendOfflineNotification(slug).catch((err) => {
          console.error("[StreamWarmer] Offline notification failed:", err);
        });
      }
    }
  }

  cameraHealth.set(slug, health);
}

// --- Notifications ---

async function sendOfflineNotification(slug: string): Promise<void> {
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
        eventId: `offline-${slug}-${Date.now()}`,
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
          payload,
        );
        sentCount++;
      } catch (error: unknown) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 410 || statusCode === 404) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } });
        }
      }
    }

    offlineNotifiedAt.set(slug, Date.now());
    console.log(
      `[StreamWarmer] Sent ${sentCount} offline notification(s) for "${slug}"`,
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
          payload,
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
      `[StreamWarmer] Sent ${sentCount} online notification(s) for "${slug}"`,
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
        lastRestartAttempt.delete(key);
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

  console.log(`[StreamWarmer] Warming ${activeSlugs.length} camera stream(s)`);

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
