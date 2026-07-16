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
  /** Parent player state — gates the expand button and video visibility */
  playing: boolean;
  poster?: string;
  startMuted?: boolean;
  /** Shown in the fullscreen top bar */
  title?: string;
  /** Status overlays (loading / error / etc.) — rendered above the video */
  children?: React.ReactNode;
}

/**
 * Shared inline-player shell with a pinch-zoomable fullscreen mode.
 *
 * Inline it renders the video with native browser controls. The expand
 * button switches the same container to a fixed overlay — the video
 * element never moves in the DOM, so HLS playback is not interrupted.
 * In fullscreen, native controls are swapped for custom ones: native
 * controls render inside the video element's box and would scale and
 * drift along with the pinch-zoom transform. Same overlay/gesture/audio
 * approach as the live CameraFeed.
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

  // Playback state mirrored for the custom fullscreen controls
  const [paused, setPaused] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState(0);

  useEffect(() => {
    if (!isFullscreen) return;
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
  }, [isFullscreen, scrubbing, videoRef]);

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
      >
        <video
          ref={videoRef}
          poster={poster}
          muted={startMuted}
          controls={!isFullscreen}
          controlsList="nofullscreen"
          playsInline
          className={cn(
            "absolute inset-0 w-full h-full object-contain transition-opacity duration-300",
            playing ? "opacity-100" : "opacity-0 pointer-events-none"
          )}
        />
      </div>

      {/* Parent status overlays (loading / error / expired snapshot) */}
      {children}

      {/* Inline expand button */}
      {!isFullscreen && playing && (
        <button
          onClick={enterFullscreen}
          aria-label="Fullscreen"
          className="absolute top-2 right-2 z-10 flex items-center justify-center h-9 w-9 rounded-full bg-black/50 text-white/80 backdrop-blur-sm"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      )}

      {/* Fullscreen chrome */}
      {isFullscreen && (
        <>
          {/* Top bar: title, sound, close */}
          <div
            className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between gap-2 px-4 pb-8 bg-gradient-to-b from-black/60 to-transparent"
            style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
            onPointerDown={stopPointer}
          >
            <span className="text-sm font-semibold text-white/90 truncate">
              {title}
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

          {/* Bottom bar: play/pause, scrubber, time */}
          <div
            className="absolute bottom-0 left-0 right-0 z-10 flex items-center gap-3 px-4 pt-8 bg-gradient-to-t from-black/60 to-transparent"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
            onPointerDown={stopPointer}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                togglePlay();
              }}
              aria-label={paused ? "Play" : "Pause"}
              className="flex items-center justify-center h-10 w-10 shrink-0 rounded-full bg-black/50 text-white/90 backdrop-blur-sm"
            >
              {paused ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
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
              className="flex-1 h-1.5 accent-white cursor-pointer"
            />
            <span className="text-xs tabular-nums text-white/80 shrink-0">
              {formatTime(scrubbing ? scrubTime : currentTime)} / {formatTime(duration)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
