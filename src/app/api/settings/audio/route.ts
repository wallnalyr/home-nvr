import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AUDIO_LABELS, DEFAULT_ENABLED_AUDIO } from "@/lib/objects";
import { z } from "zod/v4";

const SETTINGS_KEY = "enabled_audio";

export async function GET() {
  const row = await prisma.systemConfig.findUnique({
    where: { key: SETTINGS_KEY },
  });

  const enabledAudio: string[] = row
    ? JSON.parse(row.value)
    : DEFAULT_ENABLED_AUDIO;

  return NextResponse.json({ enabledAudio });
}

const updateSchema = z.object({
  enabledAudio: z
    .array(z.string())
    .refine(
      (ids) => ids.every((id) => AUDIO_LABELS.some((a) => a.id === id)),
      "Unknown audio label"
    ),
});

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { enabledAudio } = updateSchema.parse(body);

    // Read previous global setting to compute diff
    const prevRow = await prisma.systemConfig.findUnique({
      where: { key: SETTINGS_KEY },
    });
    const prevEnabled: string[] = prevRow
      ? JSON.parse(prevRow.value)
      : DEFAULT_ENABLED_AUDIO;

    const added = enabledAudio.filter((a) => !prevEnabled.includes(a));
    const removed = prevEnabled.filter((a) => !enabledAudio.includes(a));

    // Save global setting (always upsert, even for empty arrays)
    await prisma.systemConfig.upsert({
      where: { key: SETTINGS_KEY },
      update: { value: JSON.stringify(enabledAudio) },
      create: { key: SETTINGS_KEY, value: JSON.stringify(enabledAudio) },
    });

    // Sync to all cameras: add newly enabled labels, remove disabled ones
    if (added.length > 0 || removed.length > 0) {
      const cameras = await prisma.camera.findMany({
        select: { id: true, audioDetect: true },
      });

      for (const cam of cameras) {
        const labels = cam.audioDetect
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean);

        let changed = false;

        // Add newly enabled labels
        for (const a of added) {
          if (!labels.includes(a)) {
            labels.push(a);
            changed = true;
          }
        }

        // Remove disabled labels
        const filtered = labels.filter((a) => !removed.includes(a));
        if (filtered.length !== labels.length) changed = true;

        if (changed) {
          await prisma.camera.update({
            where: { id: cam.id },
            data: { audioDetect: filtered.join(",") },
          });
        }
      }
    }

    // Push updated config to Frigate so audio detection takes effect
    if (added.length > 0 || removed.length > 0) {
      try {
        const { regenerateFrigateConfig } = await import("@/lib/frigate-config-gen");
        await regenerateFrigateConfig();
      } catch (err) {
        console.error("[Audio] Config push failed:", err instanceof Error ? err.message : err);
      }
    }

    return NextResponse.json({ enabledAudio });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Failed to save settings" },
      { status: 500 }
    );
  }
}
