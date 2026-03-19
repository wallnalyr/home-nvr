"use client";

import { CameraGrid } from "@/components/streaming/camera-grid";
import { useCameras } from "@/hooks/use-cameras";
import type { Camera } from "@/types/camera";

interface LiveViewProps {
  initialCameras: Camera[];
}

export function LiveView({ initialCameras }: LiveViewProps) {
  const { cameras } = useCameras({ fallbackData: initialCameras });

  return <CameraGrid cameras={cameras} />;
}
