import { prisma } from "@/lib/db";
import { LiveView } from "@/components/streaming/live-view";
import type { Camera } from "@/types/camera";

export const dynamic = "force-dynamic";

function stripRtspUrls<T extends Record<string, unknown>>(
  camera: T
): Omit<T, "rtspUrl" | "rtspSubUrl"> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { rtspUrl: _r, rtspSubUrl: _s, ...safe } = camera;
  return safe as Omit<T, "rtspUrl" | "rtspSubUrl">;
}

export default async function LivePage() {
  const cameras = await prisma.camera.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { zones: true },
  });

  // Strip RTSP URLs (sensitive) and serialize dates for the client
  const safeCameras: Camera[] = cameras.map((cam) => {
    const safe = stripRtspUrls(cam);
    return {
      ...safe,
      hasSubStream: !!cam.rtspSubUrl,
      createdAt: cam.createdAt.toISOString(),
      updatedAt: cam.updatedAt.toISOString(),
    };
  }) as Camera[];

  return <LiveView initialCameras={safeCameras} />;
}
