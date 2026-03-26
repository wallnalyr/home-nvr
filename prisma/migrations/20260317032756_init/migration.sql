-- CreateTable
CREATE TABLE "Camera" (
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

-- CreateTable
CREATE TABLE "Zone" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "coordinates" TEXT NOT NULL,
    "objects" TEXT NOT NULL DEFAULT 'person,car',
    "cameraId" TEXT NOT NULL,
    CONSTRAINT "Zone_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subscriptionId" TEXT NOT NULL,
    "camera" TEXT NOT NULL DEFAULT '*',
    "objectType" TEXT NOT NULL DEFAULT '*',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "NotificationPreference_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "PushSubscription" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "camera" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "snapshotUrl" TEXT
);

-- CreateTable
CREATE TABLE "SystemConfig" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Camera_name_key" ON "Camera"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Camera_slug_key" ON "Camera"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Zone_cameraId_name_key" ON "Zone"("cameraId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_subscriptionId_camera_objectType_key" ON "NotificationPreference"("subscriptionId", "camera", "objectType");
