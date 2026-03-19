"use client";

import { use, useState, useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
import { ClipPlayer } from "@/components/events/clip-player";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Bookmark, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { tzDate } from "@/lib/timezone";
import { toast } from "sonner";
import type { FrigateEvent } from "@/types/event";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

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

  const eventData = Array.isArray(event) ? event[0] : event;

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/frigate/events/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      toast.success("Event deleted");
      // Invalidate all event list caches so the deleted event disappears
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

    // Optimistic update
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

  return (
    <div className="p-4 space-y-4">
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

      {eventData.has_clip ? (
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
    </div>
  );
}
