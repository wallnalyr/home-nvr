import { prisma } from "@/lib/db";
import { webpush } from "@/lib/webpush";
import { getFrigateEventSnapshot } from "@/lib/frigate-client";
import {
  getAudioLabelById,
  DEFAULT_ENABLED_OBJECTS,
  DEFAULT_ENABLED_AUDIO,
} from "@/lib/objects";
import type { NotificationPayload } from "@/types/notification";

// Audio cooldown: camera-label -> last notification timestamp
const audioCooldowns = new Map<string, number>();

// Object review cooldown: camera -> last notification timestamp. Enforces
// the per-camera Camera.notifyCooldownSec setting.
const reviewCooldowns = new Map<string, number>();

// Recently-notified review IDs. Frigate should only emit `new` once per review,
// but guard against MQTT redelivery and listener restart races. Entries auto-expire.
const recentReviewIds = new Map<string, number>();
const REVIEW_DEDUP_TTL_MS = 10 * 60 * 1000;

function rememberReviewId(reviewId: string) {
  const now = Date.now();
  recentReviewIds.set(reviewId, now);
  // Opportunistic cleanup to keep the map bounded
  for (const [id, ts] of recentReviewIds) {
    if (now - ts > REVIEW_DEDUP_TTL_MS) recentReviewIds.delete(id);
  }
}

function alreadyNotifiedReview(reviewId: string): boolean {
  const ts = recentReviewIds.get(reviewId);
  if (!ts) return false;
  if (Date.now() - ts > REVIEW_DEDUP_TTL_MS) {
    recentReviewIds.delete(reviewId);
    return false;
  }
  return true;
}

interface AudioEventPayload {
  _audio: true;
  camera: string;
  label: string;
  state: string;
}

interface FrigateReviewSegment {
  id: string;
  camera: string;
  severity: "alert" | "detection";
  start_time: number;
  end_time: number | null;
  data: {
    objects: string[];
    sub_labels?: string[];
    zones?: string[];
    detections: string[];
  };
}

interface FrigateReviewPayload {
  type: "new" | "update" | "end";
  before: FrigateReviewSegment | null;
  after: FrigateReviewSegment;
}

export async function handleFrigateEvent(payload: unknown) {
  // Route audio events to dedicated handler
  if (typeof payload === "object" && payload !== null && "_audio" in payload) {
    await handleAudioEvent(payload as AudioEventPayload);
    return;
  }

  // Treat everything else as a frigate/reviews payload
  const review = payload as FrigateReviewPayload;

  // Fire on the start of a new review, or on an update that escalates a
  // review from detection to alert severity. `end` only marks activity
  // stopping. `new` messages are deliberately NOT gated on severity: Frigate
  // may still be running a config from before this app promoted tracked
  // labels to alert labels (config pushes can lag until a Frigate restart),
  // and under that config tracked labels like cat/dog arrive as
  // `detection`. The allowed-label filter below already drops anything the
  // user doesn't track.
  if (review.type !== "new" && review.type !== "update") return;

  const { after } = review;
  if (!after || !after.id || !after.camera || !after.data) return;

  const { id: reviewId, severity } = after;

  if (review.type === "update") {
    // Updates fire for many mid-review changes (new objects, zones). Only a
    // detection → alert escalation may notify; anything already notified is
    // deduped below. One accepted gap: a review notified at detection
    // severity that escalates after the dedup TTL expires re-notifies —
    // the escalation carries genuinely new information.
    const escalated =
      severity === "alert" && review.before?.severity !== "alert";
    if (!escalated) return;
  }

  if (alreadyNotifiedReview(reviewId)) {
    console.log(
      `[Notification] Skipped: review ${reviewId} already notified`,
    );
    return;
  }
  // Mark before any awaits so a duplicate delivery of the same review that
  // arrives while we're inside DB queries can't slip past the dedup check.
  rememberReviewId(reviewId);

  // Mutable so the count survives even if sendReviewPushes throws after a
  // push already went out — the mark below must not be rolled back then.
  const delivery = { sent: 0 };
  try {
    await sendReviewPushes(after, delivery);
  } finally {
    // A review nobody was actually notified about must stay retryable — a
    // later detection → alert escalation, or a redelivery after a transient
    // failure, should get another chance. Keep the dedup mark only when a
    // push went out.
    if (delivery.sent === 0) {
      recentReviewIds.delete(reviewId);
    }
  }
}

