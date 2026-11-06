import { describe, expect, it } from "vitest";
import { createHash } from "crypto";
import {
  API_KEY_PREFIX,
  digestsEqual,
  generateApiKey,
  hashApiKey,
  keyHint,
} from "./api-key";

describe("generateApiKey", () => {
  it("produces a prefixed key with 256 bits of entropy", () => {
    const key = generateApiKey();
    expect(key.startsWith(API_KEY_PREFIX)).toBe(true);
    // 32 bytes base64url = 43 chars
    expect(key.length).toBe(API_KEY_PREFIX.length + 43);
    // base64url alphabet only — safe to embed in a URL query unencoded
    expect(key.slice(API_KEY_PREFIX.length)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("produces unique keys", () => {
    const keys = new Set(Array.from({ length: 100 }, generateApiKey));
    expect(keys.size).toBe(100);
  });
});

describe("hashApiKey", () => {
  it("is sha256 hex of the key", () => {
    const key = "nvr_test";
    expect(hashApiKey(key)).toBe(
      createHash("sha256").update(key).digest("hex"),
    );
  });

  it("round-trips through digestsEqual", () => {
    const key = generateApiKey();
    const stored = hashApiKey(key);
    expect(digestsEqual(hashApiKey(key), stored)).toBe(true);
  });
});

describe("digestsEqual", () => {
  it("rejects a different key's digest", () => {
    expect(
      digestsEqual(hashApiKey(generateApiKey()), hashApiKey(generateApiKey())),
    ).toBe(false);
  });

  it("rejects length-mismatched digests without throwing", () => {
    expect(digestsEqual("abcd", hashApiKey("x"))).toBe(false);
    expect(digestsEqual("", hashApiKey("x"))).toBe(false);
  });
});

describe("keyHint", () => {
  it("exposes only the first characters", () => {
    const key = generateApiKey();
    const hint = keyHint(key);
    expect(hint.length).toBeLessThan(12);
    expect(key.startsWith(hint.replace("…", ""))).toBe(true);
  });
});
