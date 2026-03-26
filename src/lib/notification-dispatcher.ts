import { prisma } from "@/lib/db";
import { webpush } from "@/lib/webpush";
import { getFrigateEventSnapshot } from "@/lib/frigate-client";
import { getAudioLabelById } from "@/lib/objects";
import type { NotificationPayload } from "@/types/notification";

// Cooldown tracking: camera -> last notification timestamp
const cooldowns = new Map<string, number>();
// Audio cooldown: camera-label -> last notification timestamp
const audioCooldowns = new Map<string, number>();

// Batch buffer: collect events per-camera for 2 seconds before sending
const BATCH_WINDOW_MS = 2000;

interface BufferedEvent {
  label: string;
  eventId: string;
  cameraName: string;
}

interface CameraBatch {
  events: BufferedEvent[];
  timer: ReturnType<typeof setTimeout>;
}

const eventBuffers = new Map<string, CameraBatch>();

interface AudioEventPayload {
  _audio: true;
  camera: string;
  label: string;
  state: string;
}

interface FrigateEventPayload {
  type: string;
  before: {
    id: string;
    camera: string;
    label: string;
    top_score: number;
    current_zones: string[];
    has_snapshot: boolean;
  };
  after: {
    id: string;
    camera: string;
    label: string;
    top_score: number;
    current_zones: string[];
    has_snapshot: boolean;
  };
}

export async function handleFrigateEvent(payload: unknown) {
  // Route audio events to dedicated handler
  if (
    typeof payload === "object" &&
    payload !== null &&
    "_audio" in payload
  ) {
    await handleAudioEvent(payload as AudioEventPayload);
    return;
  }

  const event = payload as FrigateEventPayload;

  // Only process new events
  if (event.type !== "new") return;

  const { after } = event;
  const { camera: cameraName, label, id: eventId } = after;

  console.log(
    `[Notification] New event: ${label} on ${cameraName} (${eventId})`
  );

  // Look up camera in DB by slug (Frigate uses slug as camera identifier)
  const camera = await prisma.camera.findFirst({
    where: { slug: cameraName, enabled: true, notifyEnabled: true },
  });
  if (!camera) {
    console.log(
      `[Notification] Skipped: camera "${cameraName}" not found, disabled, or notifications off`
    );
    return;
  }

  // Check cooldown — only block if no active batch (batch window acts as its own collector)
  const now = Date.now();
  const lastNotified = cooldowns.get(cameraName) || 0;
  const hasBatch = eventBuffers.has(cameraName);
  if (!hasBatch && now - lastNotified < camera.notifyCooldownSec * 1000) {
    console.log(
      `[Notification] Skipped: cooldown active for ${cameraName} (${camera.notifyCooldownSec}s)`
    );
    return;
  }

  // Check notification object filter
  const notifObjRow = await prisma.systemConfig.findUnique({
    where: { key: "notification_objects" },
  });
  if (notifObjRow) {
    const allowedObjects: string[] = JSON.parse(notifObjRow.value);
    if (!allowedObjects.includes(label)) {
      console.log(
        `[Notification] Skipped: "${label}" not in notification objects filter`
      );
      return;
    }
  }

  // Add to batch buffer
  const existing = eventBuffers.get(cameraName);
  if (existing) {
    // Don't duplicate the same label in one batch
    if (!existing.events.some((e) => e.label === label)) {
      existing.events.push({ label, eventId, cameraName });
      console.log(`[Notification] Batched: ${label} on ${cameraName} (${existing.events.length} in batch)`);
    }
  } else {
    // Start a new batch with a 2-second timer
    const timer = setTimeout(() => {
      flushEventBuffer(cameraName).catch((err) => {
        console.error("[Notification] Error flushing batch:", err);
      });
    }, BATCH_WINDOW_MS);

    eventBuffers.set(cameraName, {
      events: [{ label, eventId, cameraName }],
      timer,
    });
    console.log(`[Notification] Buffered: ${label} on ${cameraName} (2s batch window started)`);
  }
}