/**
 * Runs the filter cascade and sends the pushes for one review segment,
 * incrementing delivery.sent per successful push (0 = nobody was notified).
 */
async function sendReviewPushes(
  after: FrigateReviewSegment,
  delivery: { sent: number },
): Promise<void> {
  const {
    id: reviewId,
    camera: cameraName,
    severity,
    data: { objects = [], detections = [] },
  } = after;

  console.log(
    `[Notification] New review: ${severity} on ${cameraName} (${reviewId}) objects=[${objects.join(",")}]`,
  );

  if (objects.length === 0) {
    console.log(`[Notification] Skipped: review ${reviewId} has no objects`);
    return;
  }

  // Look up camera in DB by slug (Frigate uses slug as camera identifier)
  const camera = await prisma.camera.findFirst({
    where: { slug: cameraName, enabled: true, notifyEnabled: true },
  });
  if (!camera) {
    console.log(
      `[Notification] Skipped: camera "${cameraName}" not found, disabled, or notifications off`,
    );
    return;
  }

  // Per-camera cooldown (notifyCooldownSec; 0 disables)
  const cooldownMs = camera.notifyCooldownSec * 1000;
  let cooldownReservedAt: number | null = null;
  if (cooldownMs > 0) {
    const sinceMs = Date.now() - (reviewCooldowns.get(cameraName) ?? 0);
    if (sinceMs < cooldownMs) {
      console.log(
        `[Notification] Skipped: cooldown active for ${cameraName} (${Math.ceil((cooldownMs - sinceMs) / 1000)}s left)`,
      );
      return;
    }
    // Reserve the window before the awaits below so concurrent reviews on
    // this camera can't all pass the check while pushes are in flight.
    // Released again on every path that ends up sending nothing.
    cooldownReservedAt = Date.now();
    reviewCooldowns.set(cameraName, cooldownReservedAt);
  }

  const releaseCooldown = () => {
    if (
      cooldownReservedAt !== null &&
      reviewCooldowns.get(cameraName) === cooldownReservedAt
    ) {
      reviewCooldowns.delete(cameraName);
    }
  };

  // Apply per-camera, global, and notification-filter object lists to the
  // review's object set. The review fires for whatever Frigate tracked; we
  // narrow it down to only labels the user actually wants notifications for.
  const globalObjectsRow = await prisma.systemConfig.findUnique({
    where: { key: "enabled_objects" },
  });
  const globalObjects: string[] = globalObjectsRow
    ? JSON.parse(globalObjectsRow.value)
    : DEFAULT_ENABLED_OBJECTS;

  const cameraObjects = camera.objectsTrack
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  const notifObjRow = await prisma.systemConfig.findUnique({
    where: { key: "notification_objects" },
  });
  const notifAllowed: string[] | null = notifObjRow
    ? JSON.parse(notifObjRow.value)
    : null;

  // Frigate rewrites sub-labeled objects in review payloads (a recognized
  // person arrives as "person-verified") — strip the suffix so they still
  // match the tracked-label lists.
  const reviewLabels = [
    ...new Set(objects.map((label) => label.replace(/-verified$/, ""))),
  ];

  const allowedLabels = reviewLabels.filter(
    (label) =>
      globalObjects.includes(label) &&
      cameraObjects.includes(label) &&
      (!notifAllowed || notifAllowed.includes(label)),
  );

  if (allowedLabels.length === 0) {
    console.log(
      `[Notification] Skipped: no allowed labels in review ${reviewId} (had [${objects.join(",")}])`,
    );
    releaseCooldown();
    return;
  }

  // Get all push subscriptions with preferences
  const subscriptions = await prisma.pushSubscription.findMany({
    include: { preferences: true },
  });

  if (subscriptions.length === 0) {
    console.log("[Notification] Skipped: no push subscriptions registered");
    releaseCooldown();
    return;
  }

  const eligibleSubscriptions = filterEligibleSubscriptions(
    subscriptions,
    cameraName,
    allowedLabels,
  );

  if (eligibleSubscriptions.length === 0) {
    console.log(
      "[Notification] Skipped: all subscriptions filtered by preferences",
    );
    releaseCooldown();
    return;
  }

  // Use the first detection's event ID for snapshot + click-through. Review
  // payloads don't carry snapshots directly — they reference underlying events.
  const firstDetectionId = detections[0];

  let snapshotUrl: string | undefined;
  if (firstDetectionId) {
    try {
      const snapshotRes = await getFrigateEventSnapshot(firstDetectionId);
      if (snapshotRes.ok) {
        snapshotUrl = `/api/frigate/events/${firstDetectionId}/snapshot`;
      }
    } catch {
      // Continue without snapshot
    }
  }

  const displayName = camera.name || cameraName;

  // Build title: "Person on Guest House" or "Person & Car on Guest House"
  const labelTitles = allowedLabels.map(
    (l) => l.charAt(0).toUpperCase() + l.slice(1),
  );
  const labelStr =
    labelTitles.length <= 2
      ? labelTitles.join(" & ")
      : `${labelTitles.slice(0, -1).join(", ")} & ${labelTitles[labelTitles.length - 1]}`;
  const title = `${labelStr} on ${displayName}`;
  const timeStr = new Date().toLocaleTimeString([], {
    timeZone: process.env.TZ,
    hour: "numeric",
    minute: "2-digit",
  });

  // Click-through targets the underlying event so the existing /events/[id]
  // page (which reads Frigate's REST API) renders without changes.
  const clickEventId = firstDetectionId || reviewId;

  const notificationPayload: NotificationPayload = {
    title,
    body: timeStr,
    icon: snapshotUrl || "/icon-192x192.png",
    badge: "/badge-mono.png",
    tag: `${cameraName}-review-${reviewId}`,
    data: {
      url: `/events/${clickEventId}`,
      eventId: clickEventId,
      camera: cameraName,
      objectType: allowedLabels.join(","),
    },
  };

  for (const sub of eligibleSubscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify(notificationPayload),
      );
      delivery.sent++;
    } catch (error: unknown) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      const message = (error as { message?: string }).message;
      if (statusCode === 410 || statusCode === 404) {
        console.log(
          `[Notification] Removing expired subscription: ${sub.endpoint.slice(0, 60)}...`,
        );
        // Tolerate a concurrent handler having already removed the row —
        // a throw here would abort sends to the remaining subscriptions
        await prisma.pushSubscription
          .delete({ where: { id: sub.id } })
          .catch(() => {});
      } else {
        console.error(
          `[Notification] Failed to send push (HTTP ${statusCode}):`,
          message || error,
        );
      }
    }
  }

  const sentCount = delivery.sent;

  if (sentCount === 0) {
    // Nothing was delivered (e.g. transient push-service failure) — release
    // the cooldown window so the next review isn't throttled on the basis
    // of notifications nobody received.
    releaseCooldown();
  }

  console.log(
    `[Notification] Sent ${sentCount}/${eligibleSubscriptions.length} notifications for [${labelTitles.join(", ")}] on ${cameraName} (review ${reviewId})`,
  );

  // One log row per label in the review, keyed by review ID for dedup
  // analysis. eventId stores the underlying detection ID for traceability
  // back into Frigate's events API. Best-effort: a failed write must not
  // reject the function after pushes were already delivered.
  for (const label of allowedLabels) {
    try {
      await prisma.notificationLog.create({
        data: {
          reviewId,
          eventId: clickEventId,
          camera: cameraName,
          objectType: label,
          sentCount,
          snapshotUrl,
        },
      });
    } catch (error) {
      console.error("[Notification] Failed to write notification log:", error);
    }
  }
}

