"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Loader2, VideoOff } from "lucide-react";
import { useGo2rtcStream } from "@/hooks/use-go2rtc-stream";

// Show last snapshot with small spinner for this long before full offline state
const GRACE_PERIOD_MS = 15000;

interface CameraFeedProps {
  cameraName: string;
  cameraSlug: string;
  className?: string;
  eventCount?: number;
  serverOffline?: boolean;
}

export const CameraFeed = memo(function CameraFeed({
  cameraName,
  cameraSlug,
  className,
  eventCount,
  serverOffline,
}: CameraFeedProps) {
  const { status, videoRef, retry, recover, setFullscreen } = useGo2rtcStream(cameraSlug);

  const isLive = status === "live" && !serverOffline;

  // Track whether the stream was ever live — used to decide if we have
  // a snapshot to show during interruptions. Latched during render so it
  // is in sync with the same render that shows the live stream.
  const [wasLive, setWasLive] = useState(false);
  if (isLive && !wasLive) setWasLive(true);

  // Grace period: when stream drops, show last frame + small spinner
  // for GRACE_PERIOD_MS before switching to full offline state
  const [graceExpired, setGraceExpired] = useState(false);
  if (isLive && graceExpired) setGraceExpired(false);

  // Run the grace timer exactly while the stream is dropped after
  // having been live; cleanup cancels it if the stream recovers
  useEffect(() => {
    if (isLive || !wasLive || graceExpired) return;
    const timer = setTimeout(() => setGraceExpired(true), GRACE_PERIOD_MS);
    return () => clearTimeout(timer);
  }, [isLive, wasLive, graceExpired]);

  // During grace period: show snapshot background with small spinner
  const inGracePeriod = !isLive && wasLive && !graceExpired;
  // Full offline state: grace period expired or server confirmed offline
  const showFullOffline = serverOffline && !inGracePeriod;
  const showClientOffline = status === "offline" && !serverOffline && !inGracePeriod;
  const showFullSpinner = status === "connecting" && !serverOffline && !inGracePeriod;

  // Auto-retry when server health says camera is online but client gave up
  const prevServerOfflineRef = useRef<boolean | undefined>(serverOffline);
  useEffect(() => {
    const prev = prevServerOfflineRef.current;
    prevServerOfflineRef.current = serverOffline;
    if (serverOffline === false && prev !== false && status !== "live") {
      retry();
    }
  }, [serverOffline, status, retry]);

  // Unmute on native fullscreen, re-mute on exit
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onFullscreenChange = () => {
      const isFs =
        !!document.fullscreenElement ||
        !!(document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement;
      video.muted = !isFs;
      setFullscreen(isFs);
      if (!isFs) {
        recover();
      }
    };

    const onIOSEnd = () => {
      video.muted = true;
      setFullscreen(false);
      recover();
    };
    const onIOSBegin = () => {
      video.muted = false;
      setFullscreen(true);
    };

    video.addEventListener("webkitendfullscreen", onIOSEnd);
    video.addEventListener("webkitbeginfullscreen", onIOSBegin);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);

    return () => {
      video.removeEventListener("webkitendfullscreen", onIOSEnd);
      video.removeEventListener("webkitbeginfullscreen", onIOSBegin);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
    };
  }, [videoRef, recover, setFullscreen]);

  const handleTap = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    video.muted = false;

    if ("webkitEnterFullscreen" in video) {
      (video as HTMLVideoElement & { webkitEnterFullscreen: () => void }).webkitEnterFullscreen();
    } else if (video.requestFullscreen) {
      video.requestFullscreen().catch(() => {
        video.muted = true;
      });
    }
  }, [videoRef]);

  const handleRetry = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      retry();
    },
    [retry]
  );

  return (
    <div className={cn("flex flex-col", className)}>
      {/* Camera name and status indicator */}
      <div className="flex items-center justify-between px-1 pb-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm font-semibold text-foreground truncate">
            {cameraName}
          </span>
          {eventCount != null && eventCount > 0 && (
            <span className="shrink-0 min-w-[18px] h-[18px] rounded-full bg-muted text-muted-foreground text-[10px] font-bold flex items-center justify-center px-1 leading-none">
              {eventCount > 99 ? "99+" : eventCount}
            </span>
          )}
        </div>
        {showFullOffline ? (
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="h-2 w-2 rounded-full bg-red-500" />
            <span className="text-[11px] font-semibold text-red-500 uppercase tracking-wider">
              Offline
            </span>
          </div>
        ) : isLive ? (
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="h-2 w-2 rounded-full bg-green-500 live-pulse" />
            <span className="text-[11px] font-semibold text-green-500 uppercase tracking-wider">
              Live
            </span>
          </div>
        ) : inGracePeriod ? (
          <div className="flex items-center gap-1.5 shrink-0">
            <Loader2 className="h-3 w-3 animate-spin text-amber-500" />
            <span className="text-[11px] font-medium text-amber-500">
              Reconnecting
            </span>
          </div>
        ) : status === "connecting" ? (
          <div className="flex items-center gap-1.5 shrink-0">
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            <span className="text-[11px] font-medium text-muted-foreground">
              Connecting
            </span>
          </div>
        ) : null}
      </div>

      {/* Camera feed */}
      <div
        className="camera-feed-container shadow-sm rounded-xl overflow-hidden cursor-pointer"
        onClick={isLive ? handleTap : undefined}
        role={isLive ? "button" : undefined}
        tabIndex={isLive ? 0 : undefined}
      >
        {/* Grace period: last snapshot + small spinner overlay */}
        {inGracePeriod && (
          <div className="absolute inset-0 bg-black">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/go2rtc/frame?src=${encodeURIComponent(cameraSlug)}`}
              alt=""
              className="absolute inset-0 w-full h-full object-contain opacity-70"
            />
            <div className="absolute bottom-2 right-2">
              <Loader2 className="h-4 w-4 animate-spin text-white/70" />
            </div>
          </div>
        )}

        {/* Full loading spinner (no snapshot available or grace expired) */}
        {showFullSpinner && (
          <div className="absolute inset-0 flex items-center justify-center bg-black">
            <Loader2 className="h-8 w-8 animate-spin text-white/40" />
          </div>
        )}

        {/* Live video stream */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={cn(
            "absolute inset-0 w-full h-full object-contain transition-opacity duration-300",
            isLive ? "opacity-100" : "opacity-0 pointer-events-none"
          )}
        />

        {/* Server-confirmed offline — auto-recovers via health poll */}
        {showFullOffline && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/90">
            <VideoOff className="h-8 w-8 text-red-400/80" />
            <span className="text-xs font-medium text-red-400/80">Camera offline</span>
          </div>
        )}

        {/* Client-side offline (server hasn't confirmed down) */}
        {showClientOffline && (
          <button
            onClick={handleRetry}
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black"
          >
            <VideoOff className="h-8 w-8 text-white/60" />
            <span className="text-xs text-white/60">Tap to retry</span>
          </button>
        )}
      </div>
    </div>
  );
});
