import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkDetectionViability } from "@/lib/hardware-detect";

export async function GET() {
  // Get all cameras with detection enabled
  const cameras = await prisma.camera.findMany({
    where: { enabled: true, detectEnabled: true },
    select: { detectFps: true, detectWidth: true, detectHeight: true },
  });

  const detectCamerasCount = cameras.length;
  const maxFps = cameras.reduce((max, c) => Math.max(max, c.detectFps), 5);
  const maxRes = cameras.reduce(
    (max, c) => Math.max(max, c.detectWidth * c.detectHeight),
    1280 * 720
  );

  const result = checkDetectionViability(detectCamerasCount, maxFps, maxRes);
  return NextResponse.json(result);
}
