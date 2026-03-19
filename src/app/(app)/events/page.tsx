"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EventGrid } from "@/components/events/event-grid";
import { EventFilters } from "@/components/events/event-filters";
import { useCameras } from "@/hooks/use-cameras";
import { useEvents } from "@/hooks/use-events";
import { useEnabledObjects } from "@/hooks/use-enabled-objects";
import { useLastSeenEventTime } from "@/hooks/use-unseen-events";
import { startOfDay, subDays, getUnixTime } from "date-fns";
import { tzFromDate } from "@/lib/timezone";
import { toast } from "sonner";

function rangeToAfter(range: string): number {
  const now = new Date();
  const todayStart = startOfDay(tzFromDate(now));
  switch (range) {
    case "today":
      return getUnixTime(todayStart);
    case "3d":
      return getUnixTime(subDays(todayStart, 2));
    case "7d":
      return getUnixTime(subDays(todayStart, 6));
    case "14d":
      return getUnixTime(subDays(todayStart, 13));
    case "30d":
      return getUnixTime(subDays(todayStart, 29));
    default:
      return getUnixTime(subDays(todayStart, 2));
  }
}

export default function EventsPage() {
  const { cameras } = useCameras();
  const { enabledObjects } = useEnabledObjects();
  const [selectedCamera, setSelectedCamera] = useState("all");
  const [selectedLabel, setSelectedLabel] = useState("all");
  const [selectedRange, setSelectedRange] = useState("3d");
  const [showSaved, setShowSaved] = useState(false);
  const { lastSeenTime, markEventsSeen } = useLastSeenEventTime();

  // Multi-select state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const after = useMemo(() => rangeToAfter(selectedRange), [selectedRange]);

  const { events, isLoading, mutate } = useEvents({
    camera: selectedCamera !== "all" ? selectedCamera : undefined,
    label: selectedLabel !== "all" ? selectedLabel : undefined,
    favorites: showSaved ? true : undefined,
    after,
    limit: 100,
  });

  // Mark events as seen when the page is viewed and events are loaded
  useEffect(() => {
    if (events.length === 0) return;
    const latestTime = Math.max(...events.map((e) => e.start_time));
    markEventsSeen(latestTime);
  }, [events, markEventsSeen]);

  // Exit select mode when no events remain
  const effectiveSelectMode = selectMode && events.length > 0;

  const cameraNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const cam of cameras) {
      map[cam.slug] = cam.name;
    }
    return map;
  }, [cameras]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(events.map((e) => e.id)));
  }, [events]);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const handleBatchDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;

    const idsToDelete = Array.from(selectedIds);
    setDeleting(true);

    // Optimistic: remove from local list immediately
    mutate(
      (prev) => prev?.filter((e) => !selectedIds.has(e.id)),
      { revalidate: false }
    );

    let successCount = 0;
    let failCount = 0;

    // Delete in parallel (batches of 5 to avoid overwhelming the server)
    for (let i = 0; i < idsToDelete.length; i += 5) {
      const batch = idsToDelete.slice(i, i + 5);
      const results = await Promise.allSettled(
        batch.map((id) =>
          fetch(`/api/frigate/events/${id}`, { method: "DELETE" }).then(
            (res) => {
              if (!res.ok) throw new Error();
            }
          )
        )
      );
      for (const r of results) {
        if (r.status === "fulfilled") successCount++;
        else failCount++;
      }
    }

    setDeleting(false);
    setSelectedIds(new Set());
    setSelectMode(false);

    // Revalidate to get the true server state
    mutate();

    if (failCount === 0) {
      toast.success(`Deleted ${successCount} event${successCount !== 1 ? "s" : ""}`);
    } else {
      toast.error(`Failed to delete ${failCount} event${failCount !== 1 ? "s" : ""}`);
    }
  }, [selectedIds, mutate]);

  return (
    <div>
      <EventFilters
        cameras={cameras}
        enabledObjects={enabledObjects}
        selectedCamera={selectedCamera}
        selectedLabel={selectedLabel}
        selectedRange={selectedRange}
        showSaved={showSaved}
        onCameraChange={setSelectedCamera}
        onLabelChange={setSelectedLabel}
        onRangeChange={setSelectedRange}
        onShowSavedChange={setShowSaved}
        selectMode={effectiveSelectMode}
        selectedCount={selectedIds.size}
        totalCount={events.length}
        deleting={deleting}
        onEnterSelectMode={() => setSelectMode(true)}
        onExitSelectMode={exitSelectMode}
        onSelectAll={selectAll}
        onDeleteSelected={handleBatchDelete}
      />
      <EventGrid
        events={events}
        isLoading={isLoading}
        cameraNames={cameraNames}
        lastSeenTime={lastSeenTime}
        selectMode={effectiveSelectMode}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
      />
    </div>
  );
}
