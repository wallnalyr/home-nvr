import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ALL_OBJECTS } from "@/lib/objects";
import { z } from "zod/v4";

const SETTINGS_KEY = "notification_objects";

// null means "all enabled objects" (the default)
export async function GET() {
  const row = await prisma.systemConfig.findUnique({
    where: { key: SETTINGS_KEY },
  });

  // null = all (default), string[] = specific subset
  const notificationObjects: string[] | null = row
    ? JSON.parse(row.value)
    : null;

  return NextResponse.json({ notificationObjects });
}

const updateSchema = z.object({
  // null means "all", array means specific subset
  notificationObjects: z
    .array(z.string())
    .min(1, "At least one object must be selected")
    .refine(
      (ids) => ids.every((id) => ALL_OBJECTS.some((o) => o.id === id)),
      "Unknown object type"
    )
    .nullable(),
});

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { notificationObjects } = updateSchema.parse(body);

    if (notificationObjects === null) {
      // Delete the key to restore "all" default
      await prisma.systemConfig.deleteMany({
        where: { key: SETTINGS_KEY },
      });
    } else {
      await prisma.systemConfig.upsert({
        where: { key: SETTINGS_KEY },
        update: { value: JSON.stringify(notificationObjects) },
        create: {
          key: SETTINGS_KEY,
          value: JSON.stringify(notificationObjects),
        },
      });
    }

    return NextResponse.json({ notificationObjects });
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
