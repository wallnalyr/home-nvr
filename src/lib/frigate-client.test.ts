import { afterEach, describe, expect, it, vi } from "vitest";
import { saveFrigateConfig } from "@/lib/frigate-client";

const CONFIG_YAML = `go2rtc:
  streams:
    front:
      - rtsp://admin:pa/ss@192.168.1.10:554/live
    back:
      - rtsp://admin:P@ssw0rd@192.168.1.11:554/live
    side:
      - rtsp://admin:my"pass@192.168.1.12:554/live
`;

function mockFrigate400(body: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve(body),
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saveFrigateConfig error redaction", () => {
  it("redacts credentials containing slashes and @ signs", async () => {
    mockFrigate400(
      'Line 4: invalid input "rtsp://admin:pa/ss@192.168.1.10:554/live" and ' +
        '"rtsp://admin:P@ssw0rd@192.168.1.11:554/live"',
    );
    await expect(saveFrigateConfig(CONFIG_YAML)).rejects.toThrow();
    const err = await saveFrigateConfig(CONFIG_YAML).catch((e: Error) => e);
    expect(err.message).not.toContain("pa/ss");
    expect(err.message).not.toContain("ssw0rd");
    expect(err.message).not.toContain("admin");
    expect(err.message).toContain("***@");
  });

  it("redacts credentials containing quote characters", async () => {
    mockFrigate400(
      'Line 8: invalid input "rtsp://admin:my"pass@192.168.1.12:554/live"',
    );
    const err = await saveFrigateConfig(CONFIG_YAML).catch((e: Error) => e);
    expect(err.message).not.toContain('my"pass');
    expect(err.message).not.toContain("admin");
  });

  it("strips credentials echoed outside a URL shape", async () => {
    mockFrigate400("value admin:pa/ss@ rejected");
    const err = await saveFrigateConfig(CONFIG_YAML).catch((e: Error) => e);
    expect(err.message).not.toContain("pa/ss");
  });

  it("bounds the error body length", async () => {
    mockFrigate400("x".repeat(5000));
    const err = await saveFrigateConfig(CONFIG_YAML).catch((e: Error) => e);
    expect(err.message.length).toBeLessThan(600);
  });
});
