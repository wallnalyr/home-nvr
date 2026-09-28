// Conversion helpers between the app's stored exclusion-zone polygons and
// Frigate 0.18 config structures.
//
// Storage format (Camera.motionMask): JSON array of polygons, each polygon an
// array of >= 3 normalized [x, y] points in the 0-1 range.
//
// Frigate 0.18 expects masks as named dicts of
// { friendly_name, enabled, coordinates } where coordinates is a
// comma-separated "x1,y1,x2,y2,..." string of relative (0-1) values.

export type NormalizedPoint = [number, number];
export type NormalizedPolygon = NormalizedPoint[];

export interface FrigateNamedMask {
  friendly_name: string;
  enabled: boolean;
  coordinates: string;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

// Frigate distinguishes legacy pixel coordinates from relative ones by
// comparing tokens against "1.0", so values must be plain 0-1 decimals —
// clamping and 3-decimal rounding (Frigate's own migrator precision) also
// rule out exponent notation like "5e-7", which Frigate would misparse.
function formatCoord(v: number): string {
  return String(Math.round(clamp01(v) * 1000) / 1000);
}

function parsePoint(point: unknown): NormalizedPoint | null {
  if (
    !Array.isArray(point) ||
    point.length !== 2 ||
    typeof point[0] !== "number" ||
    typeof point[1] !== "number" ||
    !Number.isFinite(point[0]) ||
    !Number.isFinite(point[1])
  ) {
    return null;
  }
  return [point[0], point[1]];
}

/** Parse the stored polygon JSON, dropping malformed polygons. */
export function parsePolygons(value: string | null): NormalizedPolygon[] {
  if (!value) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const polygons: NormalizedPolygon[] = [];
  for (const poly of parsed) {
    if (!Array.isArray(poly) || poly.length < 3) continue;
    const points = poly.map(parsePoint);
    if (points.every((p): p is NormalizedPoint => p !== null)) {
      polygons.push(points);
    }
  }
  return polygons;
}

/** "x1,y1,x2,y2,..." relative-coordinate string for one polygon. */
export function polygonToCoordinates(polygon: NormalizedPolygon): string {
  return polygon
    .map(([x, y]) => `${formatCoord(x)},${formatCoord(y)}`)
    .join(",");
}

/**
 * Build a Frigate 0.18 named-mask dict from drawn polygons. The same dict
 * shape is valid for both motion.mask and objects.mask.
 */
export function polygonsToNamedMasks(
  polygons: NormalizedPolygon[],
): Record<string, FrigateNamedMask> {
  const masks: Record<string, FrigateNamedMask> = {};
  polygons.forEach((polygon, i) => {
    masks[`exclusion_zone_${i + 1}`] = {
      friendly_name: `Exclusion Zone ${i + 1}`,
      enabled: true,
      coordinates: polygonToCoordinates(polygon),
    };
  });
  return masks;
}

/**
 * Convert a Zone row's JSON coordinates (single polygon of normalized [x, y]
 * points) to Frigate's coordinate string, or null if malformed.
 */
export function zoneCoordinatesToString(json: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length < 3) return null;
  const points = parsed.map(parsePoint);
  if (!points.every((p): p is NormalizedPoint => p !== null)) return null;
  return polygonToCoordinates(points);
}
