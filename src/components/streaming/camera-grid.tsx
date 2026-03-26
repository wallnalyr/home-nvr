"use client";

import { CameraFeed } from "./camera-feed";
import { useTodayEventCounts } from "@/hooks/use-today-event-counts";
import type { Camera } from "@/types/camera";

interface CameraGridProps {
  cameras: Camera[];
}

export function CameraGrid({ cameras }: CameraGridProps) {
  const eventCounts = useTodayEventCounts();

  if (cameras.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center px-4">
        <div className="rounded-2xl bg-card shadow-sm p-4 mb-4">
          <p className="text-muted-foreground text-sm">No cameras configured</p>
          <p className="text-muted-foreground text-xs mt-1">
            Add a camera in the Cameras tab to get started
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-4">
      {cameras.map((camera) => (
        <CameraFeed
          key={camera.id}
          cameraName={camera.name}
          cameraSlug={camera.slug}
          eventCount={eventCounts[camera.slug] || 0}
        />
      ))}
    </div>
  );
}
