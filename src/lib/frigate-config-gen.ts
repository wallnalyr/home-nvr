import yaml from "js-yaml";
import os from "os";
import { prisma } from "@/lib/db";
import {
  detectGPU,
  detectCoral,
  resolveDetectorType,
} from "@/lib/hardware-detect";
import {
  getObjectById,
  DEFAULT_ENABLED_OBJECTS,
  DEFAULT_ENABLED_AUDIO,
} from "@/lib/objects";
import {
  parsePolygons,
  polygonsToNamedMasks,
  zoneCoordinatesToString,
} from "@/lib/frigate-masks";
import { writeFile } from "fs/promises";

// Config schema version emitted below. Stamping it tells Frigate the config
// is already in native 0.18 format, so its startup migrator leaves it alone.
const FRIGATE_CONFIG_VERSION = "0.18-0";

/**
 * Extract WebRTC ICE candidates from the app URL.
 * go2rtc needs to advertise the public hostname so browsers
 * can reach its media port (8555) from outside Docker.
 */
function getWebRTCCandidates(): string[] {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    try {
      const hostname = new URL(appUrl).hostname;
      return [`${hostname}:8555`];
    } catch {
      // Invalid URL, fall through
    }
  }
  return ["stun:8555"];
}

interface FrigateConfig {
  version: string;
  mqtt: { host: string; port: number };
  detectors: Record<string, unknown>;
  model?: { path: string };
  ffmpeg?: Record<string, unknown>;
  go2rtc: {
    streams: Record<string, string[]>;
    webrtc?: Record<string, unknown>;
  };
  cameras: Record<string, unknown>;
  record?: Record<string, unknown>;
  snapshots?: Record<string, unknown>;
}

