"use client";

import { EventCard } from "./event-card";
import { Skeleton } from "@/components/ui/skeleton";
import type { FrigateEvent } from "@/types/event";
import { motion } from "framer-motion";

interface EventGridProps {
  events: FrigateEvent[];
  isLoading: boolean;
  cameraNames?: Record<string, string>;
  lastSeenTime?: number;
  selectMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
}

export function EventGrid({
  events,
  isLoading,
  cameraNames,
  lastSeenTime,
  selectMode,
  selectedIds,
  onToggleSelect,
}: EventGridProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 p-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rounded-xl overflow-hidden shadow-sm bg-card">
            <Skeleton className="aspect-video w-full" />
            <div className="p-2.5 space-y-1.5">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-muted-foreground text-sm">No events found</p>
        <p className="text-muted-foreground text-xs mt-1">
          Events will appear here when motion or objects are detected
        </p>
      </div>
    );
  }

  return (
    <motion.div
      className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 p-4"
      initial="hidden"
      animate="visible"
      variants={{
        visible: {
          transition: { staggerChildren: 0.03 },
        },
      }}
    >
      {events.map((event) => (
        <motion.div
          key={event.id}
          variants={{
            hidden: { opacity: 0, y: 10 },
            visible: { opacity: 1, y: 0 },
          }}
        >
          <EventCard
            event={event}
            cameraDisplayName={cameraNames?.[event.camera]}
            isNew={lastSeenTime != null && lastSeenTime > 0 && event.start_time > lastSeenTime}
            selectMode={selectMode}
            isSelected={selectedIds?.has(event.id)}
            onToggleSelect={onToggleSelect}
          />
        </motion.div>
      ))}
    </motion.div>
  );
}
