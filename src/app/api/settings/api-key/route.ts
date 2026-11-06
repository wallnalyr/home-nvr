import { NextResponse } from "next/server";
import {
  createSnapshotKey,
  getSnapshotKeyMeta,
  revokeSnapshotKey,
} from "@/lib/api-key";

// Snapshot API key management. Session-authenticated via middleware like
// every other /api/settings route. The plaintext key is returned exactly
// once, from POST — only hint + createdAt are readable afterwards.

export async function GET() {
  try {
    const meta = await getSnapshotKeyMeta();
    return NextResponse.json(
      meta
        ? { exists: true, hint: meta.hint, createdAt: meta.createdAt }
        : { exists: false },
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to read API key status" },
      { status: 500 },
    );
  }
}

export async function POST() {
  try {
    const { key, hint, createdAt } = await createSnapshotKey();
    return NextResponse.json({ key, hint, createdAt });
  } catch {
    return NextResponse.json(
      { error: "Failed to generate API key" },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  try {
    await revokeSnapshotKey();
    return NextResponse.json({ revoked: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to revoke API key" },
      { status: 500 },
    );
  }
}
