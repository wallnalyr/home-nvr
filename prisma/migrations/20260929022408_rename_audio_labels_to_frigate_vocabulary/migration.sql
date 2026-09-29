-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Camera" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "rtspUrl" TEXT NOT NULL,
    "rtspSubUrl" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "detectEnabled" BOOLEAN NOT NULL DEFAULT true,
    "detectWidth" INTEGER NOT NULL DEFAULT 1280,
    "detectHeight" INTEGER NOT NULL DEFAULT 720,
    "detectFps" INTEGER NOT NULL DEFAULT 5,
    "objectsTrack" TEXT NOT NULL DEFAULT 'person,car,cat,dog',
    "audioDetect" TEXT NOT NULL DEFAULT 'fire_alarm,yell,bark,glass',
    "recordEnabled" BOOLEAN NOT NULL DEFAULT true,
    "recordRetainDays" INTEGER NOT NULL DEFAULT 7,
    "snapshotsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "notifyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "notifyCooldownSec" INTEGER NOT NULL DEFAULT 30,
    "motionThreshold" INTEGER NOT NULL DEFAULT 30,
    "motionMask" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Camera" ("audioDetect", "createdAt", "detectEnabled", "detectFps", "detectHeight", "detectWidth", "enabled", "id", "motionMask", "motionThreshold", "name", "notifyCooldownSec", "notifyEnabled", "objectsTrack", "recordEnabled", "recordRetainDays", "rtspSubUrl", "rtspUrl", "slug", "snapshotsEnabled", "sortOrder", "updatedAt") SELECT "audioDetect", "createdAt", "detectEnabled", "detectFps", "detectHeight", "detectWidth", "enabled", "id", "motionMask", "motionThreshold", "name", "notifyCooldownSec", "notifyEnabled", "objectsTrack", "recordEnabled", "recordRetainDays", "rtspSubUrl", "rtspUrl", "slug", "snapshotsEnabled", "sortOrder", "updatedAt" FROM "Camera";
DROP TABLE "Camera";
ALTER TABLE "new_Camera" RENAME TO "Camera";
CREATE UNIQUE INDEX "Camera_name_key" ON "Camera"("name");
CREATE UNIQUE INDEX "Camera_slug_key" ON "Camera"("slug");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Convert stored audio label ids that never existed in Frigate's audio
-- labelmap: YAMNet's "Screaming" is "yell" in Frigate, and vehicle horns
-- are "honk". Neither legacy token is a substring of any other label id.
UPDATE "Camera" SET "audioDetect" = REPLACE(REPLACE("audioDetect", 'scream', 'yell'), 'car_horn', 'honk');
-- A camera that had BOTH scream and yell selected becomes "yell,yell";
-- collapse the adjacent duplicate (config generation also dedupes).
UPDATE "Camera" SET "audioDetect" = REPLACE("audioDetect", 'yell,yell', 'yell');

UPDATE "SystemConfig" SET "value" = REPLACE(REPLACE("value", '"scream"', '"yell"'), '"car_horn"', '"honk"')
  WHERE "key" IN ('enabled_audio', 'notification_audio');
UPDATE "SystemConfig" SET "value" = REPLACE("value", '"yell","yell"', '"yell"')
  WHERE "key" IN ('enabled_audio', 'notification_audio');
