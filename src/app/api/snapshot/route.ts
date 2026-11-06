import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeSnapshotRequest } from "@/lib/snapshot-auth";
import { getAllCameraHealth } from "@/lib/stream-warmer";

/**
 * Camera discovery for kiosk devices — same API key as the image
 * endpoint. Returns the enabled cameras in grid order so a hub can
 * render whatever exists without hardcoding slugs:
 *
 *   { "cameras": [ { "slug": "front_door", "name": "Front Door",
 *                    "online": true, "snapshot": "/api/snapshot/front_door" } ] }
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

  const health = getAllCameraHealth();

  return NextResponse.json(
    {
      cameras: cameras.map((cam) => ({
        slug: cam.slug,
        name: cam.name,
        online: health[cam.slug]?.online ?? true,
        snapshot: `/api/snapshot/${cam.slug}`,
      })),
    },
    { headers: { "Cache-Control": "no-cache, no-store" } },
  );
}
