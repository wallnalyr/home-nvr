"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { CalendarPicker } from "@/components/recordings/calendar-picker";
import { HourGrid } from "@/components/recordings/hour-grid";
import { RecordingPlayer } from "@/components/recordings/recording-player";
import { useCameras } from "@/hooks/use-cameras";
import {
  useRecordingSummary,
  type RecordingHour,
} from "@/hooks/use-recording-summary";
import { startOfDay, getUnixTime, format } from "date-fns";
import { tzFromDate, tzDate } from "@/lib/timezone";
import { Loader2, VideoOff } from "lucide-react";

export default function RecordingsPage() {
  const { cameras } = useCameras();
  const [pickedCamera, setPickedCamera] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedHour, setSelectedHour] = useState<number | null>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  // Use picked camera, or auto-select first when cameras load
  const selectedCamera =
    pickedCamera || (cameras.length > 0 ? cameras[0].slug : "");

  const { summary, isLoading: summaryLoading } =
    useRecordingSummary(selectedCamera || null);

  // Scroll selected camera pill into view
  useEffect(() => {
    selectedRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [selectedCamera]);

  const dayStart = useMemo(() => {
    const tzDay = tzFromDate(selectedDate);
    return getUnixTime(startOfDay(tzDay));
  }, [selectedDate]);

  const selectedDateStr = useMemo(
    () => format(tzFromDate(selectedDate), "yyyy-MM-dd"),
    [selectedDate]
  );

  const dayData = useMemo(
    () => summary.find((d) => d.day === selectedDateStr),
    [summary, selectedDateStr]
  );

  const hours: RecordingHour[] = useMemo(
    () => dayData?.hours || [],
    [dayData]
  );

  const totalDayRecording = useMemo(
    () => hours.reduce((sum, h) => sum + h.duration, 0),
    [hours]
  );

  const totalDayEvents = useMemo(
    () => hours.reduce((sum, h) => sum + h.events, 0),
    [hours]
  );

  // Selected hour's time range (epoch seconds)
  const { rangeStart, rangeEnd } = useMemo(() => {
    if (selectedHour === null) return { rangeStart: 0, rangeEnd: 0 };
    return {
      rangeStart: dayStart + selectedHour * 3600,
      rangeEnd: dayStart + (selectedHour + 1) * 3600,
    };
  }, [dayStart, selectedHour]);

  const handleHourSelect = useCallback((hour: number) => {
    setSelectedHour(hour);
  }, []);

  const handleCameraChange = useCallback((slug: string) => {
    setPickedCamera(slug);
    setSelectedHour(null);
  }, []);

  const handleDateChange = useCallback((date: Date) => {
    setSelectedDate(date);
    setSelectedHour(null);
  }, []);

  return (
    <div className="space-y-3">
      {/* Camera selector pills */}
      <div className="overflow-x-auto scrollbar-hide px-4 pt-3">
        <div className="flex gap-2 w-max">
          {cameras.map((cam) => {
            const isSelected = cam.slug === selectedCamera;
            return (
              <button
                key={cam.id}
                ref={isSelected ? selectedRef : undefined}
                onClick={() => handleCameraChange(cam.slug)}
                className={`
                  shrink-0 px-4 py-2 rounded-full text-sm font-medium
                  transition-all duration-150
                  ${
                    isSelected
                      ? "bg-ios-blue text-white shadow-sm"
                      : "bg-secondary/60 text-secondary-foreground"
                  }
                `}
              >
                {cam.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Date picker */}
      <CalendarPicker
        selectedDate={selectedDate}
        onDateChange={handleDateChange}
      />

      {!selectedCamera ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-muted-foreground text-sm">
            Select a camera to view recordings
          </p>
        </div>
      ) : summaryLoading ? (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-2">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground text-sm">
            Loading recording data...
          </p>
        </div>
      ) : (
        <>
          {/* Day summary stats */}
          <div className="px-4">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {totalDayRecording > 0 ? (
                <>
                  <span>{formatDuration(totalDayRecording)} recorded</span>
                  <span className="text-border">|</span>
                  <span>
                    {hours.filter((h) => h.duration > 0).length} of 24 hours
                  </span>
                  {totalDayEvents > 0 && (
                    <>
                      <span className="text-border">|</span>
                      <span>{totalDayEvents} events</span>
                    </>
                  )}
                </>
              ) : (
                <span>No recordings for this date</span>
              )}
            </div>
          </div>

          {/* Hour availability grid */}
          <HourGrid
            dayStart={dayStart}
            hours={hours}
            selectedHour={selectedHour}
            onSelectHour={handleHourSelect}
          />

          {/* Player area */}
          {selectedHour !== null ? (
            <>
              <div className="px-4 flex items-center justify-between">
                <span className="text-sm font-medium">
                  {format(tzDate(rangeStart), "h:mm a")} &ndash;{" "}
                  {format(tzDate(rangeEnd), "h:mm a")}
                </span>
                {(() => {
                  const hourKey = String(selectedHour).padStart(2, "0");
                  const dur = hours.find((h) => h.hour === hourKey)?.duration;
                  return dur ? (
                    <span className="text-xs text-muted-foreground">
                      {formatDuration(dur)}
                    </span>
                  ) : null;
                })()}
              </div>

              <div className="px-2">
                <RecordingPlayer
                  camera={selectedCamera}
                  startTime={rangeStart}
                  endTime={rangeEnd}
                />
              </div>
            </>
          ) : totalDayRecording > 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
              <p className="text-muted-foreground text-sm">
                Tap an hour to play its recording
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
              <VideoOff className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-muted-foreground text-sm">
                No recordings found
              </p>
              <p className="text-muted-foreground/70 text-xs max-w-[280px]">
                Check that recording is enabled for this camera and that Frigate
                is receiving the RTSP stream
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  if (m > 0) return `${m}m`;
  return `${Math.round(seconds)}s`;
}
