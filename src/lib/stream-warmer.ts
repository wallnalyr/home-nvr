/**
 * Stream Warmer — keeps go2rtc RTSP streams warm and caches snapshots.
 *
 * Runs server-side only. Periodically fetches a JPEG snapshot from go2rtc
 * for each enabled camera. This has two effects:
 * 1. Keeps the RTSP source active in go2rtc (no cold-start latency for viewers)
 * 2. Provides a cached snapshot for near-instant client display
 */

const GO2RTC_URL = process.env.FRIGATE_INTERNAL_URL || "http://frigate:1984";
const SNAPSHOT_INTERVAL_MS = 10000;
const CAMERA_REFRESH_INTERVAL_MS = 30000;

interface CachedSnapshot {
  buffer: Buffer;
  contentType: string;
  timestamp: number;
}

// Use globalThis to survive hot reloads in development
const globalForWarmer = globalThis as unknown as {
  __snapshotCache?: Map<string, CachedSnapshot>;
  __warmerInterval?: ReturnType<typeof setInterval>;
  __cameraRefreshInterval?: ReturnType<typeof setInterval>;
  __warmerSlugs?: string[];
};

const snapshotCache =
  globalForWarmer.__snapshotCache ?? new Map<string, CachedSnapshot>();
globalForWarmer.__snapshotCache = snapshotCache;

let activeSlugs: string[] = globalForWarmer.__warmerSlugs ?? [];

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

async function refreshCameraList(): Promise<void> {
  try {
    const { prisma } = await import("@/lib/db");
    const cameras = await prisma.camera.findMany({
      where: { enabled: true },
      select: { slug: true },
    });
    activeSlugs = cameras.map((c) => c.slug);
    globalForWarmer.__warmerSlugs = activeSlugs;

    // Remove cached snapshots for cameras that no longer exist
    for (const key of snapshotCache.keys()) {
      if (!activeSlugs.includes(key)) {
        snapshotCache.delete(key);
      }
    }
  } catch {
    // DB error — keep existing camera list
  }
}

async function warmAll(): Promise<void> {
  await Promise.allSettled(activeSlugs.map(fetchSnapshot));
}

export function getCachedSnapshot(slug: string): CachedSnapshot | null {
  return snapshotCache.get(slug) ?? null;
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
