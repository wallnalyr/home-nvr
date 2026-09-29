import { describe, expect, it } from "vitest";
import {
  isValidMaskPayload,
  MAX_POLYGON_POINTS,
  MAX_POLYGONS,
  parsePolygons,
  polygonToCoordinates,
  polygonsToNamedMasks,
  zoneCoordinatesToString,
} from "@/lib/frigate-masks";

const SQUARE: [number, number][] = [
  [0.1, 0.1],
  [0.9, 0.1],
  [0.9, 0.5],
  [0.1, 0.5],
];

describe("parsePolygons", () => {
  it("parses stored polygon JSON", () => {
    const stored = JSON.stringify([SQUARE, SQUARE]);
    expect(parsePolygons(stored)).toEqual([SQUARE, SQUARE]);
  });

  it("returns empty for null, invalid JSON, and non-arrays", () => {
    expect(parsePolygons(null)).toEqual([]);
    expect(parsePolygons("not json")).toEqual([]);
    expect(parsePolygons('{"a":1}')).toEqual([]);
    expect(parsePolygons('"[]"')).toEqual([]);
  });

  it("drops polygons with fewer than 3 points", () => {
    const stored = JSON.stringify([[[0.1, 0.1], [0.9, 0.9]], SQUARE]);
    expect(parsePolygons(stored)).toEqual([SQUARE]);
  });

  it("caps polygon and point counts from legacy oversized rows", () => {
    const oversized = JSON.stringify([
      ...Array(MAX_POLYGONS + 10).fill(SQUARE),
    ]);
    expect(parsePolygons(oversized)).toHaveLength(MAX_POLYGONS);
    const longPolygon = [
      Array.from({ length: MAX_POLYGON_POINTS + 1 }, (_, i) => [
        (i % 100) / 100,
        0.5,
      ]),
      SQUARE,
    ];
    expect(parsePolygons(JSON.stringify(longPolygon))).toEqual([SQUARE]);
  });

  it("drops polygons containing malformed points", () => {
    const stored = JSON.stringify([
      [[0.1, 0.1], ["x", 0.2], [0.3, 0.3]],
      [[0.1, 0.1], [0.2], [0.3, 0.3]],
      [[0.1, 0.1], null, [0.3, 0.3]],
      SQUARE,
    ]);
    expect(parsePolygons(stored)).toEqual([SQUARE]);
  });
});

describe("polygonToCoordinates", () => {
  it("emits relative x1,y1,x2,y2 with 3-decimal rounding", () => {
    expect(polygonToCoordinates(SQUARE)).toBe(
      "0.1,0.1,0.9,0.1,0.9,0.5,0.1,0.5",
    );
    expect(polygonToCoordinates([[0.12345, 0.98765], [0.5, 0.5], [0, 1]])).toBe(
      "0.123,0.988,0.5,0.5,0,1",
    );
  });

  it("clamps out-of-range values into 0-1", () => {
    expect(polygonToCoordinates([[-0.5, 1.7], [0.5, 0.5], [2, -1]])).toBe(
      "0,1,0.5,0.5,1,0",
    );
  });

  it("never emits tokens Frigate would misread as legacy pixel coords", () => {
    // Frigate flags a config as legacy pixel-space when any token compares
    // lexicographically greater than "1.0" — including exponent notation
    // like "5e-7", which would then crash int() parsing.
    const coords = polygonToCoordinates([
      [5e-7, 1],
      [0.9999, 1e-9],
      [1, 0],
    ]);
    for (const token of coords.split(",")) {
      expect(token > "1.0").toBe(false);
    }
    expect(coords).toBe("0,1,1,0,1,0");
  });
});

describe("polygonsToNamedMasks", () => {
  it("builds Frigate 0.18 named-mask dicts", () => {
    expect(polygonsToNamedMasks([SQUARE, SQUARE])).toEqual({
      exclusion_zone_1: {
        friendly_name: "Exclusion Zone 1",
        enabled: true,
        coordinates: "0.1,0.1,0.9,0.1,0.9,0.5,0.1,0.5",
      },
      exclusion_zone_2: {
        friendly_name: "Exclusion Zone 2",
        enabled: true,
        coordinates: "0.1,0.1,0.9,0.1,0.9,0.5,0.1,0.5",
      },
    });
    expect(polygonsToNamedMasks([])).toEqual({});
  });
});

describe("isValidMaskPayload", () => {
  it("accepts what the editor produces", () => {
    expect(isValidMaskPayload(JSON.stringify([SQUARE, SQUARE]))).toBe(true);
    expect(isValidMaskPayload("[]")).toBe(true);
  });

  it("rejects malformed payloads", () => {
    expect(isValidMaskPayload("not json")).toBe(false);
    expect(isValidMaskPayload('{"a":1}')).toBe(false);
    expect(isValidMaskPayload("[[[0.1,0.1],[0.2,0.2]]]")).toBe(false);
    expect(isValidMaskPayload('[[[0.1,"x"],[0.2,0.2],[0.3,0.3]]]')).toBe(false);
  });

  it("rejects payloads over the polygon and point bounds", () => {
    const tooManyPolygons = Array(MAX_POLYGONS + 1).fill(SQUARE);
    expect(isValidMaskPayload(JSON.stringify(tooManyPolygons))).toBe(false);
    const tooManyPoints = [
      Array.from({ length: MAX_POLYGON_POINTS + 1 }, (_, i) => [
        (i % 100) / 100,
        0.5,
      ]),
    ];
    expect(isValidMaskPayload(JSON.stringify(tooManyPoints))).toBe(false);
  });
});

describe("zoneCoordinatesToString", () => {
  it("converts a zone polygon to Frigate's coordinate string", () => {
    expect(zoneCoordinatesToString(JSON.stringify(SQUARE))).toBe(
      "0.1,0.1,0.9,0.1,0.9,0.5,0.1,0.5",
    );
  });

  it("returns null for malformed input", () => {
    expect(zoneCoordinatesToString("not json")).toBeNull();
    expect(zoneCoordinatesToString("[[0.1,0.1],[0.2,0.2]]")).toBeNull();
    expect(zoneCoordinatesToString('[[0.1,"a"],[0.2,0.2],[0.3,0.3]]')).toBeNull();
    expect(zoneCoordinatesToString("{}")).toBeNull();
  });
});
