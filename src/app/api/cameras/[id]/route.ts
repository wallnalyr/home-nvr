import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod/v4";

const CAMERA_NAME_REGEX = /^[a-zA-Z0-9 _\-'.]+$/;

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s\-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

const updateCameraSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(50)
    .regex(CAMERA_NAME_REGEX, "Letters, numbers, spaces, hyphens, and underscores allowed")
    .optional(),
  rtspUrl: z
    .string()
    .transform((v) => (v === "" ? undefined : v))
    .refine(
      (url) => url === undefined || url.startsWith("rtsp://") || url.startsWith("rtsps://"),
      "Must be an RTSP URL"
    )
    .optional(),
  rtspSubUrl: z
    .string()
    .transform((v) => (v === "" ? undefined : v))
    .refine(
      (url) => url === undefined || url.startsWith("rtsp://") || url.startsWith("rtsps://"),
      "Must be an RTSP URL"
    )
    .nullable()
    .optional(),
  enabled: z.boolean().optional(),
  detectEnabled: z.boolean().optional(),
  detectWidth: z.number().int().min(320).max(3840).optional(),
  detectHeight: z.number().int().min(240).max(2160).optional(),
  detectFps: z.number().int().min(1).max(30).optional(),
  objectsTrack: z.string().optional(),
  audioDetect: z.string().optional(),
  recordEnabled: z.boolean().optional(),
  recordRetainDays: z.number().int().min(1).max(365).optional(),
  snapshotsEnabled: z.boolean().optional(),
  notifyEnabled: z.boolean().optional(),
  notifyCooldownSec: z.number().int().min(0).max(3600).optional(),
  motionThreshold: z.number().int().min(1).max(255).optional(),
  motionMask: z.string().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

function stripRtspUrls<T extends Record<string, unknown>>(camera: T): Omit<T, "rtspUrl" | "rtspSubUrl"> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { rtspUrl: _r, rtspSubUrl: _s, ...safe } = camera;
  return safe as Omit<T, "rtspUrl" | "rtspSubUrl">;
}

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const camera = await prisma.camera.findUnique({
    where: { id },
    include: { zones: true },
  });

  if (!camera) {
    return NextResponse.json({ error: "Camera not found" }, { status: 404 });
  }

  return NextResponse.json({
    ...stripRtspUrls(camera),
    hasSubStream: !!camera.rtspSubUrl,
  });
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const body = await request.json();
    const data = updateCameraSchema.parse(body);

    const updateData: Record<string, unknown> = { ...data };
    if (data.name) {
      updateData.slug = toSlug(data.name);
    }

    const camera = await prisma.camera.update({
      where: { id },
      data: updateData,
      include: { zones: true },
    });

    let configWarning: string | undefined;
    try {
      const { regenerateFrigateConfig } = await import("@/lib/frigate-config-gen");
      await regenerateFrigateConfig();
    } catch (err) {
      configWarning = err instanceof Error ? err.message : "Config push failed";
      console.error("[Camera] Config push failed after update:", configWarning);
    }

    const { refreshWarmerCameras } = await import("@/lib/stream-warmer");
    refreshWarmerCameras();

    const response: Record<string, unknown> = {
      ...stripRtspUrls(camera),
      hasSubStream: !!camera.rtspSubUrl,
    };
    if (configWarning) {
      response.configWarning = configWarning;
    }
    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    await prisma.camera.delete({ where: { id } });

    try {
      const { regenerateFrigateConfig } = await import("@/lib/frigate-config-gen");
      await regenerateFrigateConfig();
    } catch (err) {
      console.error("[Camera] Config push failed after delete:", err instanceof Error ? err.message : err);
    }

    const { refreshWarmerCameras } = await import("@/lib/stream-warmer");
    refreshWarmerCameras();

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete camera" }, { status: 500 });
  }
}
