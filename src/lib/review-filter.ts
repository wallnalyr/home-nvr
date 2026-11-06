/**
 * Shared label-filter cascade for Frigate review events.
 *
 * Both push notifications (notification-dispatcher) and kiosk activity
 * (activity-tracker) must agree on which detections "count": the camera
 * exists, is enabled, has notifications on, and the label passes the
 * camera's tracked-object list, the globally enabled objects, and the
 * notification object filter. Zones need no handling here — they are
 * pushed to Frigate as object masks, so zone-excluded objects never
 * produce review events at all.
 */

import type { Camera } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DEFAULT_ENABLED_OBJECTS } from "@/lib/objects";

export interface ResolvedReviewLabels {
  camera: Camera;
  allowedLabels: string[];
}

/**
 * Returns null when the camera is unknown, disabled, or has notifications
 * off. Otherwise returns the camera row and the review's labels narrowed
 * to the ones the user has selected (possibly empty).
 */
export async function resolveReviewLabels(
  cameraName: string,
  objects: string[],
): Promise<ResolvedReviewLabels | null> {
  const camera = await prisma.camera.findFirst({
    where: { slug: cameraName, enabled: true, notifyEnabled: true },
  });
  if (!camera) return null;

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

  return { camera, allowedLabels };
}
