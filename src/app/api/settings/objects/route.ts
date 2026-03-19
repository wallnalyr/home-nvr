import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ALL_OBJECTS, DEFAULT_ENABLED_OBJECTS } from "@/lib/objects";
import { z } from "zod/v4";

const SETTINGS_KEY = "enabled_objects";

export async function GET() {
  const row = await prisma.systemConfig.findUnique({
    where: { key: SETTINGS_KEY },
  });

  const enabledObjects: string[] = row
    ? JSON.parse(row.value)
    : DEFAULT_ENABLED_OBJECTS;

  return NextResponse.json({ enabledObjects });
}

const updateSchema = z.object({
  enabledObjects: z
    .array(z.string())
    .min(1, "At least one object must be enabled")
    .refine(
      (ids) => ids.every((id) => ALL_OBJECTS.some((o) => o.id === id)),
      "Unknown object type"
    ),
});

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { enabledObjects } = updateSchema.parse(body);

    // Read previous global setting to compute diff
    const prevRow = await prisma.systemConfig.findUnique({
      where: { key: SETTINGS_KEY },
    });
    const prevEnabled: string[] = prevRow
      ? JSON.parse(prevRow.value)
      : DEFAULT_ENABLED_OBJECTS;

    const added = enabledObjects.filter((o) => !prevEnabled.includes(o));
    const removed = prevEnabled.filter((o) => !enabledObjects.includes(o));

    await prisma.systemConfig.upsert({
      where: { key: SETTINGS_KEY },
      update: { value: JSON.stringify(enabledObjects) },
      create: { key: SETTINGS_KEY, value: JSON.stringify(enabledObjects) },
    });

    // Sync to all cameras: add newly enabled objects, remove disabled ones
    if (added.length > 0 || removed.length > 0) {
      const cameras = await prisma.camera.findMany({
        select: { id: true, objectsTrack: true },
      });

      for (const cam of cameras) {
        const objects = cam.objectsTrack
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean);

        let changed = false;

        // Add newly enabled objects
        for (const o of added) {
          if (!objects.includes(o)) {
            objects.push(o);
            changed = true;
          }
        }

        // Remove disabled objects
        const filtered = objects.filter((o) => !removed.includes(o));
        if (filtered.length !== objects.length) changed = true;

        if (changed) {
          await prisma.camera.update({
            where: { id: cam.id },
            data: { objectsTrack: filtered.join(",") },
          });
        }
      }
    }

    return NextResponse.json({ enabledObjects });
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
