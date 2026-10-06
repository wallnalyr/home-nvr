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
  // Stable identifier of the drift CONTENT (coordinate keys, not just
  // counts) — distinct drifts must never share a signature or the heal
  // guard would suppress healing a genuinely new divergence.
  signature?: string;
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
    // A mask toggled off in Frigate's own UI is not suppressing anything —
    // it must count as absent so the divergence surfaces as drift
    if ((mask as { enabled?: boolean })?.enabled === false) continue;
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
    const report: DriftReport = {
      status: "unreachable",
      checkedAt,
      mismatches: [
        `Frigate API unreachable: ${err instanceof Error ? err.message : err}`,
      ],
    };
    state().report = report;
    return report;
  }

  const runningCameras =
    (running as { cameras?: Record<string, unknown> })?.cameras ?? {};
  const cameras = await prisma.camera.findMany({ where: { enabled: true } });
  const mismatches: string[] = [];
  const signatureParts: string[] = [];

  for (const camera of cameras) {
    const camConfig = runningCameras[camera.slug];
    if (!camConfig) {
      mismatches.push(
        `Camera "${camera.name}" is missing from Frigate's running config`,
      );
      signatureParts.push(`${camera.slug}:missing`);
      continue;
    }
    const expected = parsePolygons(camera.motionMask)
      .map(polygonToCoordinates)
      .map(coordsKey)
      .sort();
    const actual = runningMaskKeys(camConfig);
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      mismatches.push(
        expected.length === actual.length
          ? `Camera "${camera.name}": ${expected.length} exclusion zone(s) are running in Frigate with different coordinates than the app — zone edits have not been applied`
          : `Camera "${camera.name}": Frigate is running ${actual.length} exclusion zone(s) but the app has ${expected.length} — zone edits have not been applied`,
      );
      signatureParts.push(
        `${camera.slug}:${expected.join(";")}~${actual.join(";")}`,
      );
    }
  }

  const report: DriftReport = {
    status: mismatches.length > 0 ? "drift" : "ok",
    checkedAt,
    mismatches,
    ...(signatureParts.length > 0
      ? { signature: signatureParts.join("|") }
      : {}),
  };
  state().report = report;
  return report;
}

const DRIFT_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const DRIFT_FIRST_CHECK_DELAY_MS = 90 * 1000;
// A successful push restarts Frigate; its API can briefly echo the OLD
// config while coming back up. Checking inside that window would report
// spurious drift and trigger a pointless second restart.
const RECENT_PUSH_QUIET_MS = 2 * 60 * 1000;

function pushActivity(): { inFlight: boolean; lastPushAt: number } {
  const g = globalThis as unknown as {
    __frigateConfigInFlight?: Promise<void> | null;
    __frigateLastPushAt?: number;
  };
  return {
    inFlight: !!g.__frigateConfigInFlight,
    lastPushAt: g.__frigateLastPushAt ?? 0,
  };
}

async function runDriftCycle(): Promise<void> {
  const { inFlight, lastPushAt } = pushActivity();
  if (inFlight || Date.now() - lastPushAt < RECENT_PUSH_QUIET_MS) {
    return;
  }

  const report = await checkConfigDrift();
  if (report.status !== "drift") {
    if (report.status === "ok") state().lastHealedSignature = null;
    return;
  }

  console.warn(
    `[ConfigDrift] Frigate's running config does not match the app:\n  ${report.mismatches.join("\n  ")}`,
  );

  const signature = report.signature ?? report.mismatches.join("|");
  if (state().lastHealedSignature === signature) {
    // A SUCCESSFUL push already ran for this exact drift and it persisted —
    // pushing again would just restart Frigate in a loop. Leave the
    // warning visible. (Failed pushes never set the signature, so
    // transient failures keep being retried every cycle.)
    return;
  }
  console.warn("[ConfigDrift] Re-pushing config to Frigate to heal drift");
  try {
    const { regenerateFrigateConfig } = await import(
      "@/lib/frigate-config-gen"
    );
    await regenerateFrigateConfig();
    state().lastHealedSignature = signature;
  } catch (err) {
    console.error(
      "[ConfigDrift] Healing push failed (will retry next cycle):",
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
