import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cameraFindFirst: vi.fn(),
  systemConfigFindUnique: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    camera: { findFirst: mocks.cameraFindFirst },
    systemConfig: { findUnique: mocks.systemConfigFindUnique },
    // Used only by the dispatcher-integration test's notification path
    pushSubscription: {
      findMany: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue({}),
    },
    notificationLog: { create: vi.fn().mockResolvedValue({}) },
  },
}));

type Tracker = typeof import("@/lib/activity-tracker");

function makeCamera(overrides: Record<string, unknown> = {}) {
  return {
    id: "cam1",
    name: "Front",
    slug: "front",
    enabled: true,
    notifyEnabled: true,
    objectsTrack: "person,car",
    ...overrides,
  };
}

function makeReview({
  type = "new",
  id = "rev1",
  camera = "front",
  objects = ["person"],
}: {
  type?: string;
  id?: string;
  camera?: string;
  objects?: string[];
} = {}) {
  return {
    type,
    before: null,
    after: {
      id,
      camera,
      severity: "alert",
      start_time: 100,
      end_time: null,
      data: { objects, detections: ["det1"] },
    },
  };
}

let tracker: Tracker;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-06T12:00:00Z"));
  mocks.cameraFindFirst.mockReset().mockResolvedValue(makeCamera());
  mocks.systemConfigFindUnique.mockReset().mockResolvedValue(null);
  // Fresh module per test so the activity map starts empty
  vi.resetModules();
  tracker = await import("@/lib/activity-tracker");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("trackReviewActivity", () => {
  it("marks a camera active on a new review with an allowed label", async () => {
    await tracker.trackReviewActivity(makeReview());
    const active = tracker.getActiveCameras();
    expect(active.front).toBeDefined();
    expect(active.front.labels).toEqual(["person"]);
  });

  it("ignores reviews whose labels are all filtered out", async () => {
    await tracker.trackReviewActivity(makeReview({ objects: ["bird"] }));
    expect(tracker.getActiveCameras()).toEqual({});
  });

  it("ignores reviews for unknown or notification-muted cameras", async () => {
    mocks.cameraFindFirst.mockResolvedValue(null);
    await tracker.trackReviewActivity(makeReview());
    expect(tracker.getActiveCameras()).toEqual({});
  });

  it("matches sub-labeled objects to their base tracked label", async () => {
    await tracker.trackReviewActivity(
      makeReview({ objects: ["person-verified"] }),
    );
    expect(tracker.getActiveCameras().front.labels).toEqual(["person"]);
  });

  it("stays active through the hold window after end, then clears", async () => {
    await tracker.trackReviewActivity(makeReview());
    await tracker.trackReviewActivity(makeReview({ type: "end" }));
    // Inside the 10s hold
    vi.advanceTimersByTime(9_000);
    expect(tracker.getActiveCameras().front).toBeDefined();
    // Past it
    vi.advanceTimersByTime(2_000);
    expect(tracker.getActiveCameras()).toEqual({});
  });

  it("stays active while any of several overlapping reviews is open", async () => {
    await tracker.trackReviewActivity(makeReview({ id: "rev1" }));
    await tracker.trackReviewActivity(
      makeReview({ id: "rev2", objects: ["car"] }),
    );
    await tracker.trackReviewActivity(makeReview({ type: "end", id: "rev1" }));
    vi.advanceTimersByTime(60_000);
    // rev2 never ended — still active, no hold-window expiry
    expect(tracker.getActiveCameras().front).toBeDefined();
    expect(tracker.getActiveCameras().front.labels.sort()).toEqual([
      "car",
      "person",
    ]);
  });

  it("revives activity when a new review arrives during the hold window", async () => {
    await tracker.trackReviewActivity(makeReview({ id: "rev1" }));
    await tracker.trackReviewActivity(makeReview({ type: "end", id: "rev1" }));
    vi.advanceTimersByTime(5_000);
    await tracker.trackReviewActivity(makeReview({ id: "rev2" }));
    vi.advanceTimersByTime(60_000);
    expect(tracker.getActiveCameras().front).toBeDefined();
  });

  it("expires a review whose end message never arrived", async () => {
    await tracker.trackReviewActivity(makeReview());
    vi.advanceTimersByTime(4 * 60_000);
    expect(tracker.getActiveCameras().front).toBeDefined();
    vi.advanceTimersByTime(2 * 60_000);
    expect(tracker.getActiveCameras()).toEqual({});
  });

  it("ignores end messages for cameras that were never active", async () => {
    await tracker.trackReviewActivity(makeReview({ type: "end" }));
    expect(tracker.getActiveCameras()).toEqual({});
  });

  it("starts a fresh burst after expiry instead of reusing stale labels", async () => {
    await tracker.trackReviewActivity(makeReview({ objects: ["car"] }));
    await tracker.trackReviewActivity(makeReview({ type: "end" }));
    vi.advanceTimersByTime(60_000);
    await tracker.trackReviewActivity(
      makeReview({ id: "rev2", objects: ["person"] }),
    );
    const active = tracker.getActiveCameras();
    expect(active.front.labels).toEqual(["person"]);
    expect(active.front.since).toBe(Date.now());
  });

  it("tracks cameras independently", async () => {
    mocks.cameraFindFirst.mockImplementation(
      async ({ where }: { where: { slug: string } }) =>
        makeCamera({ slug: where.slug }),
    );
    await tracker.trackReviewActivity(makeReview({ camera: "front" }));
    await tracker.trackReviewActivity(
      makeReview({ id: "rev2", camera: "back" }),
    );
    await tracker.trackReviewActivity(
      makeReview({ type: "end", camera: "front" }),
    );
    vi.advanceTimersByTime(11_000);
    const active = tracker.getActiveCameras();
    expect(active.front).toBeUndefined();
    expect(active.back).toBeDefined();
  });

  it("tolerates junk payloads", async () => {
    await tracker.trackReviewActivity(null);
    await tracker.trackReviewActivity("nonsense");
    await tracker.trackReviewActivity({ type: "new", after: null });
    await tracker.trackReviewActivity({ _audio: true, camera: "front" });
    expect(tracker.getActiveCameras()).toEqual({});
  });
});

describe("getActiveCameras label filter", () => {
  it("only counts cameras with a matching label", async () => {
    await tracker.trackReviewActivity(makeReview({ objects: ["car"] }));
    expect(tracker.getActiveCameras(["person"])).toEqual({});
    expect(tracker.getActiveCameras(["car"]).front).toBeDefined();
    expect(tracker.getActiveCameras().front).toBeDefined();
  });
});

describe("dispatcher integration", () => {
  it("records activity from handleFrigateEvent, including end messages", async () => {
    // The dispatcher imports the same tracker module instance; its other
    // dependencies need mocks for the import to work
    vi.doMock("@/lib/webpush", () => ({
      webpush: { sendNotification: vi.fn().mockResolvedValue({}) },
    }));
    vi.doMock("@/lib/frigate-client", () => ({
      getFrigateEventSnapshot: vi.fn().mockResolvedValue({ ok: false }),
      getFrigateEvent: vi.fn().mockResolvedValue({}),
    }));
    const dispatcher = await import("@/lib/notification-dispatcher");

    await dispatcher.handleFrigateEvent(makeReview());
    expect(tracker.getActiveCameras().front).toBeDefined();

    await dispatcher.handleFrigateEvent(makeReview({ type: "end" }));
    vi.advanceTimersByTime(11_000);
    expect(tracker.getActiveCameras()).toEqual({});
  });
});
