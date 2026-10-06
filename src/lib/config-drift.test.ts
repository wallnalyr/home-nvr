import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cameraFindMany: vi.fn(),
  getFrigateConfig: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { camera: { findMany: mocks.cameraFindMany } },
}));

vi.mock("@/lib/frigate-client", () => ({
  getFrigateConfig: mocks.getFrigateConfig,
}));

import { checkConfigDrift, getDriftReport } from "@/lib/config-drift";

const SQUARE = [
  [0.1, 0.1],
  [0.9, 0.1],
  [0.9, 0.5],
  [0.1, 0.5],
];

function dbCamera(motionMask: string | null) {
  return { id: "c1", name: "Front", slug: "front", motionMask };
}

function frigateCam(maskCoords: string[]) {
  const mask: Record<string, unknown> = {};
  maskCoords.forEach((coordinates, i) => {
    mask[`exclusion_zone_${i + 1}`] = {
      friendly_name: `Exclusion Zone ${i + 1}`,
      enabled: true,
      coordinates,
    };
  });
  return { objects: { mask } };
}

beforeEach(() => {
  mocks.cameraFindMany.mockReset();
  mocks.getFrigateConfig.mockReset();
});

describe("checkConfigDrift", () => {
  it("reports ok when Frigate runs the expected zones", async () => {
    mocks.cameraFindMany.mockResolvedValue([
      dbCamera(JSON.stringify([SQUARE])),
    ]);
    mocks.getFrigateConfig.mockResolvedValue({
      cameras: {
        front: frigateCam(["0.1,0.1,0.9,0.1,0.9,0.5,0.1,0.5"]),
      },
    });
    const report = await checkConfigDrift();
    expect(report.status).toBe("ok");
    expect(report.mismatches).toEqual([]);
  });

  it("tolerates float formatting differences in Frigate's echo", async () => {
    mocks.cameraFindMany.mockResolvedValue([
      dbCamera(JSON.stringify([SQUARE])),
    ]);
    mocks.getFrigateConfig.mockResolvedValue({
      cameras: {
        front: frigateCam(["0.100,0.100,0.900,0.100,0.900,0.500,0.100,0.500"]),
      },
    });
    const report = await checkConfigDrift();
    expect(report.status).toBe("ok");
  });

  it("reports drift when Frigate is missing the zones", async () => {
    mocks.cameraFindMany.mockResolvedValue([
      dbCamera(JSON.stringify([SQUARE])),
    ]);
    mocks.getFrigateConfig.mockResolvedValue({
      cameras: { front: frigateCam([]) },
    });
    const report = await checkConfigDrift();
    expect(report.status).toBe("drift");
    expect(report.mismatches[0]).toContain("Front");
  });

  it("reports drift when Frigate runs stale zones after the app cleared them", async () => {
    mocks.cameraFindMany.mockResolvedValue([dbCamera(null)]);
    mocks.getFrigateConfig.mockResolvedValue({
      cameras: {
        front: frigateCam(["0.1,0.1,0.9,0.1,0.9,0.5,0.1,0.5"]),
      },
    });
    const report = await checkConfigDrift();
    expect(report.status).toBe("drift");
  });

  it("reports a camera missing from Frigate entirely", async () => {
    mocks.cameraFindMany.mockResolvedValue([dbCamera(null)]);
    mocks.getFrigateConfig.mockResolvedValue({ cameras: {} });
    const report = await checkConfigDrift();
    expect(report.status).toBe("drift");
    expect(report.mismatches[0]).toContain("missing");
  });

  it("reports unreachable when the Frigate API fails and persists it", async () => {
    mocks.cameraFindMany.mockResolvedValue([]);
    mocks.getFrigateConfig.mockRejectedValue(new Error("ECONNREFUSED"));
    const report = await checkConfigDrift();
    expect(report.status).toBe("unreachable");
    // health endpoint must see the outage, not a stale earlier report
    expect(getDriftReport()?.status).toBe("unreachable");
  });

  it("flags equal-count coordinate drift with a distinct message and signature", async () => {
    mocks.cameraFindMany.mockResolvedValue([
      dbCamera(JSON.stringify([SQUARE])),
    ]);
    mocks.getFrigateConfig.mockResolvedValue({
      cameras: {
        front: frigateCam(["0.2,0.2,0.8,0.2,0.8,0.6,0.2,0.6"]),
      },
    });
    const report = await checkConfigDrift();
    expect(report.status).toBe("drift");
    expect(report.mismatches[0]).toContain("different coordinates");
    expect(report.signature).toContain("front:");
    expect(report.signature).toContain("0.2,0.2");
  });

  it("treats masks disabled in Frigate's UI as absent", async () => {
    mocks.cameraFindMany.mockResolvedValue([
      dbCamera(JSON.stringify([SQUARE])),
    ]);
    const cam = frigateCam(["0.1,0.1,0.9,0.1,0.9,0.5,0.1,0.5"]);
    (
      cam.objects.mask as Record<string, { enabled?: boolean }>
    ).exclusion_zone_1.enabled = false;
    mocks.getFrigateConfig.mockResolvedValue({ cameras: { front: cam } });
    const report = await checkConfigDrift();
    expect(report.status).toBe("drift");
  });
});
