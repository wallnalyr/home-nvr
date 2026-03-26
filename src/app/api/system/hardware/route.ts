import { NextResponse } from "next/server";
import { getHardwareProfile } from "@/lib/hardware-detect";
import os from "os";

export async function GET() {
  const profile = getHardwareProfile();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  let frigateStatus = "unknown";
  try {
    const res = await fetch(
      `${process.env.FRIGATE_URL || "http://frigate:5000"}/api/stats`,
      { signal: AbortSignal.timeout(3000) }
    );
    frigateStatus = res.ok ? "connected" : "error";
  } catch {
    frigateStatus = "disconnected";
  }

  return NextResponse.json({
    cpu: {
      model: profile.cpu.model,
      cores: profile.cpu.cores,
      loadAvg: os.loadavg(),
    },
    memory: {
      total: totalMem,
      free: freeMem,
      used: totalMem - freeMem,
      usagePercent: Math.round(((totalMem - freeMem) / totalMem) * 100),
    },
    gpu: {
      enabled: profile.gpu.enabled,
      type: profile.gpu.type,
      vramMB: profile.gpu.vramMB,
    },
    coral: {
      enabled: profile.coral.enabled,
      device: profile.coral.device,
    },
    detector: {
      type: profile.detector,
      label: profile.detectorLabel,
      maxRecommendedCameras: profile.maxRecommendedCameras,
    },
    frigate: {
      status: frigateStatus,
      url: process.env.FRIGATE_URL || "http://frigate:5000",
    },
    system: {
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      uptime: os.uptime(),
      nodeVersion: process.version,
    },
  });
}
