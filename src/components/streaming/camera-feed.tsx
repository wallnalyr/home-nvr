"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Loader2, VideoOff, Volume2, VolumeX, X } from "lucide-react";
import { useGo2rtcStream } from "@/hooks/use-go2rtc-stream";
import { usePinchZoom } from "@/hooks/use-pinch-zoom";

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

  // --- Fullscreen with pinch-zoom ---
  //
  // iOS native video fullscreen (webkitEnterFullscreen) hands the video
  // to the system player, where CSS transforms — and therefore
  // pinch-zoom — cannot work. Instead the feed expands into a fixed
  // overlay that stays in the web rendering context. The video element
  // never moves in the DOM, so the WebRTC/MSE stream is not
  // interrupted. Where element fullscreen is supported (iPad, desktop)
  // the CONTAINER is additionally fullscreened natively — transforms
  // inside it keep working.
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [muted, setMuted] = useState(true);
  const {
    containerRef: zoomContainerRef,
    targetRef: zoomTargetRef,
    handlers: zoomHandlers,
  } = usePinchZoom(isFullscreen);

  // iOS blocks play() on an unmuted video outside a user gesture. If
  // the stream reconnects mid-fullscreen (stall retry, network blip),
  // the retry's play() would be rejected and the feed would die into
  // "offline". Mute before the reconnect lands; the user can unmute
  // again with the sound button.
  const [prevStatus, setPrevStatus] = useState(status);
  if (status !== prevStatus) {
    setPrevStatus(status);
    if (isFullscreen && status !== "live" && !muted) setMuted(true);
  }

  // Keep the video element in sync with muted state (handlers also set
  // it directly so the change lands inside the same user gesture)
  useEffect(() => {
    const video = videoRef.current;
    if (video) video.muted = muted;
  }, [muted, videoRef]);

  const enterFullscreen = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    setIsFullscreen(true);
    setFullscreen(true);

    // Unmute + play inside the tap gesture — required by the iOS
    // autoplay policy for any audio start. If it still rejects, fall
    // back to muted; the sound button retries inside its own gesture.
    video.muted = false;
    setMuted(false);
    video.play().catch(() => {
      video.muted = true;
      setMuted(true);
    });

    // Element fullscreen is unavailable on iPhone — the CSS overlay
    // alone is the fullscreen experience there.
    const el = zoomContainerRef.current;
    if (el?.requestFullscreen) {
      el.requestFullscreen().catch(() => {});
    }
  }, [videoRef, setFullscreen, zoomContainerRef]);

  const exitFullscreen = useCallback(() => {
    const video = videoRef.current;
    if (video) video.muted = true;
    setMuted(true);
    setIsFullscreen(false);
    setFullscreen(false);
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    recover();
  }, [videoRef, setFullscreen, recover]);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (muted) {
      video.muted = false;
      setMuted(false);
      video.play().catch(() => {
        video.muted = true;
        setMuted(true);
      });
    } else {
      video.muted = true;
      setMuted(true);
    }
  }, [videoRef, muted]);

  // Follow native fullscreen exits (Escape key, system gesture)
  useEffect(() => {
    if (!isFullscreen) return;
    const onChange = () => {
      if (!document.fullscreenElement) exitFullscreen();
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [isFullscreen, exitFullscreen]);

  // Backgrounding the app tears down streams (visibilitychange in the
  // stream hook). Exit fullscreen so the reconnect on return starts
  // muted and is allowed to autoplay.
  useEffect(() => {
    if (!isFullscreen) return;
    const onVis = () => {
      if (document.visibilityState === "hidden") exitFullscreen();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [isFullscreen, exitFullscreen]);

  const handleRetry = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      retry();
    },
    [retry]
  );

  // Keep grid scroll + pull-to-refresh blind to fullscreen gestures
  const stopTouch = useCallback((e: React.TouchEvent) => e.stopPropagation(), []);
  const stopPointer = useCallback((e: React.PointerEvent) => e.stopPropagation(), []);

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

      {/* Camera feed — expands into a fixed overlay in fullscreen */}
      <div
        ref={zoomContainerRef}
        className={cn(
          isFullscreen
            ? "fixed inset-0 z-[60] bg-black touch-none select-none overscroll-none"
            : "camera-feed-container shadow-sm rounded-xl overflow-hidden cursor-pointer"
        )}
        onClick={!isFullscreen && isLive ? enterFullscreen : undefined}
        role={!isFullscreen && isLive ? "button" : undefined}
        tabIndex={!isFullscreen && isLive ? 0 : undefined}
        {...(isFullscreen
          ? {
              ...zoomHandlers,
              onTouchStart: stopTouch,
              onTouchMove: stopTouch,
              onTouchEnd: stopTouch,
            }
          : {})}
      >
        {/* Zoom target: snapshot + video transform together */}
        <div
          ref={zoomTargetRef}
          className={cn("absolute inset-0", isFullscreen && "will-change-transform")}
        >
          {/* Grace period: last snapshot while reconnecting */}
          {inGracePeriod && (
            <div className="absolute inset-0 bg-black">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/go2rtc/frame?src=${encodeURIComponent(cameraSlug)}`}
                alt=""
                className="absolute inset-0 w-full h-full object-contain opacity-70"
              />
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
        </div>

        {/* Grace period spinner (kept outside the zoom target) */}
        {inGracePeriod && (
          <div className="absolute bottom-2 right-2">
            <Loader2 className="h-4 w-4 animate-spin text-white/70" />
          </div>
        )}

        {/* Full loading spinner (no snapshot available or grace expired) */}
        {showFullSpinner && (
          <div className="absolute inset-0 flex items-center justify-center bg-black">
            <Loader2 className="h-8 w-8 animate-spin text-white/40" />
          </div>
        )}

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
            onPointerDown={stopPointer}
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black"
          >
            <VideoOff className="h-8 w-8 text-white/60" />
            <span className="text-xs text-white/60">Tap to retry</span>
          </button>
        )}

        {/* Fullscreen chrome: name, sound toggle, close */}
        {isFullscreen && (
          <div
            className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between gap-2 px-4 pb-8 bg-gradient-to-b from-black/60 to-transparent"
            style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
            onPointerDown={stopPointer}
          >
            <span className="text-sm font-semibold text-white/90 truncate">
              {cameraName}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleMute();
                }}
                aria-label={muted ? "Unmute" : "Mute"}
                className="flex items-center justify-center h-10 w-10 rounded-full bg-black/50 text-white/80 backdrop-blur-sm"
              >
                {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  exitFullscreen();
                }}
                aria-label="Exit fullscreen"
                className="flex items-center justify-center h-10 w-10 rounded-full bg-black/50 text-white/80 backdrop-blur-sm"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