interface SubscriptionPreference {
  camera: string;
  objectType: string;
  enabled: boolean;
}

/**
 * Per-subscription preference cascade, most-specific rule first
 * (camera+label, camera+*, *+label, *+*), defaulting to allow. A
 * subscription is eligible if ANY of the given labels passes. Audio labels
 * use the same objectType field as object labels.
 */
function filterEligibleSubscriptions<
  T extends { preferences: SubscriptionPreference[] },
>(subscriptions: T[], cameraName: string, labels: string[]): T[] {
  return subscriptions.filter((sub) => {
    const prefs = sub.preferences;
    return labels.some((label) => {
      const specific = prefs.find(
        (p) => p.camera === cameraName && p.objectType === label,
      );
      if (specific) return specific.enabled;

      const cameraAll = prefs.find(
        (p) => p.camera === cameraName && p.objectType === "*",
      );
      if (cameraAll) return cameraAll.enabled;

      const allCameraSpecific = prefs.find(
        (p) => p.camera === "*" && p.objectType === label,
      );
      if (allCameraSpecific) return allCameraSpecific.enabled;

      const global = prefs.find(
        (p) => p.camera === "*" && p.objectType === "*",
      );
      if (global) return global.enabled;

      return true;
    });
  });
}

const AUDIO_COOLDOWN_MS = 60000; // 1 minute between audio notifications per camera+label

