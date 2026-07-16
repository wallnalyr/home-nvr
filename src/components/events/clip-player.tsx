"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Clock, Loader2, VideoOff } from "lucide-react";
import { ZoomableVideoShell } from "@/components/video/zoomable-video-shell";

type ClipState = "loading" | "playing" | "error" | "expired";

const MAX_RETRIES = 8;
const RETRY_INTERVAL = 3000;

interface ClipPlayerProps {
  eventId: string;
}

export function ClipPlayer({ eventId }: ClipPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<{ destroy: () => void } | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);
  const [state, setState] = useState<ClipState>("loading");

  const cleanup = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    hlsRef.current?.destroy();
    hlsRef.current = null;
  }, []);

  const loadClip = useCallback(() => {
    const video = videoRef.current;
    if (!video || cancelledRef.current) return;

    cleanup();
    setState("loading");

    const hlsUrl = `/api/frigate/vod/event/${encodeURIComponent(eventId)}/master.m3u8`;

    import("hls.js").then(({ default: Hls }) => {
      if (cancelledRef.current || !video) return;

      const scheduleRetry = () => {
        if (cancelledRef.current) return;
        if (retryCountRef.current < MAX_RETRIES) {
          retryCountRef.current++;
          retryTimerRef.current = setTimeout(() => {
            if (!cancelledRef.current) loadClip();
          }, RETRY_INTERVAL);
        } else {
          setState("expired");
        }
      };

      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          maxLoadingDelay: 4,
          fragLoadingMaxRetry: 3,
          manifestLoadingMaxRetry: 3,
        });
        hlsRef.current = hls;

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (!cancelledRef.current) {
            retryCountRef.current = 0;
            setState("playing");
            video.play().catch(() => {});
          }
        });

        hls.on(Hls.Events.ERROR, (_, data) => {
          if (cancelledRef.current) return;
          if (data.fatal) {
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              if (data.response?.code === 404) {
                // Clip not ready yet (event still in progress) — retry
                hls.destroy();
                hlsRef.current = null;
                scheduleRetry();
              } else {
                hls.startLoad();
              }
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              hls.recoverMediaError();
            } else {
              setState("error");
              hls.destroy();
            }
          }
        });

        hls.loadSource(hlsUrl);
        hls.attachMedia(video);
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        // Native HLS (Safari / iOS)
        video.src = hlsUrl;
        const onCanPlay = () => {
          if (!cancelledRef.current) {
            retryCountRef.current = 0;
            setState("playing");
            video.play().catch(() => {});
          }
          video.removeEventListener("canplay", onCanPlay);
        };
        const onError = () => {
          video.removeEventListener("error", onError);
          video.removeAttribute("src");
          video.load();
          scheduleRetry();
        };
        video.addEventListener("canplay", onCanPlay);
        video.addEventListener("error", onError);
      } else {
        setState("error");
      }
    });
  }, [eventId, cleanup]);

  useEffect(() => {
    cancelledRef.current = false;
    retryCountRef.current = 0;
    loadClip();

    return () => {
      cancelledRef.current = true;
      cleanup();
    };
  }, [loadClip, cleanup]);

  return (
    <ZoomableVideoShell
      videoRef={videoRef}
      playing={state === "playing"}
      poster={`/api/frigate/events/${eventId}/snapshot`}
      startMuted
    >
      {state === "loading" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/70">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="text-xs">
            {retryCountRef.current > 0
              ? "Waiting for recording..."
              : "Loading clip..."}
          </span>
        </div>
      )}
      {state === "expired" && (
        <div className="absolute inset-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/frigate/events/${eventId}/snapshot`}
            alt="Event snapshot"
            className="absolute inset-0 w-full h-full object-contain"
          />
          <div className="absolute bottom-2 left-0 right-0 flex justify-center">
            <span className="bg-black/60 text-white/70 text-[11px] px-2.5 py-1 rounded-full flex items-center gap-1.5">
              <Clock className="h-3 w-3" />
              Clip expired — showing snapshot
            </span>
          </div>
        </div>
      )}
      {state === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/50">
          <VideoOff className="h-8 w-8" />
          <span className="text-xs">Failed to load clip</span>
        </div>
      )}
    </ZoomableVideoShell>
  );
}
