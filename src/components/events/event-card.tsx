"use client";

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { tzDate } from "@/lib/timezone";
import type { FrigateEvent } from "@/types/event";
import { motion } from "framer-motion";
import { Bookmark, Check } from "lucide-react";

interface EventCardProps {
  event: FrigateEvent;
  cameraDisplayName?: string;
  isNew?: boolean;
  selectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
}

export function EventCard({
  event,
  cameraDisplayName,
  isNew,
  selectMode,
  isSelected,
  onToggleSelect,
}: EventCardProps) {
  const timeAgo = formatDistanceToNow(tzDate(event.start_time), {
    addSuffix: true,
  });

  const displayCamera = cameraDisplayName || event.camera;
  const labelText =
    event.label.charAt(0).toUpperCase() + event.label.slice(1);

  const cardContent = (
    <>
      <div className="aspect-video relative bg-secondary">
        {event.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`data:image/jpeg;base64,${event.thumbnail}`}
            alt={`${event.label} on ${displayCamera}`}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : event.has_snapshot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/frigate/events/${event.id}/snapshot`}
            alt={`${event.label} on ${displayCamera}`}
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
          />
        ) : null}
        {event.retain_indefinitely && (
          <div className="absolute top-1.5 right-1.5">
            <Bookmark className="h-4 w-4 text-white fill-white drop-shadow-md" />
          </div>
        )}
        {isNew && !selectMode && (
          <div className="absolute top-1.5 left-1.5">
            <span className="bg-ios-blue text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full leading-none">
              NEW
            </span>
          </div>
        )}
        {/* Selection checkbox */}
        {selectMode && (
          <div className="absolute top-1.5 left-1.5">
            <div
              className={`h-6 w-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                isSelected
                  ? "bg-ios-blue border-ios-blue"
                  : "bg-black/30 border-white/80"
              }`}
            >
              {isSelected && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
            </div>
          </div>
        )}
        {/* Dim overlay when in select mode and not selected */}
        {selectMode && !isSelected && (
          <div className="absolute inset-0 bg-black/20" />
        )}
      </div>
      <div className="p-2.5">
        <p className="text-sm font-medium truncate">{displayCamera}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-xs text-muted-foreground">{labelText}</span>
          {event.top_score > 0 && (
            <>
              <span className="text-xs text-muted-foreground">·</span>
              <span className="text-xs text-muted-foreground">
                {Math.round(event.top_score * 100)}%
              </span>
            </>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {timeAgo}
        </p>
      </div>
    </>
  );

  if (selectMode) {
    return (
      <motion.div
        whileTap={{ scale: 0.97 }}
        transition={{ type: "spring", stiffness: 400, damping: 17 }}
      >
        <button
          onClick={() => onToggleSelect?.(event.id)}
          className="block w-full text-left rounded-xl overflow-hidden bg-card shadow-sm"
        >
          {cardContent}
        </button>
      </motion.div>
    );
  }

  return (
    <motion.div
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", stiffness: 400, damping: 17 }}
    >
      <Link
        href={`/events/${event.id}`}
        className="block rounded-xl overflow-hidden bg-card shadow-sm"
      >
        {cardContent}
      </Link>
    </motion.div>
  );
}
