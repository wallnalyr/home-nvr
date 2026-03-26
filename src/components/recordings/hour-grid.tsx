"use client";

import { format } from "date-fns";
import { tzDate } from "@/lib/timezone";
import type { RecordingHour } from "@/hooks/use-recording-summary";

interface HourGridProps {
  dayStart: number;
  hours: RecordingHour[];
  selectedHour: number | null;
  onSelectHour: (hour: number) => void;
}

export function HourGrid({
  dayStart,
  hours,
  selectedHour,
  onSelectHour,
}: HourGridProps) {
  // Build lookup: hour string -> recording data
  const hourMap = new Map<string, RecordingHour>();
  for (const h of hours) {
    hourMap.set(h.hour, h);
  }

  // Generate 24 hour blocks
  const blocks = Array.from({ length: 24 }, (_, i) => {
    const hourKey = String(i).padStart(2, "0");
    const rec = hourMap.get(hourKey);
    const duration = rec?.duration || 0;
    const events = rec?.events || 0;
    // Coverage: what fraction of the hour has recording (max 3600s)
    const coverage = Math.min(duration / 3600, 1);
    const epochStart = dayStart + i * 3600;
    const label = format(tzDate(epochStart), "ha").toLowerCase();

    return { hour: i, hourKey, label, coverage, duration, events, epochStart };
  });

  return (
    <div className="px-4">
      <div className="grid grid-cols-6 gap-1.5">
        {blocks.map((block) => {
          const isSelected = selectedHour === block.hour;
          const hasRecording = block.coverage > 0;

          return (
            <button
              key={block.hour}
              onClick={() => onSelectHour(block.hour)}
              className={`
                relative flex flex-col items-center justify-center
                rounded-lg py-2 text-xs font-medium
                transition-all duration-150
                ${
                  isSelected
                    ? "bg-ios-blue text-white ring-2 ring-ios-blue ring-offset-1"
                    : hasRecording
                      ? "bg-ios-blue/15 text-ios-blue"
                      : "bg-secondary/50 text-muted-foreground"
                }
              `}
            >
              <span className="text-[11px] leading-tight">{block.label}</span>
              {hasRecording && !isSelected && (
                <span
                  className="mt-0.5 h-1 rounded-full bg-ios-blue"
                  style={{ width: `${Math.max(block.coverage * 100, 20)}%` }}
                />
              )}
              {hasRecording && isSelected && (
                <span className="mt-0.5 text-[9px] leading-tight opacity-80">
                  {Math.round(block.coverage * 100)}%
                </span>
              )}
              {block.events > 0 && !isSelected && (
                <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-destructive text-[8px] font-bold text-white">
                  {block.events > 9 ? "9+" : block.events}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
