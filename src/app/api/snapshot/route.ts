import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeSnapshotRequest } from "@/lib/snapshot-auth";
import { getActiveCameras } from "@/lib/activity-tracker";
import { getAllCameraHealth } from "@/lib/stream-warmer";

/**
 * Camera discovery for kiosk devices — same API key as the image
 * endpoint. Returns the enabled cameras in grid order so a hub can
 * render whatever exists without hardcoding slugs:
 *
 *   { "cameras": [ { "slug": "front_door", "name": "Front Door",
 *                    "online": true, "active": true, "label": "person",
 *                    "activeSince": 1767600000,
 *                    "snapshot": "/api/snapshot/front_door" } ] }
 *
 * `active` means a detection matching the camera's configured objects
 * (and outside its exclusion zones) is in progress — same rules that
 * trigger a push notification, minus cooldowns. `label`/`activeSince`
 * (epoch seconds) are present only while active. Pass ?labels=person,car
 * to only count those labels toward `active`.
 *
 * Deliberately exposes nothing else — no RTSP URLs, no detection or
 * notification settings.
 */

export async function GET(request: NextRequest) {
  const denied = await authorizeSnapshotRequest(request);
  if (denied) return denied;

  const cameras = await prisma.camera.findMany({
    where: { enabled: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { slug: true, name: true },
  });

  const labelsParam = request.nextUrl.searchParams.get("labels");
  const labelFilter = labelsParam
    ? labelsParam.split(",").map((l) => l.trim()).filter(Boolean)
    : undefined;

  const health = getAllCameraHealth();
  const active = getActiveCameras(labelFilter);

  return NextResponse.json(
    {
      cameras: cameras.map((cam) => {
        const activity = active[cam.slug];
        return {
          slug: cam.slug,
          name: cam.name,
          online: health[cam.slug]?.online ?? true,
          active: !!activity,
          ...(activity
            ? {
                label: activity.labels[0],
                activeSince: Math.floor(activity.since / 1000),
              }
            : {}),
          snapshot: `/api/snapshot/${cam.slug}`,
        };
      }),
    },
    { headers: { "Cache-Control": "no-cache, no-store" } },
  );
}
