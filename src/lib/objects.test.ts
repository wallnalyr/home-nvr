import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AUDIO_LABELS,
  DEFAULT_ENABLED_AUDIO,
  LEGACY_AUDIO_LABEL_MAP,
} from "@/lib/objects";

// Verbatim copy of Frigate v0.18.0's audio-labelmap.txt (one Frigate label
// per YAMNet class line). Every label id the app offers MUST exist here —
// "scream" and "car_horn" never did, which made those detections
// impossible and audio look entirely broken.
const FRIGATE_AUDIO_LABELS = new Set(
  readFileSync(
    fileURLToPath(new URL("./frigate-audio-labelmap.fixture.txt", import.meta.url)),
    "utf8",
  )
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean),
);

describe("AUDIO_LABELS Frigate vocabulary conformance", () => {
  it("every offered audio label id exists in Frigate's audio labelmap", () => {
    const unknown = AUDIO_LABELS.map((a) => a.id).filter(
      (id) => !FRIGATE_AUDIO_LABELS.has(id),
    );
    expect(unknown).toEqual([]);
  });

  it("default enabled audio ids are all valid and offered", () => {
    const offered = new Set(AUDIO_LABELS.map((a) => a.id));
    for (const id of DEFAULT_ENABLED_AUDIO) {
      expect(FRIGATE_AUDIO_LABELS.has(id), id).toBe(true);
      expect(offered.has(id), id).toBe(true);
    }
  });

  it("legacy renames map dead ids to valid Frigate labels", () => {
    for (const [legacy, current] of Object.entries(LEGACY_AUDIO_LABEL_MAP)) {
      expect(FRIGATE_AUDIO_LABELS.has(legacy), legacy).toBe(false);
      expect(FRIGATE_AUDIO_LABELS.has(current), current).toBe(true);
    }
  });
});
