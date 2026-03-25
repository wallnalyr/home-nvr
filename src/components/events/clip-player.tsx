"use client";

import { useEffect, useRef, useState } from "react";
import { Clock, Loader2, VideoOff } from "lucide-react";

type ClipState = "loading" | "playing" | "error" | "expired";

interface ClipPlayerProps {
  eventId: string;
}

export function ClipPlayer({ eventId }: ClipPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<{ destroy: () => void } | null>(null);
  const [state, setState] = useState<ClipState>("loading");

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    setState("loading");
    let cancelled = false;

    // Use Frigate's HLS/VOD endpoint for event clips.
    // This avoids MP4 Range request issues — HLS uses small .ts segments.
    const hlsUrl = `/api/frigate/vod/event/${encodeURIComponent(eventId)}/master.m3u8`;

    import("hls.js").then(({ default: Hls }) => {
      if (cancelled || !video) return;

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
          if (!cancelled) {
            setState("playing");
            video.play().catch(() => {});
          }
        });

        hls.on(Hls.Events.ERROR, (_, data) => {
          if (cancelled) return;
          if (data.fatal) {
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              if (data.response?.code === 404) {
                setState("expired");
              } else {
                // Retry network errors once
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
          if (!cancelled) {
            setState("playing");
            video.play().catch(() => {});
          }
          video.removeEventListener("canplay", onCanPlay);
        };
        const onError = () => {
          if (!cancelled) {
            setState("expired");
          }
          video.removeEventListener("error", onError);
        };
        video.addEventListener("canplay", onCanPlay);
        video.addEventListener("error", onError);
      } else {
        setState("error");
      }
    });

    return () => {
      cancelled = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [eventId]);

  return (
    <div className="camera-feed-container rounded-xl overflow-hidden bg-black">
      <video
        ref={videoRef}
        poster={`/api/frigate/events/${eventId}/snapshot`}
        muted
        controls
        playsInline
        className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-300 ${
          state === "playing" ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      />
      {state === "loading" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/70">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="text-xs">Loading clip...</span>
        </div>
      )}
      {state === "expired" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/50">
          <Clock className="h-8 w-8" />
          <span className="text-xs">Recording expired</span>
          <span className="text-xs text-white/30">
            The clip is no longer available
          </span>
        </div>
      )}
      {state === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/50">
          <VideoOff className="h-8 w-8" />
          <span className="text-xs">Failed to load clip</span>
        </div>
      )}
    </div>
  );
}
