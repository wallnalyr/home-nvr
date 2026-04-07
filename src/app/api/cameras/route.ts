import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { DEFAULT_ENABLED_AUDIO, DEFAULT_ENABLED_OBJECTS } from "@/lib/objects";
import { z } from "zod/v4";

const CAMERA_NAME_REGEX = /^[a-zA-Z0-9 _\-'.]+$/;

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s\-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

const createCameraSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(50)
    .regex(CAMERA_NAME_REGEX, "Letters, numbers, spaces, hyphens, and underscores allowed"),
  rtspUrl: z.string().refine(
    (url) => url.startsWith("rtsp://") || url.startsWith("rtsps://"),
    "Must be an RTSP URL"
  ),
  rtspSubUrl: z
    .string()
    .transform((v) => (v === "" ? undefined : v))
    .refine(
      (url) => url === undefined || url.startsWith("rtsp://") || url.startsWith("rtsps://"),
      "Must be an RTSP URL"
    )
    .optional(),
  enabled: z.boolean().default(true),
  detectEnabled: z.boolean().default(true),
  detectWidth: z.number().int().min(320).max(3840).default(1280),
  detectHeight: z.number().int().min(240).max(2160).default(720),
  detectFps: z.number().int().min(1).max(30).default(5),
  objectsTrack: z.string().optional(),
  audioDetect: z.string().optional(),
  recordEnabled: z.boolean().default(true),
  recordRetainDays: z.number().int().min(1).max(365).default(7),
  snapshotsEnabled: z.boolean().default(true),
  notifyEnabled: z.boolean().default(true),
  notifyCooldownSec: z.number().int().min(0).max(3600).default(30),
  motionThreshold: z.number().int().min(1).max(255).default(30),
  motionMask: z.string().nullable().optional(),
  sortOrder: z.number().int().min(0).default(0),
});

export async function GET() {
  const cameras = await prisma.camera.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { zones: true },
  });
  return NextResponse.json(
    cameras.map((cam) => ({
      ...cam,
      hasSubStream: !!cam.rtspSubUrl,
    }))
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const data = createCameraSchema.parse(body);

    const slug = toSlug(data.name);

    // Default objectsTrack for new cameras from global setting
    if (!data.objectsTrack) {
      const objectsRow = await prisma.systemConfig.findUnique({
        where: { key: "enabled_objects" },
      });
      data.objectsTrack = objectsRow
        ? JSON.parse(objectsRow.value).join(",")
        : DEFAULT_ENABLED_OBJECTS.join(",");
    }

    // Default audioDetect for new cameras from global setting
    if (!data.audioDetect) {
      const audioRow = await prisma.systemConfig.findUnique({
        where: { key: "enabled_audio" },
      });
      data.audioDetect = audioRow
        ? JSON.parse(audioRow.value).join(",")
        : DEFAULT_ENABLED_AUDIO.join(",");
    }

    const camera = await prisma.camera.create({
      data: { ...data, slug },
      include: { zones: true },
    });

    // Trigger Frigate config regeneration + go2rtc stream sync
    try {
      const { regenerateFrigateConfig } = await import("@/lib/frigate-config-gen");
      await regenerateFrigateConfig();
    } catch (err) {
      console.error("[Camera] Config push failed after create:", err instanceof Error ? err.message : err);
    }

    const { refreshWarmerCameras } = await import("@/lib/stream-warmer");
    refreshWarmerCameras();

    return NextResponse.json(
      { ...camera, hasSubStream: !!data.rtspSubUrl },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = message.includes("Unique constraint") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
