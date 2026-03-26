import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod/v4";

const SETTINGS_KEY = "notification_audio";

export async function GET() {
  const row = await prisma.systemConfig.findUnique({
    where: { key: SETTINGS_KEY },
  });

  // null = all enabled audio labels trigger notifications (default)
  const notificationAudio: string[] | null = row
    ? JSON.parse(row.value)
    : null;

  return NextResponse.json({ notificationAudio });
}

const updateSchema = z.object({
  notificationAudio: z.array(z.string()).nullable(),
});

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { notificationAudio } = updateSchema.parse(body);

    if (notificationAudio === null) {
      await prisma.systemConfig.deleteMany({
        where: { key: SETTINGS_KEY },
      });
    } else {
      await prisma.systemConfig.upsert({
        where: { key: SETTINGS_KEY },
        update: { value: JSON.stringify(notificationAudio) },
        create: {
          key: SETTINGS_KEY,
          value: JSON.stringify(notificationAudio),
        },
      });
    }

    return NextResponse.json({ notificationAudio });
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
