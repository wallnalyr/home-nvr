import { describe, expect, it } from "vitest";
import {
  isValidMaskPayload,
  MAX_POLYGON_POINTS,
  MAX_POLYGONS,
  parsePolygons,
  polygonToCoordinates,
  polygonsToNamedMasks,
  repairMaskPayload,
  simplifyPolygon,
  zoneCoordinatesToString,
  type NormalizedPolygon,
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

  it("caps polygon count and simplifies oversize polygons from legacy rows", () => {
    const oversized = JSON.stringify([
      ...Array(MAX_POLYGONS + 10).fill(SQUARE),
    ]);
    expect(parsePolygons(oversized)).toHaveLength(MAX_POLYGONS);

    // An over-point-limit polygon is simplified (kept active), not dropped
    const circle = Array.from({ length: 1000 }, (_, i) => {
      const a = (2 * Math.PI * i) / 1000;
      return [0.5 + 0.3 * Math.cos(a), 0.5 + 0.3 * Math.sin(a)];
    });
    const parsed = parsePolygons(JSON.stringify([circle, SQUARE]));
    expect(parsed).toHaveLength(2);
    expect(parsed[0].length).toBeGreaterThanOrEqual(3);
    expect(parsed[0].length).toBeLessThanOrEqual(MAX_POLYGON_POINTS);
    expect(parsed[1]).toEqual(SQUARE);
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

describe("simplifyPolygon", () => {
  it("leaves small polygons untouched", () => {
    expect(simplifyPolygon(SQUARE)).toBe(SQUARE);
  });

  it("reduces an oversize polygon within bounds while keeping its shape", () => {
    const circle: NormalizedPolygon = Array.from({ length: 2000 }, (_, i) => {
      const a = (2 * Math.PI * i) / 2000;
      return [0.5 + 0.4 * Math.cos(a), 0.5 + 0.4 * Math.sin(a)];
    });
    const simplified = simplifyPolygon(circle);
    expect(simplified.length).toBeGreaterThanOrEqual(3);
    expect(simplified.length).toBeLessThanOrEqual(MAX_POLYGON_POINTS);
    // Every kept vertex is an original vertex, still on the circle
    for (const [x, y] of simplified) {
      const r = Math.hypot(x - 0.5, y - 0.5);
      expect(Math.abs(r - 0.4)).toBeLessThan(0.001);
    }
  });

  it("handles degenerate repeated-point polygons", () => {
    const degenerate: NormalizedPolygon = Array.from(
      { length: 500 },
      () => [0.5, 0.5],
    );
    const simplified = simplifyPolygon(degenerate);
    expect(simplified.length).toBeGreaterThanOrEqual(3);
    expect(simplified.length).toBeLessThanOrEqual(MAX_POLYGON_POINTS);
  });
});

describe("repairMaskPayload", () => {
  it("passes valid payloads through unchanged", () => {
    const valid = JSON.stringify([SQUARE]);
    expect(repairMaskPayload(valid)).toBe(valid);
  });

  it("repairs an oversize legacy polygon into a valid payload", () => {
    const big = JSON.stringify([
      Array.from({ length: 600 }, (_, i) => {
        const a = (2 * Math.PI * i) / 600;
        return [0.5 + 0.2 * Math.cos(a), 0.5 + 0.2 * Math.sin(a)];
      }),
    ]);
    const repaired = repairMaskPayload(big);
    expect(repaired).not.toBeNull();
    expect(isValidMaskPayload(repaired!)).toBe(true);
  });

  it("returns null for unsalvageable values", () => {
    expect(repairMaskPayload(null)).toBeNull();
    expect(repairMaskPayload("not json")).toBeNull();
    expect(repairMaskPayload("[[[0.1,0.1],[0.2,0.2]]]")).toBeNull();
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
