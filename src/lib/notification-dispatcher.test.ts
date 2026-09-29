import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cameraFindFirst: vi.fn(),
  systemConfigFindUnique: vi.fn(),
  subscriptionFindMany: vi.fn(),
  subscriptionDelete: vi.fn(),
  logCreate: vi.fn(),
  sendNotification: vi.fn(),
  getSnapshot: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    camera: { findFirst: mocks.cameraFindFirst },
    systemConfig: { findUnique: mocks.systemConfigFindUnique },
    pushSubscription: {
      findMany: mocks.subscriptionFindMany,
      delete: mocks.subscriptionDelete,
    },
    notificationLog: { create: mocks.logCreate },
  },
}));

vi.mock("@/lib/webpush", () => ({
  webpush: { sendNotification: mocks.sendNotification },
}));

vi.mock("@/lib/frigate-client", () => ({
  getFrigateEventSnapshot: mocks.getSnapshot,
}));

type Dispatcher = typeof import("@/lib/notification-dispatcher");

function makeCamera(overrides: Record<string, unknown> = {}) {
  return {
    id: "cam1",
    name: "Front",
    slug: "front",
    enabled: true,
    notifyEnabled: true,
    notifyCooldownSec: 30,
    objectsTrack: "person,car",
    ...overrides,
  };
}

interface ReviewOverrides {
  type?: "new" | "update" | "end";
  id?: string;
  camera?: string;
  severity?: "alert" | "detection";
  beforeSeverity?: "alert" | "detection" | null;
}

function makeReview({
  type = "new",
  id = "rev1",
  camera = "front",
  severity = "alert",
  beforeSeverity = null,
}: ReviewOverrides = {}) {
  const segment = (sev: string) => ({
    id,
    camera,
    severity: sev,
    start_time: 100,
    end_time: null,
    data: { objects: ["person"], detections: ["det1"] },
  });
  return {
    type,
    before: beforeSeverity ? segment(beforeSeverity) : null,
    after: segment(severity),
  };
}

