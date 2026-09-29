import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cameraFindMany: vi.fn(),
  cameraUpdate: vi.fn(),
  configFindUnique: vi.fn(),
  configUpdate: vi.fn(),
  prefFindMany: vi.fn(),
  prefFindUnique: vi.fn(),
  prefUpdate: vi.fn(),
  prefDelete: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    camera: { findMany: mocks.cameraFindMany, update: mocks.cameraUpdate },
    systemConfig: {
      findUnique: mocks.configFindUnique,
      update: mocks.configUpdate,
    },
    notificationPreference: {
      findMany: mocks.prefFindMany,
      findUnique: mocks.prefFindUnique,
      update: mocks.prefUpdate,
      delete: mocks.prefDelete,
    },
  },
}));

import { normalizeStoredAudioLabels } from "@/lib/normalize-stored-audio";

beforeEach(() => {
  mocks.cameraFindMany.mockReset().mockResolvedValue([]);
  mocks.cameraUpdate.mockReset().mockResolvedValue({});
  mocks.configFindUnique.mockReset().mockResolvedValue(null);
  mocks.configUpdate.mockReset().mockResolvedValue({});
  mocks.prefFindMany.mockReset().mockResolvedValue([]);
  mocks.prefFindUnique.mockReset().mockResolvedValue(null);
  mocks.prefUpdate.mockReset().mockResolvedValue({});
  mocks.prefDelete.mockReset().mockResolvedValue({});
});

describe("normalizeStoredAudioLabels", () => {
  it("fixes cameras with legacy ids and non-adjacent duplicates", async () => {
    mocks.cameraFindMany.mockResolvedValue([
      { id: "c1", audioDetect: "fire_alarm,smoke_detector,scream,bark,glass,yell" },
      { id: "c2", audioDetect: "fire_alarm,yell,bark,glass" },
    ]);
    await normalizeStoredAudioLabels();
    expect(mocks.cameraUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.cameraUpdate).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { audioDetect: "fire_alarm,smoke_detector,yell,bark,glass" },
    });
  });

  it("fixes SystemConfig rows and skips clean or malformed ones", async () => {
    mocks.configFindUnique.mockImplementation(async ({ where }) =>
      where.key === "enabled_audio"
        ? { key: "enabled_audio", value: '["fire_alarm","scream","car_horn"]' }
        : { key: "notification_audio", value: "not json" },
    );
    await normalizeStoredAudioLabels();
    expect(mocks.configUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.configUpdate).toHaveBeenCalledWith({
      where: { key: "enabled_audio" },
      data: { value: '["fire_alarm","yell","honk"]' },
    });
  });

  it("renames legacy preference rows, dropping them when the target exists", async () => {
    mocks.prefFindMany.mockResolvedValue([
      { id: "p1", subscriptionId: "s1", camera: "*", objectType: "scream" },
      { id: "p2", subscriptionId: "s2", camera: "front", objectType: "car_horn" },
    ]);
    // s1 already has a yell row for the same camera; s2 has no honk row
    mocks.prefFindUnique.mockImplementation(async ({ where }) =>
      where.subscriptionId_camera_objectType.subscriptionId === "s1"
        ? { id: "existing" }
        : null,
    );
    await normalizeStoredAudioLabels();
    expect(mocks.prefDelete).toHaveBeenCalledWith({ where: { id: "p1" } });
    expect(mocks.prefUpdate).toHaveBeenCalledWith({
      where: { id: "p2" },
      data: { objectType: "honk" },
    });
  });

  it("is a no-op on a clean database", async () => {
    mocks.cameraFindMany.mockResolvedValue([
      { id: "c1", audioDetect: "fire_alarm,yell,bark,glass" },
    ]);
    await normalizeStoredAudioLabels();
    expect(mocks.cameraUpdate).not.toHaveBeenCalled();
    expect(mocks.configUpdate).not.toHaveBeenCalled();
    expect(mocks.prefUpdate).not.toHaveBeenCalled();
    expect(mocks.prefDelete).not.toHaveBeenCalled();
  });
});