export async function generateFrigateConfig(): Promise<string> {
  const cameras = await prisma.camera.findMany({
    where: { enabled: true },
    include: { zones: true },
    orderBy: { sortOrder: "asc" },
  });

  // Load globally enabled objects and audio labels
  const objectsRow = await prisma.systemConfig.findUnique({
    where: { key: "enabled_objects" },
  });
  const globalObjects = new Set<string>(
    objectsRow ? JSON.parse(objectsRow.value) : DEFAULT_ENABLED_OBJECTS,
  );

  const audioRow = await prisma.systemConfig.findUnique({
    where: { key: "enabled_audio" },
  });
  const globalAudio = new Set<string>(
    audioRow ? JSON.parse(audioRow.value) : DEFAULT_ENABLED_AUDIO,
  );

  const gpu = detectGPU();
  const coral = detectCoral();
  const detectorType = resolveDetectorType();
  // Build detector config based on resolved type
  let detectors: Record<string, unknown>;
  switch (detectorType) {
    case "edgetpu":
      detectors = {
        coral: {
          type: "edgetpu",
          device: coral.device || "usb",
        },
      };
      break;
    case "onnx":
      // The -tensorrt Frigate image auto-detects NVIDIA GPUs and uses
      // CUDA/TensorRT acceleration under the hood via ONNX runtime.
      detectors = {
        onnx: {
          type: "onnx",
        },
      };
      break;
    default:
      detectors = {
        cpu: {
          type: "cpu",
          num_threads: Math.min(os.cpus().length, 4),
        },
      };
  }

  const config: FrigateConfig = {
    version: FRIGATE_CONFIG_VERSION,
    mqtt: {
      host: "mqtt",
      port: 1883,
    },
    detectors,
    go2rtc: {
      streams: {},
      webrtc: {
        candidates: getWebRTCCandidates(),
      },
    },
    cameras: {},
  };

  // Frigate+ model — specified at root level per Frigate config reference.
  // The user must ensure the Plus model type matches the detector:
  //   mobiledet → cpu/edgetpu, yolov9/yolonas → onnx/openvino/edgetpu/hailo/rknn
  const plusModelId = process.env.FRIGATE_PLUS_MODEL_ID;
  const plusModelActive = !!plusModelId;
  if (plusModelActive) {
    config.model = { path: `plus://${plusModelId}` };
  }

  // Enable GPU-accelerated FFmpeg decoding whenever an NVIDIA GPU is available.
  // NVDEC (hardware decode) is independent of the detector type — it offloads
  // frame decoding from CPU even when using CPU or Coral for object detection.
  if (gpu.enabled && gpu.type === "nvidia") {
    config.ffmpeg = {
      hwaccel_args: "preset-nvidia-h264",
    };
  }

  for (const camera of cameras) {
    // Use slug as the Frigate camera identifier (no spaces, lowercase)
    const cameraId = camera.slug;

    // Deduped: the audio-label rename migration can leave a repeated label
    // when a camera had both the legacy and current id selected
    const audioLabels = [
      ...new Set(camera.audioDetect.split(",").map((a) => a.trim())),
    ].filter((a) => a && globalAudio.has(a));
    const hasAudio = audioLabels.length > 0;

    // go2rtc streams — main stream always, sub stream as separate entry.
    // Only add the Opus transcode source when audio is enabled for this camera.
    const go2rtcSources: string[] = [camera.rtspUrl];
    if (hasAudio) {
      // Transcodes audio to Opus on demand for Safari/iOS WebRTC compatibility
      go2rtcSources.push(`ffmpeg:${cameraId}#audio=opus`);
    }
    config.go2rtc.streams[cameraId] = go2rtcSources;
    if (camera.rtspSubUrl) {
      config.go2rtc.streams[`${cameraId}_sub`] = [camera.rtspSubUrl];
    }

    // Camera config
    const objects = camera.objectsTrack
      .split(",")
      .map((o) => o.trim())
      .filter((o) => o && globalObjects.has(o))
      .filter((o) => {
        // Strip Frigate+ only objects when the plus model isn't active
        const def = getObjectById(o);
        return !def?.plusOnly || plusModelActive;
      });

    // Main stream roles: always "record", plus "audio" if audio detection is on.
    // If no sub stream, main stream also handles "detect".
    const mainRoles = camera.rtspSubUrl ? ["record"] : ["detect", "record"];
    if (hasAudio) mainRoles.push("audio");

    // Exclusion zones: drawn polygons are emitted BOTH as motion masks
    // (motion inside is ignored) and as object masks (any tracked object
    // whose bounding-box bottom-center falls inside is dropped as a false
    // positive). A motion mask alone does not stop object detection or
    // review alerts — Frigate only excludes objects via object masks.
    const exclusionPolygons = parsePolygons(camera.motionMask);
    if (camera.motionMask && exclusionPolygons.length === 0) {
      console.warn(
        `[Config] Ignoring malformed exclusion zones for camera "${camera.slug}"`,
      );
    }
    const hasExclusions = exclusionPolygons.length > 0;

    const cameraConfig: Record<string, unknown> = {
      enabled: true,
      ffmpeg: {
        inputs: [
          {
            path: `rtsp://127.0.0.1:8554/${cameraId}`,
            input_args: "preset-rtsp-restream",
            roles: mainRoles,
          },
          ...(camera.rtspSubUrl
            ? [
                {
                  path: `rtsp://127.0.0.1:8554/${cameraId}_sub`,
                  input_args: "preset-rtsp-restream",
                  roles: ["detect"],
                },
              ]
            : []),
        ],
      },
      detect: {
        enabled: camera.detectEnabled,
        width: camera.detectWidth,
        height: camera.detectHeight,
        fps: camera.detectFps,
      },
      objects: {
        track: objects,
        ...(hasExclusions
          ? { mask: polygonsToNamedMasks(exclusionPolygons) }
          : {}),
      },
      // Every tracked label counts as an alert (Frigate's default is only
      // person/car; everything else lands in the "detection" tier). This
      // aligns Frigate's own review UI and alert recording retention with
      // what the user tracks; the dispatcher filters by tracked labels
      // either way.
      ...(objects.length > 0
        ? { review: { alerts: { labels: objects } } }
        : {}),
      record: {
        enabled: camera.recordEnabled,
        continuous: {
          days: camera.recordRetainDays,
        },
        alerts: {
          retain: {
            days: Math.min(camera.recordRetainDays * 2, 30),
            mode: "all",
          },
        },
        detections: {
          retain: {
            days: camera.recordRetainDays,
            mode: "motion",
          },
        },
      },
      snapshots: {
        enabled: camera.snapshotsEnabled,
      },
      motion: {
        threshold: camera.motionThreshold,
        ...(hasExclusions
          ? { mask: polygonsToNamedMasks(exclusionPolygons) }
          : {}),
      },
    };

    // Audio: explicitly enabled with labels, or explicitly disabled
    if (hasAudio) {
      cameraConfig.audio = {
        enabled: true,
        listen: audioLabels,
      };
    } else {
      cameraConfig.audio = {
        enabled: false,
      };
    }

    // Add zones
    if (camera.zones.length > 0) {
      const zones: Record<string, unknown> = {};
      for (const zone of camera.zones) {
        const coordinates = zoneCoordinatesToString(zone.coordinates);
        if (!coordinates) {
          console.warn(
            `[Config] Skipping zone "${zone.name}" on camera "${camera.slug}": malformed coordinates`,
          );
          continue;
        }
        const zoneObjects = zone.objects
          .split(",")
          .map((o) => o.trim())
          .filter((o) => o && globalObjects.has(o));
        zones[zone.name] = {
          coordinates,
          objects: zoneObjects,
        };
      }
      if (Object.keys(zones).length > 0) {
        cameraConfig.zones = zones;
      }
    }

    config.cameras[cameraId] = cameraConfig;
  }

  // Use js-yaml safe dump to prevent YAML injection
  return yaml.dump(config, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });
}