// Frigate publishes activity subtopics under <camera>/audio/ that are not
// sound labels; they are expected traffic, not vocabulary mismatches.
const NON_LABEL_AUDIO_TOPICS = new Set(["all", "state", "dBFS", "rms"]);

async function handleAudioEvent(payload: AudioEventPayload) {
  const { camera: cameraName, label, state } = payload;

  // Only notify on "ON" (sound started)
  if (state !== "ON") return;

  const audioDef = getAudioLabelById(label);
  if (!audioDef) {
    // Log real vocabulary mismatches — a silently dropped label made the
    // scream/car_horn bug undiagnosable for months.
    if (!NON_LABEL_AUDIO_TOPICS.has(label)) {
      console.log(
        `[Notification] Audio skipped: unknown label "${label}" on ${cameraName}`,
      );
    }
    return;
  }

  console.log(`[Notification] Audio: ${label} on ${cameraName}`);

  // Check camera is enabled with notifications on
  const camera = await prisma.camera.findFirst({
    where: { slug: cameraName, enabled: true, notifyEnabled: true },
  });
  if (!camera) return;

  // Check global enabled_audio setting
  const audioSettingsRow = await prisma.systemConfig.findUnique({
    where: { key: "enabled_audio" },
  });
  const globalAudio: string[] = audioSettingsRow
    ? JSON.parse(audioSettingsRow.value)
    : DEFAULT_ENABLED_AUDIO;
  if (!globalAudio.includes(label)) {
    console.log(
      `[Notification] Audio skipped: "${label}" not globally enabled`,
    );
    return;
  }

  // Check per-camera audioDetect
  const cameraAudio = camera.audioDetect
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  if (!cameraAudio.includes(label)) {
    console.log(
      `[Notification] Audio skipped: "${label}" not in camera "${cameraName}" audio list`,
    );
    return;
  }

  // Check audio cooldown (per camera+label)
  const cooldownKey = `${cameraName}-${label}`;
  const now = Date.now();
  const lastNotified = audioCooldowns.get(cooldownKey) || 0;
  if (now - lastNotified < AUDIO_COOLDOWN_MS) {
    console.log(
      `[Notification] Audio skipped: cooldown active for ${cooldownKey}`,
    );
    return;
  }

  // Check notification audio filter
  const notifAudioRow = await prisma.systemConfig.findUnique({
    where: { key: "notification_audio" },
  });
  if (notifAudioRow) {
    const allowedAudio: string[] = JSON.parse(notifAudioRow.value);
    if (!allowedAudio.includes(label)) {
      console.log(
        `[Notification] Audio skipped: "${label}" not in notification audio filter`,
      );
      return;
    }
  }

  // Same preference cascade as object reviews — audio uses the label as
  // the preference objectType
  const subscriptions = await prisma.pushSubscription.findMany({
    include: { preferences: true },
  });
  if (subscriptions.length === 0) return;

  const eligibleSubscriptions = filterEligibleSubscriptions(
    subscriptions,
    cameraName,
    [label],
  );
  if (eligibleSubscriptions.length === 0) {
    console.log(
      "[Notification] Audio skipped: all subscriptions filtered by preferences",
    );
    return;
  }

  const displayName = camera.name;
  const displayLabel = audioDef.label;

  const audioTimeStr = new Date().toLocaleTimeString([], {
    timeZone: process.env.TZ,
    hour: "numeric",
    minute: "2-digit",
  });
  const notificationPayload: NotificationPayload = {
    title: `${displayLabel} on ${displayName}`,
    body: audioTimeStr,
    icon: "/icon-192x192.png",
    badge: "/badge-mono.png",
    tag: `${cameraName}-audio-${label}`,
    data: {
      url: "/",
      eventId: `audio-${cameraName}-${label}-${now}`,
      camera: cameraName,
      objectType: `audio:${label}`,
    },
  };

  let sentCount = 0;
  for (const sub of eligibleSubscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify(notificationPayload),
      );
      sentCount++;
    } catch (error: unknown) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 410 || statusCode === 404) {
        await prisma.pushSubscription.delete({ where: { id: sub.id } });
      }
    }
  }

  audioCooldowns.set(cooldownKey, now);

  console.log(
    `[Notification] Sent ${sentCount} audio notifications for ${label} on ${cameraName}`,
  );
}
