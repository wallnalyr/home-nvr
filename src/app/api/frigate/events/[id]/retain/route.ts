import { NextRequest, NextResponse } from "next/server";
import { toggleFrigateEventRetain } from "@/lib/frigate-client";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    await toggleFrigateEventRetain(id, true);
    return NextResponse.json({ success: true, retain_indefinitely: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save event";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    await toggleFrigateEventRetain(id, false);
    return NextResponse.json({ success: true, retain_indefinitely: false });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to unsave event";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
