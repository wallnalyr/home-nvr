import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRateLimiter } from "./rate-limit";

describe("createRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("blocks an id only after max recorded attempts", () => {
    const limiter = createRateLimiter({ max: 3, windowMs: 60_000 });
    expect(limiter.isBlocked("a")).toBe(false);
    limiter.record("a");
    limiter.record("a");
    expect(limiter.isBlocked("a")).toBe(false);
    limiter.record("a");
    expect(limiter.isBlocked("a")).toBe(true);
  });

  it("tracks ids independently", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000 });
    limiter.record("a");
    expect(limiter.isBlocked("a")).toBe(true);
    expect(limiter.isBlocked("b")).toBe(false);
  });

  it("unblocks after the window expires", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000 });
    limiter.record("a");
    expect(limiter.isBlocked("a")).toBe(true);
    vi.advanceTimersByTime(60_001);
    expect(limiter.isBlocked("a")).toBe(false);
    // A new attempt starts a fresh window
    limiter.record("a");
    expect(limiter.isBlocked("a")).toBe(true);
  });

  it("clears an id on demand", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000 });
    limiter.record("a");
    limiter.clear("a");
    expect(limiter.isBlocked("a")).toBe(false);
  });
});
