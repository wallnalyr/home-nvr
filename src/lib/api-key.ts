/**
 * Snapshot API key — lets external devices (wall tablets, countertop hubs)
 * fetch camera snapshots from /api/snapshot/[slug] without a browser session.
 *
 * Security model mirrors AuthSession: the key is an opaque 256-bit random
 * value shown to the admin exactly once at generation time; only its sha256
 * is persisted (in SystemConfig), so a database leak does not leak the key.
 * Verification compares digests with timingSafeEqual. The key grants access
 * to snapshots only — never to the rest of the API (the snapshot route is
 * the single place that accepts it).
 */

import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db";

const KEY_HASH = "snapshot_api_key_hash";
const KEY_META = "snapshot_api_key_meta"; // JSON: { hint, createdAt }

export const API_KEY_PREFIX = "nvr_";

export interface SnapshotKeyMeta {
  hint: string; // first characters of the key, for display ("nvr_a1b2…")
  createdAt: string; // ISO timestamp
}

export function generateApiKey(): string {
  return API_KEY_PREFIX + randomBytes(32).toString("base64url");
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function keyHint(key: string): string {
  return `${key.slice(0, 9)}…`;
}

/** Constant-time comparison of two hex digests. */
export function digestsEqual(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, "hex");
  const b = Buffer.from(bHex, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function getSnapshotKeyMeta(): Promise<SnapshotKeyMeta | null> {
  const row = await prisma.systemConfig.findUnique({
    where: { key: KEY_META },
  });
  if (!row) return null;
  try {
    return JSON.parse(row.value) as SnapshotKeyMeta;
  } catch {
    return null;
  }
}

/**
 * Generate and persist a new snapshot key, replacing any existing one.
 * Returns the plaintext key — the only time it is ever available.
 */
export async function createSnapshotKey(): Promise<
  SnapshotKeyMeta & { key: string }
> {
  const key = generateApiKey();
  const meta: SnapshotKeyMeta = {
    hint: keyHint(key),
    createdAt: new Date().toISOString(),
  };

  await prisma.$transaction([
    prisma.systemConfig.upsert({
      where: { key: KEY_HASH },
      update: { value: hashApiKey(key) },
      create: { key: KEY_HASH, value: hashApiKey(key) },
    }),
    prisma.systemConfig.upsert({
      where: { key: KEY_META },
      update: { value: JSON.stringify(meta) },
      create: { key: KEY_META, value: JSON.stringify(meta) },
    }),
  ]);

  return { key, ...meta };
}

export async function revokeSnapshotKey(): Promise<void> {
  await prisma.systemConfig.deleteMany({
    where: { key: { in: [KEY_HASH, KEY_META] } },
  });
}

/** Check a presented key against the stored hash. False when no key is configured. */
export async function verifySnapshotKey(presented: string): Promise<boolean> {
  if (!presented || presented.length > 256) return false;
  const row = await prisma.systemConfig.findUnique({
    where: { key: KEY_HASH },
  });
  if (!row) return false;
  return digestsEqual(hashApiKey(presented), row.value);
}
