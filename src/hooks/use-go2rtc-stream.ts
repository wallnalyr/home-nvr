"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type StreamStatus = "connecting" | "live" | "offline";
export type StreamMethod = "mse" | "webrtc" | null;

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000];

const MSE_TIMEOUT = 4000;
const WEBRTC_TIMEOUT = 5000;

const BUFFER_TRIM_INTERVAL = 2000;
const BUFFER_KEEP_SECONDS = 3;

// Playback rate catchup thresholds
const CATCHUP_THRESHOLD = 0.5; // start catching up when >0.5s behind
const CATCHUP_HIGH = 1.5; // aggressive catchup when >1.5s behind
const CATCHUP_SEEK = 4; // hard seek when >4s behind (something went very wrong)
const RATE_NORMAL = 1.0;
const RATE_GENTLE = 1.05;
const RATE_AGGRESSIVE = 1.1;

// Stall detection
const MAX_STALLS = 3;
const STALL_WINDOW_MS = 30000;

const isSafari =
  typeof navigator !== "undefined" &&
  /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

/**
 * Build a codec preference string for the MSE handshake.
 * go2rtc uses this to select the best codec match for the browser.
 */
function getSupportedCodecs(): string {
  if (typeof window === "undefined" || !("MediaSource" in window)) return "";

  const candidates = [
    // H.264 profiles (High, Main, Baseline)
    "avc1.640029",
    "avc1.64002A",
    "avc1.640033",
    "avc1.4D4029",
    "avc1.42E01E",
    // H.265
    "hvc1.1.6.L153.B0",
    // Audio
    "mp4a.40.2", // AAC-LC
    "mp4a.40.5", // AAC-HE
    "flac",
    "opus",
  ];

  const supported = candidates.filter((codec) => {
    try {
      return MediaSource.isTypeSupported(
        codec.startsWith("hvc1") || codec.startsWith("avc1")
          ? `video/mp4; codecs="${codec}"`
          : `audio/mp4; codecs="${codec}"`
      );
    } catch {
      return false;
    }
  });

  return supported.join(",");
}

