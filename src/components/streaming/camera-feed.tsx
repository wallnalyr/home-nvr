"use client";

import { memo, useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Loader2, VideoOff } from "lucide-react";
import { useGo2rtcStream } from "@/hooks/use-go2rtc-stream";

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
  const isOffline = serverOffline || status === "offline";

  // Auto-retry when server health says camera is online but client gave up.
  // Covers two cases:
  // 1. Server transitions offline → online (camera recovered)
  // 2. Client exhausted retries before server health data loaded
  const prevServerOfflineRef = useRef<boolean | undefined>(serverOffline);
  useEffect(() => {
    const prev = prevServerOfflineRef.current;
    prevServerOfflineRef.current = serverOffline;
    if (serverOffline === false && prev !== false && status === "offline") {
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

    // iOS fires on the video element, others on document
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

    // Unmute immediately within the user gesture so the browser allows it.
    // The fullscreenchange listener is async and may be outside gesture context.
    video.muted = false;

    // Enter native fullscreen on the video element
    if ("webkitEnterFullscreen" in video) {
      // iOS Safari — native video fullscreen
      (video as HTMLVideoElement & { webkitEnterFullscreen: () => void }).webkitEnterFullscreen();
    } else if (video.requestFullscreen) {
      video.requestFullscreen().catch(() => {
        // Fullscreen denied — re-mute since we're still in grid view
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
        {isOffline ? (
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
        {/* Loading spinner while connecting (only when server says camera is up) */}
        {status === "connecting" && !serverOffline && (
          <div className="absolute inset-0 flex items-center justify-center bg-black">
            <Loader2 className="h-8 w-8 animate-spin text-white/40" />
          </div>
        )}

        {/* Live video stream — always muted in grid, unmuted in native fullscreen */}
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

        {/* Offline state — server confirmed camera is down */}
        {isOffline && (
          <button
            onClick={handleRetry}
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/90"
          >
            <VideoOff className="h-8 w-8 text-red-400/80" />
            <span className="text-xs font-medium text-red-400/80">Camera offline</span>
            <span className="text-[10px] text-white/40">Tap to retry</span>
          </button>
        )}

        {/* Client-side offline (stream failed but server hasn't confirmed down) */}
        {status === "offline" && !serverOffline && (
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