async function flushEventBuffer(cameraName: string) {
  const batch = eventBuffers.get(cameraName);
  eventBuffers.delete(cameraName);
  if (!batch || batch.events.length === 0) return;

  const { events } = batch;
  const firstEvent = events[0];

  // Look up camera for display name
  const camera = await prisma.camera.findFirst({
    where: { slug: cameraName },
  });
  const displayName = camera?.name || cameraName;

  // Get all push subscriptions with preferences
  const subscriptions = await prisma.pushSubscription.findMany({
    include: { preferences: true },
  });

  if (subscriptions.length === 0) {
    console.log("[Notification] Skipped: no push subscriptions registered");
    return;
  }

  // Filter subscriptions — eligible if ANY label in the batch is allowed
  const eligibleSubscriptions = subscriptions.filter((sub) => {
    const prefs = sub.preferences;

    return events.some((evt) => {
      const specific = prefs.find(
        (p) => p.camera === cameraName && p.objectType === evt.label
      );
      if (specific) return specific.enabled;

      const cameraAll = prefs.find(
        (p) => p.camera === cameraName && p.objectType === "*"
      );
      if (cameraAll) return cameraAll.enabled;

      const allCameraSpecific = prefs.find(
        (p) => p.camera === "*" && p.objectType === evt.label
      );
      if (allCameraSpecific) return allCameraSpecific.enabled;

      const global = prefs.find(
        (p) => p.camera === "*" && p.objectType === "*"
      );
      if (global) return global.enabled;

      return true;
    });
  });

  if (eligibleSubscriptions.length === 0) {
    console.log(
      "[Notification] Skipped: all subscriptions filtered by preferences"
    );
    return;
  }

  // Fetch snapshot from the first event
  let snapshotUrl: string | undefined;
  try {
    const snapshotRes = await getFrigateEventSnapshot(firstEvent.eventId);
    if (snapshotRes.ok) {
      snapshotUrl = `/api/frigate/events/${firstEvent.eventId}/snapshot`;
    }
  } catch {
    // Continue without snapshot
  }

  // Build title: "Person, Car detected" or "Person detected"
  const labels = events.map(
    (e) => e.label.charAt(0).toUpperCase() + e.label.slice(1)
  );
  const title = `${labels.join(", ")} detected`;

  const notificationPayload: NotificationPayload = {
    title,
    body: `${displayName} - ${new Date().toLocaleTimeString([], { timeZone: process.env.TZ })}`,
    icon: snapshotUrl || "/icon-192x192.png",
    badge: "/badge-mono.png",
    tag: `${cameraName}-batch`,
    data: {
      url: `/events/${firstEvent.eventId}`,
      eventId: firstEvent.eventId,
      camera: cameraName,
      objectType: events.map((e) => e.label).join(","),
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
        JSON.stringify(notificationPayload)
      );
      sentCount++;
    } catch (error: unknown) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      const message = (error as { message?: string }).message;
      if (statusCode === 410 || statusCode === 404) {
        console.log(
          `[Notification] Removing expired subscription: ${sub.endpoint.slice(0, 60)}...`
        );
        await prisma.pushSubscription.delete({ where: { id: sub.id } });
      } else {
        console.error(
          `[Notification] Failed to send push (HTTP ${statusCode}):`,
          message || error
        );
      }
    }
  }

  // Update cooldown after batch is sent
  cooldowns.set(cameraName, Date.now());

  console.log(
    `[Notification] Sent ${sentCount}/${eligibleSubscriptions.length} notifications for [${labels.join(", ")}] on ${cameraName}`
  );

  // Log notification for each event in the batch
  for (const evt of events) {
    await prisma.notificationLog.create({
      data: {
        eventId: evt.eventId,
        camera: cameraName,
        objectType: evt.label,
        sentCount,
        snapshotUrl,
      },
    });
  }
}

const AUDIO_COOLDOWN_MS = 60000; // 1 minute between audio notifications per camera+label

async function handleAudioEvent(payload: AudioEventPayload) {
  const { camera: cameraName, label, state } = payload;

  // Only notify on "ON" (sound started)
  if (state !== "ON") return;

  const audioDef = getAudioLabelById(label);
  if (!audioDef) return;

  console.log(`[Notification] Audio: ${label} on ${cameraName}`);

  // Check camera is enabled with notifications on
  const camera = await prisma.camera.findFirst({
    where: { slug: cameraName, enabled: true, notifyEnabled: true },
  });
  if (!camera) return;

  // Check audio cooldown (per camera+label)
  const cooldownKey = `${cameraName}-${label}`;
  const now = Date.now();
  const lastNotified = audioCooldowns.get(cooldownKey) || 0;
  if (now - lastNotified < AUDIO_COOLDOWN_MS) {
    console.log(`[Notification] Audio skipped: cooldown active for ${cooldownKey}`);
    return;
  }

  // Check notification audio filter
  const notifAudioRow = await prisma.systemConfig.findUnique({
    where: { key: "notification_audio" },
  });
  if (notifAudioRow) {
    const allowedAudio: string[] = JSON.parse(notifAudioRow.value);
    if (!allowedAudio.includes(label)) {
      console.log(`[Notification] Audio skipped: "${label}" not in notification audio filter`);
      return;
    }
  }

  // Get subscriptions (reuse same preference system — audio uses label as objectType)
  const subscriptions = await prisma.pushSubscription.findMany({
    include: { preferences: true },
  });
  if (subscriptions.length === 0) return;

  const displayName = camera.name;
  const displayLabel = audioDef.label;

  const notificationPayload: NotificationPayload = {
    title: `${displayLabel} detected`,
    body: `${displayName} - ${new Date().toLocaleTimeString([], { timeZone: process.env.TZ })}`,
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
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify(notificationPayload)
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
    `[Notification] Sent ${sentCount} audio notifications for ${label} on ${cameraName}`
  );
}
