import { prisma } from "@/lib/db";
import { getFrigateConfig } from "@/lib/frigate-client";
import { parsePolygons, polygonToCoordinates } from "@/lib/frigate-masks";

// Compares the exclusion zones Frigate is ACTUALLY running against what the
// app's database says they should be. A camera save that fails to push (or
// a Frigate restart from a stale file) previously left the two diverged
// indefinitely with no signal — the user kept getting alerts from areas
// they believed were excluded.

export interface DriftReport {
  status: "ok" | "drift" | "unreachable";
  checkedAt: string;
  mismatches: string[];
}

interface DriftState {
  report: DriftReport | null;
  // Signature of the last drift we already tried to heal — prevents an
  // endless push/restart loop when the regenerated config keeps failing.
  lastHealedSignature: string | null;
  timer: NodeJS.Timeout | null;
}

const globalForDrift = globalThis as unknown as {
  __configDrift?: DriftState;
};

function state(): DriftState {
  if (!globalForDrift.__configDrift) {
    globalForDrift.__configDrift = {
      report: null,
      lastHealedSignature: null,
      timer: null,
    };
  }
  return globalForDrift.__configDrift;
}

export function getDriftReport(): DriftReport | null {
  return state().report;
}

/** Normalize a Frigate coordinate string for float-tolerant comparison. */
function coordsKey(coordinates: string): string {
  return coordinates
    .split(",")
    .map((v) => String(Math.round(parseFloat(v) * 1000) / 1000))
    .join(",");
}

function runningMaskKeys(camConfig: unknown): string[] {
  const masks =
    (camConfig as { objects?: { mask?: Record<string, unknown> } })?.objects
      ?.mask ?? {};
  const keys: string[] = [];
  for (const mask of Object.values(masks)) {
    const coords = (mask as { coordinates?: unknown })?.coordinates;
    if (typeof coords === "string" && coords.length > 0) {
      keys.push(coordsKey(coords));
    } else if (Array.isArray(coords)) {
      // Frigate also accepts list-form coordinates
      keys.push(coordsKey(coords.join(",")));
    }
  }
  return keys.sort();
}

export async function checkConfigDrift(): Promise<DriftReport> {
  const checkedAt = new Date().toISOString();
  let running: unknown;
  try {
    running = await getFrigateConfig();
  } catch (err) {
    return {
      status: "unreachable",
      checkedAt,
      mismatches: [
        `Frigate API unreachable: ${err instanceof Error ? err.message : err}`,
      ],
    };
  }

  const runningCameras =
    (running as { cameras?: Record<string, unknown> })?.cameras ?? {};
  const cameras = await prisma.camera.findMany({ where: { enabled: true } });
  const mismatches: string[] = [];

  for (const camera of cameras) {
    const camConfig = runningCameras[camera.slug];
    if (!camConfig) {
      mismatches.push(
        `Camera "${camera.name}" is missing from Frigate's running config`,
      );
      continue;
    }
    const expected = parsePolygons(camera.motionMask)
      .map(polygonToCoordinates)
      .map(coordsKey)
      .sort();
    const actual = runningMaskKeys(camConfig);
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      mismatches.push(
        `Camera "${camera.name}": Frigate is running ${actual.length} exclusion zone(s) but the app has ${expected.length} — zone edits have not been applied`,
      );
    }
  }

  const report: DriftReport = {
    status: mismatches.length > 0 ? "drift" : "ok",
    checkedAt,
    mismatches,
  };
  state().report = report;
  return report;
}

const DRIFT_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const DRIFT_FIRST_CHECK_DELAY_MS = 90 * 1000;

async function runDriftCycle(): Promise<void> {
  const report = await checkConfigDrift();
  if (report.status !== "drift") {
    if (report.status === "ok") state().lastHealedSignature = null;
    return;
  }

  console.warn(
    `[ConfigDrift] Frigate's running config does not match the app:\n  ${report.mismatches.join("\n  ")}`,
  );

  const signature = report.mismatches.join("|");
  if (state().lastHealedSignature === signature) {
    // Already pushed for this exact drift and it persisted — pushing again
    // would just restart Frigate in a loop. Leave the warning visible.
    return;
  }
  state().lastHealedSignature = signature;
  console.warn("[ConfigDrift] Re-pushing config to Frigate to heal drift");
  try {
    const { regenerateFrigateConfig } = await import(
      "@/lib/frigate-config-gen"
    );
    await regenerateFrigateConfig();
  } catch (err) {
    console.error(
      "[ConfigDrift] Healing push failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

export function startConfigDriftMonitor(): void {
  if (state().timer) return;
  const tick = () => {
    runDriftCycle().catch((err) =>
      console.error("[ConfigDrift] Check failed:", err),
    );
  };
  setTimeout(tick, DRIFT_FIRST_CHECK_DELAY_MS);
  state().timer = setInterval(tick, DRIFT_CHECK_INTERVAL_MS);
}