let dispatcher: Dispatcher;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-28T12:00:00Z"));

  mocks.cameraFindFirst.mockReset().mockResolvedValue(makeCamera());
  mocks.systemConfigFindUnique.mockReset().mockResolvedValue(null);
  mocks.subscriptionFindMany.mockReset().mockResolvedValue([
    { id: "sub1", endpoint: "https://push/1", p256dh: "k", auth: "a", preferences: [] },
  ]);
  mocks.subscriptionDelete.mockReset().mockResolvedValue({});
  mocks.logCreate.mockReset().mockResolvedValue({});
  mocks.sendNotification.mockReset().mockResolvedValue({});
  mocks.getSnapshot.mockReset().mockResolvedValue({ ok: false });

  // Fresh module per test so review dedup / cooldown maps start empty
  vi.resetModules();
  dispatcher = await import("@/lib/notification-dispatcher");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("handleFrigateEvent severity gating", () => {
  it("sends a push for an alert-severity new review", async () => {
    await dispatcher.handleFrigateEvent(makeReview());
    expect(mocks.sendNotification).toHaveBeenCalledTimes(1);
    expect(mocks.logCreate).toHaveBeenCalledTimes(1);
  });

  it("still notifies detection-severity new reviews for tracked labels (pre-promotion Frigate config)", async () => {
    // Until the regenerated config (which promotes tracked labels to alert
    // labels) reaches Frigate, tracked labels like cat/dog arrive with
    // detection severity — they must keep notifying like they did on main.
    await dispatcher.handleFrigateEvent(makeReview({ severity: "detection" }));
    expect(mocks.sendNotification).toHaveBeenCalledTimes(1);
  });

  it("skips reviews containing only untracked labels", async () => {
    const review = makeReview();
    review.after.data.objects = ["bird"];
    await dispatcher.handleFrigateEvent(review);
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it("matches sub-labeled objects to their base tracked label", async () => {
    const review = makeReview();
    review.after.data.objects = ["person-verified"];
    await dispatcher.handleFrigateEvent(review);
    expect(mocks.sendNotification).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(mocks.sendNotification.mock.calls[0][1]);
    expect(payload.title).toBe("Person on Front");
  });

  it("ignores updates that stay at detection severity", async () => {
    await dispatcher.handleFrigateEvent(
      makeReview({
        type: "update",
        severity: "detection",
        beforeSeverity: "detection",
      }),
    );
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it("notifies when an update escalates detection to alert", async () => {
    await dispatcher.handleFrigateEvent(
      makeReview({ type: "update", beforeSeverity: "detection" }),
    );
    expect(mocks.sendNotification).toHaveBeenCalledTimes(1);
  });

  it("lets an escalation retry a review whose new message was filtered", async () => {
    // `new` arrives with only an untracked label — filtered, but the review
    // must not be permanently blackholed: when a person joins and Frigate
    // escalates it to alert, the notification must go out.
    const first = makeReview({ severity: "detection" });
    first.after.data.objects = ["bird"];
    await dispatcher.handleFrigateEvent(first);
    expect(mocks.sendNotification).not.toHaveBeenCalled();

    const escalation = makeReview({
      type: "update",
      beforeSeverity: "detection",
    });
    escalation.after.data.objects = ["bird", "person"];
    await dispatcher.handleFrigateEvent(escalation);
    expect(mocks.sendNotification).toHaveBeenCalledTimes(1);
  });

  it("ignores updates of reviews that were already alerts", async () => {
    await dispatcher.handleFrigateEvent(
      makeReview({ type: "update", beforeSeverity: "alert" }),
    );
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it("ignores end messages", async () => {
    await dispatcher.handleFrigateEvent(makeReview({ type: "end" }));
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it("notifies at most once per review ID even without a cooldown", async () => {
    mocks.cameraFindFirst.mockResolvedValue(makeCamera({ notifyCooldownSec: 0 }));
    await dispatcher.handleFrigateEvent(makeReview());
    await dispatcher.handleFrigateEvent(makeReview());
    expect(mocks.sendNotification).toHaveBeenCalledTimes(1);
  });
});

describe("handleFrigateEvent per-camera cooldown", () => {
  it("suppresses a second review inside the cooldown window", async () => {
    await dispatcher.handleFrigateEvent(makeReview({ id: "rev1" }));
    vi.advanceTimersByTime(10_000);
    await dispatcher.handleFrigateEvent(makeReview({ id: "rev2" }));
    expect(mocks.sendNotification).toHaveBeenCalledTimes(1);
  });

  it("notifies again once the cooldown expires", async () => {
    await dispatcher.handleFrigateEvent(makeReview({ id: "rev1" }));
    vi.advanceTimersByTime(31_000);
    await dispatcher.handleFrigateEvent(makeReview({ id: "rev2" }));
    expect(mocks.sendNotification).toHaveBeenCalledTimes(2);
  });

  it("does not throttle across different cameras", async () => {
    mocks.cameraFindFirst.mockImplementation(
      async ({ where }: { where: { slug: string } }) =>
        makeCamera({ slug: where.slug, name: where.slug }),
    );
    await dispatcher.handleFrigateEvent(makeReview({ id: "rev1", camera: "front" }));
    await dispatcher.handleFrigateEvent(makeReview({ id: "rev2", camera: "back" }));
    expect(mocks.sendNotification).toHaveBeenCalledTimes(2);
  });

  it("does not consume the cooldown when every send fails", async () => {
    mocks.sendNotification.mockRejectedValue(new Error("ECONNRESET"));
    await dispatcher.handleFrigateEvent(makeReview({ id: "rev1" }));
    mocks.sendNotification.mockReset().mockResolvedValue({});
    vi.advanceTimersByTime(5_000);
    await dispatcher.handleFrigateEvent(makeReview({ id: "rev2" }));
    expect(mocks.sendNotification).toHaveBeenCalledTimes(1);
  });

  it("disables the throttle when notifyCooldownSec is 0", async () => {
    mocks.cameraFindFirst.mockResolvedValue(makeCamera({ notifyCooldownSec: 0 }));
    await dispatcher.handleFrigateEvent(makeReview({ id: "rev1" }));
    await dispatcher.handleFrigateEvent(makeReview({ id: "rev2" }));
    expect(mocks.sendNotification).toHaveBeenCalledTimes(2);
  });
});
