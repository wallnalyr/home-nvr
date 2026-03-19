import os from "os";

export type DetectorType = "cpu" | "edgetpu" | "tensorrt";

export interface GPUInfo {
  enabled: boolean;
  type: "nvidia" | "none";
  vramMB: number;
}

export interface CoralInfo {
  enabled: boolean;
  device: string; // "usb", "pci", "pci:0", "/dev/apex_0", etc.
}

export interface HardwareProfile {
  detector: DetectorType;
  detectorLabel: string;
  cpu: {
    model: string;
    cores: number;
  };
  memory: {
    totalMB: number;
  };
  gpu: GPUInfo;
  coral: CoralInfo;
  maxRecommendedCameras: number;
}

export function detectGPU(): GPUInfo {
  const gpuEnabled = process.env.GPU_ENABLED === "true";
  const vramMB = parseInt(process.env.GPU_VRAM_MB || "0", 10);

  if (!gpuEnabled || vramMB === 0) {
    return { enabled: false, type: "none", vramMB: 0 };
  }

  return { enabled: true, type: "nvidia", vramMB };
}

export function detectCoral(): CoralInfo {
  const coralDevice = process.env.CORAL_DEVICE;
  if (coralDevice) {
    return { enabled: true, device: coralDevice };
  }
  return { enabled: false, device: "" };
}

/**
 * Determine which detector to use based on available hardware.
 * Priority: Coral TPU > TensorRT GPU > CPU
 */
export function resolveDetectorType(): DetectorType {
  const explicit = process.env.DETECTOR_TYPE;
  if (explicit === "edgetpu" || explicit === "tensorrt" || explicit === "cpu") {
    return explicit;
  }

  const coral = detectCoral();
  if (coral.enabled) return "edgetpu";

  const gpu = detectGPU();
  const frigateImageTag = process.env.FRIGATE_IMAGE_TAG || "stable";
  const hasTensorRT = frigateImageTag.includes("tensorrt");
  if (gpu.enabled && hasTensorRT) return "tensorrt";

  return "cpu";
}

function detectorLabel(type: DetectorType, gpu: GPUInfo, coral: CoralInfo, cpuCores: number): string {
  switch (type) {
    case "edgetpu":
      return `Coral TPU (${coral.device || "usb"})`;
    case "tensorrt":
      return `NVIDIA TensorRT (${gpu.vramMB} MB VRAM)`;
    case "cpu":
      return `CPU (${cpuCores} cores)`;
  }
}

/**
 * Estimate maximum cameras that can run detection comfortably.
 * These are conservative guidelines for 5 FPS default detection.
 */
function estimateMaxCameras(type: DetectorType, cpuCores: number): number {
  switch (type) {
    case "edgetpu":
      // Coral USB handles ~100 inferences/sec, ~10 per camera at 5 FPS
      return 16;
    case "tensorrt":
      // Even modest GPUs handle many cameras
      return 20;
    case "cpu": {
      // CPU inference ~100-200ms per frame, need ~2 cores per camera
      // Reserve 2 cores for system + recording + encoding
      const available = Math.max(cpuCores - 2, 1);
      return Math.max(Math.floor(available / 2), 1);
    }
  }
}

export function getHardwareProfile(): HardwareProfile {
  const gpu = detectGPU();
  const coral = detectCoral();
  const cpus = os.cpus();
  const cores = cpus.length;
  const detector = resolveDetectorType();

  return {
    detector,
    detectorLabel: detectorLabel(detector, gpu, coral, cores),
    cpu: {
      model: cpus[0]?.model || "Unknown",
      cores,
    },
    memory: {
      totalMB: Math.round(os.totalmem() / (1024 * 1024)),
    },
    gpu,
    coral,
    maxRecommendedCameras: estimateMaxCameras(detector, cores),
  };
}

export interface DetectionCheckResult {
  detector: DetectorType;
  detectorLabel: string;
  detectCamerasCount: number;
  maxRecommended: number;
  warnings: string[];
  tips: string[];
}

/**
 * Check detection viability given the current hardware and camera config.
 * @param detectCamerasCount Number of cameras with detection enabled
 * @param detectFps Highest FPS among detect-enabled cameras
 * @param detectMaxRes Highest resolution (width*height) among detect-enabled cameras
 */
export function checkDetectionViability(
  detectCamerasCount: number,
  detectFps: number,
  detectMaxRes: number
): DetectionCheckResult {
  const profile = getHardwareProfile();
  const warnings: string[] = [];
  const tips: string[] = [];

  if (profile.detector === "cpu") {
    if (profile.cpu.cores < 4) {
      warnings.push(
        `Only ${profile.cpu.cores} CPU cores detected. Detection requires significant CPU — consider a Coral USB TPU ($25) for reliable performance.`
      );
    }

    if (detectCamerasCount > profile.maxRecommendedCameras) {
      warnings.push(
        `${detectCamerasCount} cameras with detection exceeds the recommended maximum of ${profile.maxRecommendedCameras} for CPU-only detection. Consider adding a Coral USB TPU.`
      );
    } else if (detectCamerasCount === profile.maxRecommendedCameras) {
      tips.push(
        "You're at the recommended limit for CPU detection. Adding more cameras may require a Coral TPU."
      );
    }

    if (detectFps > 10) {
      warnings.push(
        `Detection FPS of ${detectFps} is high for CPU inference. Recommended: 5 FPS.`
      );
    }

    if (detectMaxRes > 1280 * 720) {
      tips.push(
        "Lower detection resolution to 1280x720 or 640x480 to reduce CPU load. Full resolution is not needed for object detection."
      );
    }
  }

  if (profile.detector === "edgetpu" && detectCamerasCount > profile.maxRecommendedCameras) {
    warnings.push(
      `${detectCamerasCount} cameras exceeds the recommended ${profile.maxRecommendedCameras} for a single Coral TPU. Consider a second Coral or reducing detection FPS.`
    );
  }

  // Memory check: ~300MB per camera for Frigate + 500MB base
  const estimatedMemMB = 500 + detectCamerasCount * 300;
  if (estimatedMemMB > profile.memory.totalMB * 0.7) {
    warnings.push(
      `Estimated memory usage (${Math.round(estimatedMemMB / 1024 * 10) / 10} GB) may exceed available RAM (${Math.round(profile.memory.totalMB / 1024 * 10) / 10} GB). Consider reducing cameras or adding RAM.`
    );
  }

  return {
    detector: profile.detector,
    detectorLabel: profile.detectorLabel,
    detectCamerasCount,
    maxRecommended: profile.maxRecommendedCameras,
    warnings,
    tips,
  };
}