async function runRegenerate(): Promise<void> {
  const configYaml = await generateFrigateConfig();
  const configPath =
    process.env.FRIGATE_CONFIG_PATH || "/config/frigate/config.yml";

  // Write config file to shared volume (may fail due to permissions)
  let fileWritten = false;
  try {
    await writeFile(configPath, configYaml, "utf-8");
    fileWritten = true;
  } catch {
    // Volume may be owned by Frigate (root) — fall through to API
  }

  // Push config via Frigate API with save_option=restart
  try {
    const { saveFrigateConfig } = await import("@/lib/frigate-client");
    await saveFrigateConfig(configYaml);
    console.log("[Config] Config saved and restart triggered");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[Config] Frigate API push failed:", message);
    if (!fileWritten) {
      throw new Error(
        "Failed to save Frigate config: file write failed and API unreachable",
      );
    }
    // The file was written, but a rejected/failed push means Frigate keeps
    // running its previous config until its next restart. Surface that
    // instead of reporting success — callers return it as configWarning.
    throw new Error(
      `Frigate did not accept the pushed config (${message}). ` +
        "The config file was written to disk and will apply on the next Frigate restart.",
    );
  }
}

// Serialize and coalesce concurrent pushes. Frigate's /api/config/save is not
// safe under concurrent calls (ruamel.yaml parser state and disk writes race,
// producing 400s with corrupted YAML errors), and each successful push triggers
// a full Frigate restart. Callers that arrive while a push is in flight share
// a single follow-up push, which re-runs after the current one and captures the
// latest DB state — so API-driven saves still propagate without back-to-back
// restarts.
const globalForConfig = globalThis as unknown as {
  __frigateConfigInFlight?: Promise<void> | null;
  __frigateConfigQueued?: Promise<void> | null;
};

function runOnce(): Promise<void> {
  const p = runRegenerate().finally(() => {
    if (globalForConfig.__frigateConfigInFlight === p) {
      globalForConfig.__frigateConfigInFlight = null;
    }
  });
  globalForConfig.__frigateConfigInFlight = p;
  return p;
}

export function regenerateFrigateConfig(): Promise<void> {
  if (!globalForConfig.__frigateConfigInFlight) {
    return runOnce();
  }
  if (!globalForConfig.__frigateConfigQueued) {
    const after = () => {
      globalForConfig.__frigateConfigQueued = null;
      return runOnce();
    };
    globalForConfig.__frigateConfigQueued =
      globalForConfig.__frigateConfigInFlight.then(after, after);
  }
  return globalForConfig.__frigateConfigQueued;
}