export function useGo2rtcStream(slug: string) {
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const [method, setMethod] = useState<StreamMethod>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const msRef = useRef<MediaSource | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trimTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveRef = useRef(false);
  const slugRef = useRef(slug);
  slugRef.current = slug;

  // Stall tracking
  const stallTimesRef = useRef<number[]>([]);

  // Fullscreen tracking — prevents visibilitychange from tearing down streams
  const fullscreenRef = useRef(false);

  // Track when stream went live — only reset retry count after stable for 5s
  const liveAtRef = useRef<number>(0);
  const stableTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connectRef = useRef<() => void>(() => {});
  const scheduleRetryRef = useRef<() => void>(() => {});

  const cleanup = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (stableTimerRef.current) {
      clearTimeout(stableTimerRef.current);
      stableTimerRef.current = null;
    }
    if (trimTimerRef.current) {
      clearInterval(trimTimerRef.current);
      trimTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onerror = null;
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    if (msRef.current?.readyState === "open") {
      try { msRef.current.endOfStream(); } catch { /* ignore */ }
    }
    msRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    const video = videoRef.current;
    if (video) {
      video.playbackRate = RATE_NORMAL;
      video.srcObject = null;
      video.removeAttribute("src");
      video.load();
      video.onplaying = null;
      video.onstalled = null;
      video.onwaiting = null;
    }
    liveRef.current = false;
    stallTimesRef.current = [];
  }, []);

  const markLive = useCallback((streamMethod: StreamMethod) => {
    liveRef.current = true;
    liveAtRef.current = Date.now();
    setMethod(streamMethod);
    setStatus("live");
    // Only reset retry count after stream is stable for 5 seconds.
    // Prevents infinite retry loops from cameras that connect briefly then drop.
    if (stableTimerRef.current) clearTimeout(stableTimerRef.current);
    stableTimerRef.current = setTimeout(() => {
      if (liveRef.current) {
        retryCountRef.current = 0;
      }
    }, 5000);
  }, []);

  // --- MSE Connection ---
  const connectMSE = useCallback((): Promise<boolean> => {
    return new Promise((resolve) => {
      const video = videoRef.current;
      if (!video || !("MediaSource" in window)) {
        resolve(false);
        return;
      }

      const ms = new MediaSource();
      msRef.current = ms;
      video.src = URL.createObjectURL(ms);

      let resolved = false;
      const fail = () => {
        if (!resolved) { resolved = true; resolve(false); }
      };

      const timeout = setTimeout(fail, MSE_TIMEOUT);

      ms.addEventListener("sourceopen", () => {
        const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${wsProtocol}//${window.location.host}/go2rtc/api/ws?src=${encodeURIComponent(slugRef.current)}`;

        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;
        ws.binaryType = "arraybuffer";

        let sourceBuffer: SourceBuffer | null = null;
        const queue: ArrayBuffer[] = [];

        ws.onopen = () => {
          const codecs = getSupportedCodecs();
          ws.send(JSON.stringify({
            type: "mse",
            ...(codecs ? { value: codecs } : {}),
          }));
        };

        ws.onmessage = (event) => {
          if (typeof event.data === "string") {
            try {
              const msg = JSON.parse(event.data);
              if (msg.type === "mse" && msg.value) {
                sourceBuffer = ms.addSourceBuffer(msg.value);
                sourceBuffer.mode = "segments";
                sourceBuffer.addEventListener("updateend", () => {
                  if (queue.length > 0 && sourceBuffer && !sourceBuffer.updating) {
                    sourceBuffer.appendBuffer(queue.shift()!);
                  }
                });
              }
            } catch {
              fail();
            }
            return;
          }

          if (!sourceBuffer) return;

          if (sourceBuffer.updating || queue.length > 0) {
            if (queue.length < 30) {
              queue.push(event.data);
            }
          } else {
            try {
              sourceBuffer.appendBuffer(event.data);
            } catch {
              try {
                if (sourceBuffer.buffered.length > 0) {
                  const end = sourceBuffer.buffered.end(sourceBuffer.buffered.length - 1);
                  sourceBuffer.remove(0, end - BUFFER_KEEP_SECONDS);
                }
              } catch { /* ignore */ }
            }
          }
        };

        ws.onerror = fail;
        ws.onclose = () => {
          if (liveRef.current) {
            liveRef.current = false;
            setStatus("connecting");
            scheduleRetryRef.current();
          }
          fail();
        };

        // Stall detection — reconnect after repeated stalls
        const onStall = () => {
          if (!liveRef.current) return;
          const now = Date.now();
          stallTimesRef.current.push(now);
          // Keep only stalls within the window
          stallTimesRef.current = stallTimesRef.current.filter(
            (t) => now - t < STALL_WINDOW_MS
          );
          if (stallTimesRef.current.length >= MAX_STALLS) {
            stallTimesRef.current = [];
            liveRef.current = false;
            setStatus("connecting");
            scheduleRetryRef.current();
          }
        };
        video.onstalled = onStall;
        video.onwaiting = onStall;

        video.onplaying = () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            resolve(true);
          }
          markLive("mse");
        };

        video.play().catch(() => {});

        // Buffer management + playback rate catchup
        trimTimerRef.current = setInterval(() => {
          if (!sourceBuffer || sourceBuffer.updating) return;
          try {
            // Trim old buffered data
            if (sourceBuffer.buffered.length > 0) {
              const start = sourceBuffer.buffered.start(0);
              const end = sourceBuffer.buffered.end(sourceBuffer.buffered.length - 1);
              if (end - start > BUFFER_KEEP_SECONDS * 2) {
                sourceBuffer.remove(start, end - BUFFER_KEEP_SECONDS);
              }
            }

            // Playback rate catchup to stay near live edge
            if (video.buffered.length > 0) {
              const liveEdge = video.buffered.end(video.buffered.length - 1);
              const behind = liveEdge - video.currentTime;

              if (behind > CATCHUP_SEEK) {
                // Way too far behind — hard seek (Safari or extreme drift)
                video.currentTime = liveEdge - 0.2;
                video.playbackRate = RATE_NORMAL;
              } else if (isSafari) {
                // Safari doesn't handle variable playback rate well — seek instead
                if (behind > CATCHUP_HIGH) {
                  video.currentTime = liveEdge - 0.2;
                }
              } else {
                // Smooth playback rate adjustment for Chrome/Firefox
                if (behind > CATCHUP_HIGH) {
                  video.playbackRate = RATE_AGGRESSIVE;
                } else if (behind > CATCHUP_THRESHOLD) {
                  video.playbackRate = RATE_GENTLE;
                } else {
                  video.playbackRate = RATE_NORMAL;
                }
              }
            }
          } catch { /* ignore */ }
        }, BUFFER_TRIM_INTERVAL);
      });

      ms.addEventListener("error", fail);
    });
  }, [markLive]);

  // --- WebRTC Connection ---
  const connectWebRTC = useCallback((): Promise<boolean> => {
    return new Promise((resolve) => {
      const video = videoRef.current;
      if (!video) { resolve(false); return; }

      const controller = new AbortController();
      abortRef.current = controller;
      const { signal } = controller;

      let resolved = false;
      const fail = () => {
        if (!resolved) { resolved = true; resolve(false); }
      };

      const timeout = setTimeout(fail, WEBRTC_TIMEOUT);

      (async () => {
        try {
          const pc = new RTCPeerConnection({
            iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
          });
          pcRef.current = pc;

          if (signal.aborted) { pc.close(); fail(); return; }

          pc.addTransceiver("video", { direction: "recvonly" });
          pc.addTransceiver("audio", { direction: "recvonly" });

          pc.ontrack = (event) => {
            if (event.streams[0]) {
              video.srcObject = event.streams[0];
              video.play().catch(() => {});
            }
          };

          pc.onconnectionstatechange = () => {
            if (signal.aborted) return;
            if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
              if (liveRef.current) {
                liveRef.current = false;
                setStatus("connecting");
                scheduleRetryRef.current();
              }
              fail();
            }
          };

          video.onplaying = () => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              resolve(true);
            }
            markLive("webrtc");
          };

          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          if (signal.aborted) { pc.close(); fail(); return; }

          const res = await fetch(
            `/api/go2rtc/webrtc?src=${encodeURIComponent(slugRef.current)}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/sdp" },
              body: pc.localDescription?.sdp,
              signal,
            }
          );

          if (!res.ok) { pc.close(); pcRef.current = null; fail(); return; }

          const answer = await res.text();
          if (signal.aborted) { pc.close(); fail(); return; }

          await pc.setRemoteDescription(
            new RTCSessionDescription({ type: "answer", sdp: answer })
          );
        } catch {
          fail();
        }
      })();
    });
  }, [markLive]);

  // --- Cascade: MSE → WebRTC ---
  const connect = useCallback(async () => {
    cleanup();
    setStatus("connecting");
    setMethod(null);
    liveRef.current = false;

    // Try MSE first (smooth, buffered — what production NVRs use)
    const mseOk = await connectMSE();
    if (mseOk) return;

    // MSE failed — clean up and try WebRTC
    cleanup();
    setStatus("connecting");

    const webrtcOk = await connectWebRTC();
    if (webrtcOk) return;

    // Both failed
    scheduleRetryRef.current();
  }, [cleanup, connectMSE, connectWebRTC]);

  connectRef.current = connect;

  const scheduleRetry = useCallback(() => {
    if (retryCountRef.current >= MAX_RETRIES) {
      setStatus("offline");
      return;
    }
    const delay = RETRY_DELAYS[Math.min(retryCountRef.current, RETRY_DELAYS.length - 1)];
    retryCountRef.current++;
    setStatus("connecting");
    retryTimerRef.current = setTimeout(() => {
      connectRef.current();
    }, delay);
  }, []);

  scheduleRetryRef.current = scheduleRetry;

  const retry = useCallback(() => {
    retryCountRef.current = 0;
    connectRef.current();
  }, []);

  // Recover playback after fullscreen exit — seek to live edge, play,
  // and fall back to full reconnect if playback doesn't resume quickly.
  const recover = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    // Seek to live edge if we have buffered data
    try {
      if (video.buffered.length > 0) {
        video.currentTime = video.buffered.end(video.buffered.length - 1) - 0.1;
      }
    } catch { /* ignore */ }

    video.play().catch(() => {});

    // If video doesn't resume within 500ms, force a full reconnect
    const check = setTimeout(() => {
      if (video.paused || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        retryCountRef.current = 0;
        connectRef.current();
      }
    }, 500);

    // Clear the timeout if playing fires quickly
    const onPlaying = () => {
      clearTimeout(check);
      video.removeEventListener("playing", onPlaying);
    };
    video.addEventListener("playing", onPlaying);
  }, []);

  const setFullscreen = useCallback((active: boolean) => {
    fullscreenRef.current = active;
  }, []);

  // Initial connection
  useEffect(() => {
    connectRef.current();
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pause on tab hide, reconnect on tab visible.
  // Skip during fullscreen transitions — iOS fires visibilitychange when
  // entering/exiting native fullscreen, which would tear down the stream.
  useEffect(() => {
    const handleVisibility = () => {
      if (fullscreenRef.current) return;
      if (document.visibilityState === "hidden") {
        cleanup();
      } else {
        retryCountRef.current = 0;
        connectRef.current();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [cleanup]);

  return { status, method, videoRef, retry, recover, setFullscreen };
}
