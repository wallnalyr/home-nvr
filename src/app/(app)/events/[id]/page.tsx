"use client";

import { use, useState, useCallback, useMemo } from "react";
import useSWR, { useSWRConfig } from "swr";
import { ClipPlayer } from "@/components/events/clip-player";
import { RecordingPlayer } from "@/components/recordings/recording-player";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Bookmark, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { tzDate } from "@/lib/timezone";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useSwipeNavigation } from "@/hooks/use-swipe-navigation";
import type { FrigateEvent } from "@/types/event";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

type ViewMode = "clip" | "timeline";

const PADDING_OPTIONS = [
  { label: "30s", value: 30 },
  { label: "1m", value: 60 },
  { label: "5m", value: 300 },
];

export default function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { mutate: globalMutate } = useSWRConfig();
  const { data: event, isLoading, mutate } = useSWR<FrigateEvent>(
    `/api/frigate/events?event_id=${id}`,
    fetcher
  );
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("clip");
  const [padding, setPadding] = useState(30);

  const eventData = Array.isArray(event) ? event[0] : event;

  // Find prev/next events from the SWR cache (populated by the events list page)
  const { cache } = useSWRConfig();
  const { prevId, nextId } = useMemo(() => {
    // Search cache for an events list that contains this event
    const entries = cache.keys ? Array.from(cache.keys()) : [];
    for (const key of entries) {
      if (typeof key === "string" && key.startsWith("/api/frigate/events?") && !key.includes("event_id=")) {
        const cached = cache.get(key) as { data?: FrigateEvent[] } | undefined;
        const list = cached?.data;
        if (Array.isArray(list)) {
          const idx = list.findIndex((e) => e.id === id);
          if (idx >= 0) {
            return {
              prevId: idx > 0 ? list[idx - 1].id : null,
              nextId: idx < list.length - 1 ? list[idx + 1].id : null,
            };
          }
        }
      }
    }
    return { prevId: null, nextId: null };
  }, [cache, id]);

  const goToEvent = useCallback((eventId: string) => {
    router.replace(`/events/${eventId}`);
  }, [router]);

  const swipeHandlers = useSwipeNavigation({
    onSwipeLeft: nextId ? () => goToEvent(nextId) : undefined,
    onSwipeRight: prevId ? () => goToEvent(prevId) : undefined,
  });

  const timelineRange = useMemo(() => {
    if (!eventData) return null;
    const start = eventData.start_time - padding;
    const end = (eventData.end_time ?? eventData.start_time + 10) + padding;
    return { start, end };
  }, [eventData, padding]);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/frigate/events/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      toast.success("Event deleted");
      globalMutate(
        (key) => typeof key === "string" && key.startsWith("/api/frigate/events"),
        undefined,
        { revalidate: true }
      );
      router.back();
    } catch {
      toast.error("Failed to delete event");
      setDeleting(false);
    }
  }, [id, router, globalMutate]);

  const handleToggleRetain = useCallback(async () => {
    if (!eventData || toggling) return;
    const newRetain = !eventData.retain_indefinitely;
    setToggling(true);

    mutate(
      (prev) => {
        const d = Array.isArray(prev) ? prev[0] : prev;
        if (!d) return prev;
        const updated = { ...d, retain_indefinitely: newRetain };
        return Array.isArray(prev) ? [updated] : updated;
      },
      { revalidate: false }
    );

    try {
      const res = await fetch(`/api/frigate/events/${id}/retain`, {
        method: newRetain ? "POST" : "DELETE",
      });
      if (!res.ok) throw new Error();
      toast.success(newRetain ? "Event saved" : "Event unsaved");
    } catch {
      toast.error(
        newRetain ? "Failed to save event" : "Failed to unsave event"
      );
      mutate();
    } finally {
      setToggling(false);
    }
  }, [id, eventData, mutate, toggling]);

  if (isLoading) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="aspect-video w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
    );
  }

  if (!eventData) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-muted-foreground">Event not found</p>
      </div>
    );
  }

  const showToggle = eventData.has_clip;

  return (
    <div className="p-4 space-y-4" {...swipeHandlers}>
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.back()}
          className="gap-1 -ml-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={handleToggleRetain}
            disabled={toggling}
          >
            <Bookmark
              className={`h-4.5 w-4.5 ${
                eventData.retain_indefinitely
                  ? "text-ios-blue fill-ios-blue"
                  : "text-muted-foreground"
              }`}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-muted-foreground hover:text-red-500"
            onClick={handleDelete}
            disabled={deleting}
          >
            <Trash2 className="h-4.5 w-4.5" />
          </Button>
        </div>
      </div>

      {/* Clip / Timeline toggle */}
      {showToggle && (
        <div className="flex items-center gap-2">
          <div className="flex bg-secondary/60 rounded-lg p-0.5">
            {(["clip", "timeline"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={cn(
                  "px-3 py-1 rounded-md text-xs font-medium transition-all duration-150",
                  viewMode === mode
                    ? "bg-ios-blue text-white shadow-sm"
                    : "text-muted-foreground"
                )}
              >
                {mode === "clip" ? "Clip" : "Timeline"}
              </button>
            ))}
          </div>

          {/* Padding presets — only visible in timeline mode */}
          {viewMode === "timeline" && (
            <div className="flex bg-secondary/60 rounded-lg p-0.5">
              {PADDING_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setPadding(opt.value)}
                  className={cn(
                    "px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-150",
                    padding === opt.value
                      ? "bg-foreground/10 text-foreground"
                      : "text-muted-foreground"
                  )}
                >
                  ±{opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Video player */}
      {showToggle && viewMode === "timeline" && timelineRange ? (
        <RecordingPlayer
          camera={eventData.camera}
          startTime={timelineRange.start}
          endTime={timelineRange.end}
        />
      ) : eventData.has_clip ? (
        <ClipPlayer eventId={id} />
      ) : eventData.has_snapshot ? (
        <div className="camera-feed-container rounded-xl overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/frigate/events/${id}/snapshot`}
            alt={eventData.label}
            className="absolute inset-0 w-full h-full object-contain"
          />
        </div>
      ) : null}

      <div className="rounded-xl bg-card shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge>{eventData.label}</Badge>
          <Badge variant="secondary">{eventData.camera}</Badge>
          {eventData.top_score > 0 && (
            <Badge variant="secondary">
              {Math.round(eventData.top_score * 100)}% confidence
            </Badge>
          )}
          {eventData.retain_indefinitely && (
            <Badge variant="secondary" className="gap-1">
              <Bookmark className="h-3 w-3 fill-current" />
              Saved
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-muted-foreground text-xs">Started</p>
            <p>
              {format(tzDate(eventData.start_time), "MMM d, HH:mm:ss")}
            </p>
          </div>
          {eventData.end_time && (
            <div>
              <p className="text-muted-foreground text-xs">Ended</p>
              <p>
                {format(tzDate(eventData.end_time), "MMM d, HH:mm:ss")}
              </p>
            </div>
          )}
          {eventData.zones.length > 0 && (
            <div className="col-span-2">
              <p className="text-muted-foreground text-xs">Zones</p>
              <p>{eventData.zones.join(", ")}</p>
            </div>
          )}
        </div>
      </div>

      {/* Prev / Next navigation */}
      {(prevId || nextId) && (
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 text-muted-foreground"
            disabled={!prevId}
            onClick={() => prevId && goToEvent(prevId)}
          >
            <ChevronLeft className="h-4 w-4" />
            Newer
          </Button>
          <span className="text-[11px] text-muted-foreground">Swipe to navigate</span>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 text-muted-foreground"
            disabled={!nextId}
            onClick={() => nextId && goToEvent(nextId)}
          >
            Older
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
