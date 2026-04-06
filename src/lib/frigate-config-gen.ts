import yaml from "js-yaml";
import os from "os";
import { prisma } from "@/lib/db";
import { detectGPU, detectCoral, resolveDetectorType } from "@/lib/hardware-detect";
import { getObjectById, DEFAULT_ENABLED_OBJECTS, DEFAULT_ENABLED_AUDIO } from "@/lib/objects";
import { writeFile } from "fs/promises";

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
  mqtt: { host: string; port: number };
  detectors: Record<string, unknown>;
  model?: { path: string };
  ffmpeg?: Record<string, unknown>;
  go2rtc: { streams: Record<string, string[]>; webrtc?: Record<string, unknown> };
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
    objectsRow ? JSON.parse(objectsRow.value) : DEFAULT_ENABLED_OBJECTS
  );

  const audioRow = await prisma.systemConfig.findUnique({
    where: { key: "enabled_audio" },
  });
  const globalAudio = new Set<string>(
    audioRow ? JSON.parse(audioRow.value) : DEFAULT_ENABLED_AUDIO
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

    // go2rtc streams — main stream always, sub stream as separate entry.
    // The ffmpeg source transcodes audio to Opus on demand for Safari/iOS
    // WebRTC compatibility (many cameras output G.711 which Safari rejects).
    config.go2rtc.streams[cameraId] = [
      camera.rtspUrl,
      `ffmpeg:${cameraId}#audio=opus`,
    ];
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

    const audioLabels = camera.audioDetect
      .split(",")
      .map((a) => a.trim())
      .filter((a) => a && globalAudio.has(a));
    const hasAudio = audioLabels.length > 0;

    // Main stream roles: always "record", plus "audio" if audio detection is on.
    // If no sub stream, main stream also handles "detect".
    const mainRoles = camera.rtspSubUrl ? ["record"] : ["detect", "record"];
    if (hasAudio) mainRoles.push("audio");

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
      },
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
        ...(camera.motionMask
          ? (() => {
              try {
                return { mask: JSON.parse(camera.motionMask) };
              } catch {
                return {};
              }
            })()
          : {}),
      },
    };

    // Audio detection (per-camera)
    if (hasAudio) {
      cameraConfig.audio = {
        enabled: true,
        listen: audioLabels,
      };
    }

    // Add zones
    if (camera.zones.length > 0) {
      const zones: Record<string, unknown> = {};
      for (const zone of camera.zones) {
        const zoneObjects = zone.objects
          .split(",")
          .map((o) => o.trim())
          .filter((o) => o && globalObjects.has(o));
        zones[zone.name] = {
          coordinates: zone.coordinates,
          objects: zoneObjects,
        };
      }
      cameraConfig.zones = zones;
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

export async function regenerateFrigateConfig(): Promise<void> {
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
    console.warn("[Config] Frigate API push failed:", err instanceof Error ? err.message : err);
    if (!fileWritten) {
      throw new Error(
        "Failed to save Frigate config: file write failed and API unreachable"
      );
    }
    // File was written; Frigate will pick it up on next container restart
  }
}

