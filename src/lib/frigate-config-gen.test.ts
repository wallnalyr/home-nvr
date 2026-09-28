import { beforeEach, describe, expect, it, vi } from "vitest";
import yaml from "js-yaml";

const mocks = vi.hoisted(() => ({
  cameraFindMany: vi.fn(),
  systemConfigFindUnique: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    camera: { findMany: mocks.cameraFindMany },
    systemConfig: { findUnique: mocks.systemConfigFindUnique },
  },
}));

vi.mock("@/lib/hardware-detect", () => ({
  detectGPU: () => ({ enabled: false, type: "none", vramMB: 0 }),
  detectCoral: () => ({ enabled: false, device: "" }),
  resolveDetectorType: () => "cpu",
}));

import { generateFrigateConfig } from "@/lib/frigate-config-gen";

const SQUARE = [
  [0.1, 0.1],
  [0.9, 0.1],
  [0.9, 0.5],
  [0.1, 0.5],
];

function makeCamera(overrides: Record<string, unknown> = {}) {
  return {
    id: "cam1",
    name: "Front",
    slug: "front",
    rtspUrl: "rtsp://cam/main",
    rtspSubUrl: "rtsp://cam/sub",
    enabled: true,
    detectEnabled: true,
    detectWidth: 1280,
    detectHeight: 720,
    detectFps: 5,
    objectsTrack: "person,car",
    audioDetect: "",
    recordEnabled: true,
    recordRetainDays: 7,
    snapshotsEnabled: true,
    notifyEnabled: true,
    notifyCooldownSec: 30,
    motionThreshold: 30,
    motionMask: JSON.stringify([SQUARE]),
    sortOrder: 0,
    zones: [],
    ...overrides,
  };
}

interface GeneratedCamera {
  motion: { threshold: number; mask?: Record<string, unknown> };
  objects: { track: string[]; mask?: Record<string, unknown> };
  review?: { alerts: { labels: string[] } };
  zones?: Record<string, { coordinates: string; objects: string[] }>;
  record: { continuous: { days: number } };
}

async function generate(camera: Record<string, unknown>) {
  mocks.cameraFindMany.mockResolvedValue([camera]);
  mocks.systemConfigFindUnique.mockResolvedValue(null);
  const config = yaml.load(await generateFrigateConfig()) as {
    version: string;
    cameras: Record<string, GeneratedCamera>;
  };
  return config;
}

beforeEach(() => {
  mocks.cameraFindMany.mockReset();
  mocks.systemConfigFindUnique.mockReset();
});

describe("generateFrigateConfig", () => {
  it("stamps the 0.18 config version", async () => {
    const config = await generate(makeCamera());
    expect(config.version).toBe("0.18-0");
  });

  it("emits exclusion zones as named motion AND object masks", async () => {
    const { cameras } = await generate(makeCamera());
    const expected = {
      exclusion_zone_1: {
        friendly_name: "Exclusion Zone 1",
        enabled: true,
        coordinates: "0.1,0.1,0.9,0.1,0.9,0.5,0.1,0.5",
      },
    };
    expect(cameras.front.motion.mask).toEqual(expected);
    expect(cameras.front.objects.mask).toEqual(expected);
  });

  it("promotes all tracked labels to review alert labels", async () => {
    const { cameras } = await generate(makeCamera());
    expect(cameras.front.review).toEqual({
      alerts: { labels: ["person", "car"] },
    });
  });

  it("omits masks entirely when no exclusion zones are drawn", async () => {
    const { cameras } = await generate(makeCamera({ motionMask: null }));
    expect(cameras.front.motion.mask).toBeUndefined();
    expect(cameras.front.objects.mask).toBeUndefined();
    expect(cameras.front.motion.threshold).toBe(30);
  });

  it("ignores malformed exclusion zone JSON", async () => {
    const { cameras } = await generate(makeCamera({ motionMask: "not json" }));
    expect(cameras.front.motion.mask).toBeUndefined();
    expect(cameras.front.objects.mask).toBeUndefined();
  });

  it("converts zone coordinates to Frigate's string format", async () => {
    const { cameras } = await generate(
      makeCamera({
        zones: [
          {
            id: "z1",
            name: "driveway",
            coordinates: JSON.stringify(SQUARE),
            objects: "person,car",
            cameraId: "cam1",
          },
          {
            id: "z2",
            name: "broken",
            coordinates: "[[0.1,0.2]]",
            objects: "person",
            cameraId: "cam1",
          },
        ],
      }),
    );
    expect(cameras.front.zones).toEqual({
      driveway: {
        coordinates: "0.1,0.1,0.9,0.1,0.9,0.5,0.1,0.5",
        objects: ["person", "car"],
      },
    });
  });

  it("keeps 0.17+/0.18 record.continuous syntax", async () => {
    const { cameras } = await generate(makeCamera());
    expect(cameras.front.record.continuous.days).toBe(7);
  });
});
