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

// Bounds enforced at the API layer and in the editor. Far above anything a
// real drawing needs, but they keep a hostile payload from ballooning the
// Frigate config (each polygon is emitted twice and object masks are merged
// into every tracked label's filter at runtime). The JSON length bound has
// headroom above the worst case the polygon/point caps allow, so the
// structural caps are always the binding constraint.
export const MAX_MASK_JSON_LENGTH = 524288;
export const MAX_POLYGONS = 64;
export const MAX_POLYGON_POINTS = 256;

/**
 * Strict validation for API input: parseable JSON, bounded polygon/point
 * counts, every polygon well-formed. Stricter than parsePolygons, which
 * leniently drops bad polygons when emitting config from stored data.
 */
export function isValidMaskPayload(value: string): boolean {
  if (value.length > MAX_MASK_JSON_LENGTH) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return false;
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_POLYGONS) return false;
  return parsed.every(
    (poly) =>
      Array.isArray(poly) &&
      poly.length >= 3 &&
      poly.length <= MAX_POLYGON_POINTS &&
      poly.every((point) => parsePoint(point) !== null),
  );
}

function perpendicularDistance(
  p: NormalizedPoint,
  a: NormalizedPoint,
  b: NormalizedPoint,
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq),
  );
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function douglasPeucker(
  points: NormalizedPolygon,
  epsilon: number,
): NormalizedPolygon {
  if (points.length <= 2) return points;
  let maxDist = 0;
  let index = 0;
  const last = points.length - 1;
  for (let i = 1; i < last; i++) {
    const d = perpendicularDistance(points[i], points[0], points[last]);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist <= epsilon) return [points[0], points[last]];
  const left = douglasPeucker(points.slice(0, index + 1), epsilon);
  const right = douglasPeucker(points.slice(index), epsilon);
  return [...left.slice(0, -1), ...right];
}

/**
 * Reduce a polygon to at most maxPoints vertices (Douglas-Peucker with an
 * escalating tolerance, uniform decimation as a last resort). Lets legacy
 * masks traced with hundreds of points — stored before the editor capped
 * drawing — stay active instead of being silently dropped.
 */
export function simplifyPolygon(
  polygon: NormalizedPolygon,
  maxPoints: number = MAX_POLYGON_POINTS,
): NormalizedPolygon {
  if (polygon.length <= maxPoints) return polygon;
  let epsilon = 0.0005;
  let current = polygon;
  for (let i = 0; i < 12 && current.length > maxPoints; i++) {
    current = douglasPeucker(polygon, epsilon);
    epsilon *= 2;
  }
  if (current.length > maxPoints) {
    const step = Math.ceil(current.length / maxPoints);
    current = current.filter((_, i) => i % step === 0);
  }
  return current.length >= 3 ? current : polygon.slice(0, 3);
}

/**
 * Return a payload that passes isValidMaskPayload, repairing legacy
 * oversize masks via simplification; null when nothing is salvageable.
 */
export function repairMaskPayload(value: string | null): string | null {
  if (!value) return null;
  if (isValidMaskPayload(value)) return value;
  const polygons = parsePolygons(value);
  if (polygons.length === 0) return null;
  const serialized = JSON.stringify(polygons);
  return isValidMaskPayload(serialized) ? serialized : null;
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
  // Enforce the polygon-count bound so legacy rows stored before the API
  // validated them can't balloon the generated config; oversize polygons
  // are SIMPLIFIED rather than dropped — silently losing a legacy zone
  // meant alerts kept firing from an area the user believed was excluded.
  for (const poly of parsed.slice(0, MAX_POLYGONS)) {
    if (!Array.isArray(poly) || poly.length < 3) continue;
    const points = poly.map(parsePoint);
    if (points.every((p): p is NormalizedPoint => p !== null)) {
      polygons.push(
        points.length > MAX_POLYGON_POINTS ? simplifyPolygon(points) : points,
      );
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
