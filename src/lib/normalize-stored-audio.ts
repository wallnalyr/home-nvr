import { prisma } from "@/lib/db";
import { LEGACY_AUDIO_LABEL_MAP, normalizeAudioLabels } from "@/lib/objects";

const LEGACY_IDS = Object.keys(LEGACY_AUDIO_LABEL_MAP);
const AUDIO_SETTINGS_KEYS = ["enabled_audio", "notification_audio"];

/**
 * Idempotent startup self-heal for stored audio label ids. The SQL
 * migration converts everything once at deploy, but it cannot dedupe
 * non-adjacent duplicates (a camera that had both "scream" and "yell"
 * selected non-adjacently), does not touch NotificationPreference rows,
 * and can be undone by a stale pre-deploy client re-saving legacy ids.
 * Running this on every boot keeps stored vocabulary canonical.
 */
export async function normalizeStoredAudioLabels(): Promise<void> {
  const cameras = await prisma.camera.findMany({
    select: { id: true, audioDetect: true },
  });
  for (const cam of cameras) {
    const labels = cam.audioDetect.split(",").map((a) => a.trim()).filter(Boolean);
    const normalized = normalizeAudioLabels(labels).join(",");
    if (normalized !== cam.audioDetect) {
      await prisma.camera.update({
        where: { id: cam.id },
        data: { audioDetect: normalized },
      });
      console.log(
        `[Audio] Normalized audio labels for camera ${cam.id}: "${cam.audioDetect}" -> "${normalized}"`,
      );
    }
  }

  for (const key of AUDIO_SETTINGS_KEYS) {
    const row = await prisma.systemConfig.findUnique({ where: { key } });
    if (!row) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.value);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    const normalized = JSON.stringify(
      normalizeAudioLabels(parsed.filter((v): v is string => typeof v === "string")),
    );
    if (normalized !== row.value) {
      await prisma.systemConfig.update({
        where: { key },
        data: { value: normalized },
      });
      console.log(`[Audio] Normalized ${key}: ${row.value} -> ${normalized}`);
    }
  }

  // Preference rows keyed on a legacy label can never match again — rename
  // them so an explicit mute/allow keeps working. If the target row already
  // exists for the same subscription+camera (unique constraint), the legacy
  // row is redundant and dropped.
  const legacyPrefs = await prisma.notificationPreference.findMany({
    where: { objectType: { in: LEGACY_IDS } },
  });
  for (const pref of legacyPrefs) {
    const objectType = LEGACY_AUDIO_LABEL_MAP[pref.objectType];
    const existing = await prisma.notificationPreference.findUnique({
      where: {
        subscriptionId_camera_objectType: {
          subscriptionId: pref.subscriptionId,
          camera: pref.camera,
          objectType,
        },
      },
    });
    if (existing) {
      await prisma.notificationPreference.delete({ where: { id: pref.id } });
    } else {
      await prisma.notificationPreference.update({
        where: { id: pref.id },
        data: { objectType },
      });
    }
    console.log(
      `[Audio] Migrated notification preference ${pref.id}: ${pref.objectType} -> ${objectType}`,
    );
  }
}
