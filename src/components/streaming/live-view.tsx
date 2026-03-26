"use client";

import { CameraGrid } from "@/components/streaming/camera-grid";
import { PullIndicator } from "@/components/ui/pull-indicator";
import { useCameras } from "@/hooks/use-cameras";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import type { Camera } from "@/types/camera";

interface LiveViewProps {
  initialCameras: Camera[];
}

export function LiveView({ initialCameras }: LiveViewProps) {
  const { cameras, mutate } = useCameras({ fallbackData: initialCameras });
  const pull = usePullToRefresh({
    onRefresh: async () => { await mutate(); },
  });

  return (
    <div {...pull.handlers}>
      <PullIndicator {...pull} />
      <CameraGrid cameras={cameras} />
    </div>
  );
}
