"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, VideoOff } from "lucide-react";

interface RecordingPlayerProps {
  camera: string;
  startTime: number;
  endTime: number;
}

type PlayerState = "loading" | "playing" | "error" | "no-recording";

export function RecordingPlayer({
  camera,
  startTime,
  endTime,
}: RecordingPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<{ destroy: () => void } | null>(null);
  const [playerState, setPlayerState] = useState<PlayerState>("loading");

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    setPlayerState("loading");

    const url = `/api/frigate/vod/${encodeURIComponent(camera)}/start/${startTime}/end/${endTime}/index.m3u8`;

    let cancelled = false;

    fetch(url, { method: "HEAD" })
      .then((headRes) => {
        if (cancelled) return;

        if (!headRes.ok) {
          setPlayerState("no-recording");
          return;
        }

        import("hls.js").then(({ default: Hls }) => {
          if (cancelled || !video) return;

          if (Hls.isSupported()) {
            const hls = new Hls({
              enableWorker: true,
              lowLatencyMode: false,
              maxBufferLength: 30,
              maxMaxBufferLength: 60,
            });
            hlsRef.current = hls;

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              if (!cancelled) {
                setPlayerState("playing");
                video.play().catch(() => {});
              }
            });

            hls.on(Hls.Events.ERROR, (_, data) => {
              if (data.fatal) {
                if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                  if (data.response?.code === 404) {
                    setPlayerState("no-recording");
                  } else {
                    hls.startLoad();
                  }
                } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                  hls.recoverMediaError();
                } else {
                  setPlayerState("error");
                  hls.destroy();
                }
              }
            });

            hls.loadSource(url);
            hls.attachMedia(video);
          } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
            // Native HLS (Safari / iOS)
            video.src = url;
            const onCanPlay = () => {
              if (!cancelled) {
                setPlayerState("playing");
                video.play().catch(() => {});
              }
              video.removeEventListener("canplay", onCanPlay);
            };
            const onNativeError = () => {
              if (!cancelled) {
                setPlayerState("no-recording");
              }
              video.removeEventListener("error", onNativeError);
            };
            video.addEventListener("canplay", onCanPlay);
            video.addEventListener("error", onNativeError);
          }
        });
      })
      .catch(() => {
        if (!cancelled) {
          setPlayerState("error");
        }
      });

    return () => {
      cancelled = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [camera, startTime, endTime]);

  return (
    <div className="camera-feed-container rounded-xl overflow-hidden bg-black">
      <video
        ref={videoRef}
        controls
        playsInline
        className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-300 ${
          playerState === "playing"
            ? "opacity-100"
            : "opacity-0 pointer-events-none"
        }`}
      />
      {playerState === "loading" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/70">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="text-xs">Loading recording...</span>
        </div>
      )}
      {playerState === "no-recording" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/50">
          <VideoOff className="h-8 w-8" />
          <span className="text-xs">No recording available</span>
        </div>
      )}
      {playerState === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/50">
          <AlertCircle className="h-8 w-8" />
          <span className="text-xs">Failed to load recording</span>
        </div>
      )}
    </div>
  );
}
