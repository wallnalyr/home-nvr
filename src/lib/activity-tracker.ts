/**
 * Camera activity tracker — powers the `active` flag on the kiosk
 * snapshot list (/api/snapshot) so external displays can switch to a
 * camera while something is being detected there.
 *
 * Fed from the same MQTT review stream as push notifications, and runs
 * the same label-filter cascade (review-filter.ts), so the per-camera
 * object selections, zones (enforced inside Frigate as object masks),
 * and notifyEnabled are respected identically. Deliberate differences
 * from notifications: no cooldown and no per-review dedup — activity is
 * a state ("someone is currently here"), not an alert — and `end`
 * messages matter here (they clear the state after a short hold).
 */

import { resolveReviewLabels } from "@/lib/review-filter";

// Keep a camera active briefly after its last review ends so the kiosk
// doesn't flap back to the grid the moment Frigate closes a review.
const ACTIVITY_HOLD_MS = 10_000;

// Safety net: if an `end` never arrives (missed MQTT message), expire
// activity this long after the last review message touched it. Long
// quiet-but-ongoing reviews can get cut off by this — acceptable next to
// a kiosk stuck on one camera forever.
const ACTIVITY_STALE_MS = 5 * 60_000;

interface CameraActivity {
  reviewIds: Set<string>; // open reviews currently backing this activity
  labels: Set<string>; // union of allowed labels seen this activity
  since: number; // when this activity burst started
  lastSeen: number; // last review message that touched it
  endedAt: number | null; // set when the last open review ended
}

const activity = new Map<string, CameraActivity>();

interface ReviewMessage {
  type?: string;
  after?: {
    id?: string;
    camera?: string;
    data?: { objects?: string[] };
  } | null;
}

function isActive(entry: CameraActivity, now: number): boolean {
  if (entry.endedAt !== null) return now - entry.endedAt < ACTIVITY_HOLD_MS;
  return now - entry.lastSeen < ACTIVITY_STALE_MS;
}

/**
 * Feed one frigate/reviews message into the tracker. Safe to call with
 * any payload shape — non-review messages are ignored.
 */
export async function trackReviewActivity(payload: unknown): Promise<void> {
  const review = payload as ReviewMessage;
  const after = review?.after;
  if (!after?.id || !after.camera) return;

  const now = Date.now();

  if (review.type === "end") {
    const entry = activity.get(after.camera);
    if (!entry) return;
    entry.reviewIds.delete(after.id);
    if (entry.reviewIds.size === 0 && entry.endedAt === null) {
      entry.endedAt = now;
    }
    return;
  }

  if (review.type !== "new" && review.type !== "update") return;

  const objects = after.data?.objects ?? [];
  if (objects.length === 0) return;

  const resolved = await resolveReviewLabels(after.camera, objects);
  if (!resolved || resolved.allowedLabels.length === 0) return;

  let entry = activity.get(after.camera);
  if (!entry || !isActive(entry, now)) {
    // Fresh activity burst (or a long-expired entry) — start over so
    // stale labels and review ids don't leak into the new burst
    entry = {
      reviewIds: new Set(),
      labels: new Set(),
      since: now,
      lastSeen: now,
      endedAt: null,
    };
    activity.set(after.camera, entry);
  }

  entry.reviewIds.add(after.id);
  for (const label of resolved.allowedLabels) entry.labels.add(label);
  entry.lastSeen = now;
  // A new review during the hold window revives the activity
  entry.endedAt = null;
}

export interface ActiveCameraInfo {
  labels: string[];
  since: number; // epoch ms
}

/**
 * Snapshot of currently-active cameras. With a labelFilter, a camera only
 * counts as active if at least one of its labels is in the filter.
 */
export function getActiveCameras(
  labelFilter?: string[],
): Record<string, ActiveCameraInfo> {
  const now = Date.now();
  const result: Record<string, ActiveCameraInfo> = {};

  for (const [slug, entry] of activity) {
    if (!isActive(entry, now)) {
      activity.delete(slug);
      continue;
    }
    const labels =
      labelFilter && labelFilter.length > 0
        ? [...entry.labels].filter((l) => labelFilter.includes(l))
        : [...entry.labels];
    if (labels.length === 0) continue;
    result[slug] = { labels, since: entry.since };
  }

  return result;
}
