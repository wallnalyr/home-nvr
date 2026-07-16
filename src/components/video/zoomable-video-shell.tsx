"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  Maximize2,
  Pause,
  Play,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { usePinchZoom } from "@/hooks/use-pinch-zoom";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? h + ":" : ""}${mm}:${String(s).padStart(2, "0")}`;
}

interface ZoomableVideoShellProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Parent player state — media is loaded and watchable */
  playing: boolean;
  poster?: string;
  startMuted?: boolean;
  /** Shown in the fullscreen top bar */
  title?: string;
  /** Status overlays (loading / error / etc.) — rendered above the video */
  children?: React.ReactNode;
}

/**
 * Video player shell with custom controls and a pinch-zoomable
 * fullscreen mode. One control bar (play/pause, scrubber, time, mute,
 * expand) serves both inline and fullscreen — native browser controls
 * are never used: they render inside the video element's box, so the
 * fullscreen pinch transform would scale and drift them, and the iOS
 * native fullscreen button would route around our zoomable overlay.
 *
 * The video element never moves in the DOM between modes, so HLS
 * playback is not interrupted. Pinch-zoom is fullscreen-only: inline
 * gestures inside a scrollable page fight scrolling (the cause of the
 * reverted first zoom attempt).
 */
export function ZoomableVideoShell({
  videoRef,
  playing,
  poster,
  startMuted = false,
  title,
  children,
}: ZoomableVideoShellProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [muted, setMuted] = useState(startMuted);
  const {
    containerRef: zoomContainerRef,
    targetRef: zoomTargetRef,
    handlers: zoomHandlers,
  } = usePinchZoom(isFullscreen);

  // Playback state mirrored for the custom controls
  const [paused, setPaused] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTime = () => {
      if (!scrubbing) setCurrentTime(video.currentTime);
    };
    const onDuration = () =>
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
    const onPlayState = () => setPaused(video.paused);
    const onVolume = () => setMuted(video.muted);

    video.addEventListener("timeupdate", onTime);
    video.addEventListener("durationchange", onDuration);
    video.addEventListener("play", onPlayState);
    video.addEventListener("pause", onPlayState);
    video.addEventListener("volumechange", onVolume);

    // Initial sync (async — effects must not set state synchronously)
    const raf = requestAnimationFrame(() => {
      onTime();
      onDuration();
      onPlayState();
      onVolume();
    });

    return () => {
      cancelAnimationFrame(raf);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("durationchange", onDuration);
      video.removeEventListener("play", onPlayState);
      video.removeEventListener("pause", onPlayState);
      video.removeEventListener("volumechange", onVolume);
    };
  }, [scrubbing, videoRef]);

  const enterFullscreen = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    setIsFullscreen(true);

    // Unmute inside the tap gesture (iOS autoplay policy). If the
    // video is mid-playback the play() call makes the audio start
    // reliably; if it rejects, fall back to muted.
    video.muted = false;
    setMuted(false);
    if (!video.paused) {
      video.play().catch(() => {
        video.muted = true;
        setMuted(true);
      });
    }

    // Element fullscreen is unavailable on iPhone — the CSS overlay
    // alone is the fullscreen experience there.
    const el = zoomContainerRef.current;
    if (el?.requestFullscreen) {
      el.requestFullscreen().catch(() => {});
    }
  }, [videoRef, zoomContainerRef]);

  const exitFullscreen = useCallback(() => {
    const video = videoRef.current;
    if (video) video.muted = true;
    setMuted(true);
    setIsFullscreen(false);
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  }, [videoRef]);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (muted) {
      video.muted = false;
      setMuted(false);
      if (!video.paused) {
        video.play().catch(() => {
          video.muted = true;
          setMuted(true);
        });
      }
    } else {
      video.muted = true;
      setMuted(true);
    }
  }, [videoRef, muted]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [videoRef]);

  // Follow native fullscreen exits (Escape key, system gesture)
  useEffect(() => {
    if (!isFullscreen) return;
    const onChange = () => {
      if (!document.fullscreenElement) exitFullscreen();
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [isFullscreen, exitFullscreen]);

  // Exit on backgrounding so any later play() starts muted and allowed
  useEffect(() => {
    if (!isFullscreen) return;
    const onVis = () => {
      if (document.visibilityState === "hidden") exitFullscreen();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [isFullscreen, exitFullscreen]);

  // Keep page scroll and other touch handlers blind to fullscreen gestures
  const stopTouch = useCallback((e: React.TouchEvent) => e.stopPropagation(), []);
  const stopPointer = useCallback((e: React.PointerEvent) => e.stopPropagation(), []);

  const commitScrub = useCallback(() => {
    const video = videoRef.current;
    if (video) video.currentTime = scrubTime;
    setCurrentTime(scrubTime);
    setScrubbing(false);
  }, [videoRef, scrubTime]);

  const barBtn =
    "flex items-center justify-center shrink-0 rounded-full bg-black/50 text-white/90 backdrop-blur-sm";
  const btnSize = isFullscreen ? "h-10 w-10" : "h-8 w-8";
  const iconSize = isFullscreen ? "h-5 w-5" : "h-4 w-4";

  return (
    <div
      ref={zoomContainerRef}
      className={cn(
        isFullscreen
          ? "fixed inset-0 z-[60] bg-black touch-none select-none overscroll-none"
          : "camera-feed-container rounded-xl overflow-hidden bg-black"
      )}
      {...(isFullscreen
        ? {
            ...zoomHandlers,
            onTouchStart: stopTouch,
            onTouchMove: stopTouch,
            onTouchEnd: stopTouch,
          }
        : {})}
    >
      {/* Zoom target — only the video transforms */}
      <div
        ref={zoomTargetRef}
        className={cn("absolute inset-0", isFullscreen && "will-change-transform")}
        onClick={!isFullscreen && playing ? togglePlay : undefined}
      >
        <video
          ref={videoRef}
          poster={poster}
          muted={startMuted}
          playsInline
          className={cn(
            "absolute inset-0 w-full h-full object-contain transition-opacity duration-300",
            playing ? "opacity-100" : "opacity-0 pointer-events-none"
          )}
        />
      </div>

      {/* Parent status overlays (loading / error / expired snapshot) */}
      {children}

      {/* Fullscreen top bar: title + close */}
      {isFullscreen && (
        <div
          className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between gap-2 px-4 pb-8 bg-gradient-to-b from-black/60 to-transparent"
          style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
          onPointerDown={stopPointer}
        >
          <span className="text-sm font-semibold text-white/90 truncate">
            {title}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              exitFullscreen();
            }}
            aria-label="Exit fullscreen"
            className={cn(barBtn, "h-10 w-10 text-white/80")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* Control bar — same controls inline and fullscreen */}
      {playing && (
        <div
          className={cn(
            "absolute bottom-0 left-0 right-0 z-10 flex items-center bg-gradient-to-t from-black/60 to-transparent",
            isFullscreen ? "gap-3 px-4 pt-8" : "gap-2 px-3 pt-6 pb-2"
          )}
          style={
            isFullscreen
              ? { paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }
              : undefined
          }
          onPointerDown={stopPointer}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              togglePlay();
            }}
            aria-label={paused ? "Play" : "Pause"}
            className={cn(barBtn, btnSize)}
          >
            {paused ? <Play className={iconSize} /> : <Pause className={iconSize} />}
          </button>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={scrubbing ? scrubTime : currentTime}
            onPointerDown={(e) => {
              e.stopPropagation();
              setScrubbing(true);
              setScrubTime(currentTime);
            }}
            onChange={(e) => {
              const v = Number(e.target.value);
              setScrubTime(v);
              if (!scrubbing) {
                // Keyboard / non-pointer change — seek immediately
                const video = videoRef.current;
                if (video) video.currentTime = v;
                setCurrentTime(v);
              }
            }}
            onPointerUp={commitScrub}
            onPointerCancel={commitScrub}
            aria-label="Seek"
            className="flex-1 min-w-0 h-1.5 accent-white cursor-pointer touch-none"
          />
          <span
            className={cn(
              "tabular-nums text-white/80 shrink-0",
              isFullscreen ? "text-xs" : "text-[10px]"
            )}
          >
            {formatTime(scrubbing ? scrubTime : currentTime)} / {formatTime(duration)}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleMute();
            }}
            aria-label={muted ? "Unmute" : "Mute"}
            className={cn(barBtn, btnSize, "text-white/80")}
          >
            {muted ? <VolumeX className={iconSize} /> : <Volume2 className={iconSize} />}
          </button>
          {!isFullscreen && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                enterFullscreen();
              }}
              aria-label="Fullscreen"
              className={cn(barBtn, btnSize, "text-white/80")}
            >
              <Maximize2 className={iconSize} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
