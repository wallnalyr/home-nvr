"use client";

import { useCallback, useEffect, useRef } from "react";

const MIN_SCALE = 1;
const MAX_SCALE = 5;
// Allow slight under-zoom during a pinch for a natural rubber-band feel
const UNDERSCALE = 0.85;
const SNAP_BACK_SCALE = 1.05;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP_PX = 30;
const TAP_SLOP_PX = 12;
const DOUBLE_TAP_ZOOM = 2.5;

interface Point {
  x: number;
  y: number;
}

/**
 * Pinch-to-zoom and pan for the fullscreen camera view.
 *
 * Attach `containerRef` + `handlers` to the gesture surface and
 * `targetRef` to the element that should be transformed. The container
 * MUST have `touch-action: none` so the browser hands all gestures to
 * pointer events — this is what lets the hook work without
 * preventDefault (React root touch listeners are passive, so
 * preventDefault in synthetic touch handlers is a no-op; pointer
 * events + touch-action avoid that trap entirely).
 *
 * - Two-finger pinch: zoom 1x-5x anchored between the fingers
 * - One-finger drag while zoomed: pan (clamped to the container)
 * - Double-tap: zoom to 2.5x centered on the tap point, or reset
 *
 * All math assumes the default `transform-origin: center` and a target
 * that fills the container.
 */
export function usePinchZoom(enabled: boolean) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef<HTMLDivElement | null>(null);

  const scaleRef = useRef(1);
  const transRef = useRef<Point>({ x: 0, y: 0 });

  const pointersRef = useRef<Map<number, Point>>(new Map());
  const modeRef = useRef<"none" | "pinch" | "pan">("none");

  // Pinch baseline (state at the moment the second finger lands)
  const startDistRef = useRef(0);
  const startScaleRef = useRef(1);
  const startMidRef = useRef<Point>({ x: 0, y: 0 });
  const startTransRef = useRef<Point>({ x: 0, y: 0 });

  // Pan baseline
  const panStartRef = useRef<Point>({ x: 0, y: 0 });
  const panStartTransRef = useRef<Point>({ x: 0, y: 0 });

  // Tap tracking for double-tap
  const downPosRef = useRef<Point>({ x: 0, y: 0 });
  const movedRef = useRef(false);
  const lastTapAtRef = useRef(0);
  const lastTapPosRef = useRef<Point>({ x: 0, y: 0 });

  const apply = useCallback(() => {
    const el = targetRef.current;
    if (!el) return;
    const s = scaleRef.current;
    const { x, y } = transRef.current;
    el.style.transform =
      s === 1 && x === 0 && y === 0
        ? ""
        : `translate3d(${x}px, ${y}px, 0) scale(${s})`;
  }, []);

  const clampTranslation = useCallback((s: number, t: Point): Point => {
    const el = containerRef.current;
    if (!el || s <= 1) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    const maxX = (rect.width * (s - 1)) / 2;
    const maxY = (rect.height * (s - 1)) / 2;
    return {
      x: Math.min(maxX, Math.max(-maxX, t.x)),
      y: Math.min(maxY, Math.max(-maxY, t.y)),
    };
  }, []);

  const setTransform = useCallback(
    (s: number, t: Point) => {
      scaleRef.current = s;
      transRef.current = clampTranslation(s, t);
      apply();
    },
    [clampTranslation, apply]
  );

  const reset = useCallback(() => {
    pointersRef.current.clear();
    modeRef.current = "none";
    setTransform(1, { x: 0, y: 0 });
  }, [setTransform]);

  // Reset when disabled (leaving fullscreen) and on viewport changes
  // (rotation invalidates the clamp bounds — resetting is predictable)
  useEffect(() => {
    if (!enabled) {
      reset();
      return;
    }
    const onResize = () => reset();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [enabled, reset]);

  const containerCenter = useCallback((): Point => {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!enabled) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Pointer capture unsupported — handlers still receive events
    }
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size === 2) {
      const [p1, p2] = [...pointersRef.current.values()];
      modeRef.current = "pinch";
      movedRef.current = true; // two fingers is never a tap
      startDistRef.current = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
      startScaleRef.current = scaleRef.current;
      startMidRef.current = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      startTransRef.current = { ...transRef.current };
    } else if (pointersRef.current.size === 1) {
      downPosRef.current = { x: e.clientX, y: e.clientY };
      movedRef.current = false;
      if (scaleRef.current > 1) {
        modeRef.current = "pan";
        panStartRef.current = { x: e.clientX, y: e.clientY };
        panStartTransRef.current = { ...transRef.current };
      }
    }
  }, [enabled]);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled || !pointersRef.current.has(e.pointerId)) return;
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (
        !movedRef.current &&
        Math.hypot(
          e.clientX - downPosRef.current.x,
          e.clientY - downPosRef.current.y
        ) > TAP_SLOP_PX
      ) {
        movedRef.current = true;
      }

      if (modeRef.current === "pinch" && pointersRef.current.size >= 2) {
        const [p1, p2] = [...pointersRef.current.values()];
        const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        const s = Math.min(
          MAX_SCALE,
          Math.max(
            MIN_SCALE * UNDERSCALE,
            startScaleRef.current * (dist / startDistRef.current)
          )
        );
        // Anchor the content point that was under the fingers at pinch
        // start, and follow the midpoint as it drags.
        const c = containerCenter();
        const ratio = s / startScaleRef.current;
        setTransform(s, {
          x: mid.x - c.x - ratio * (startMidRef.current.x - c.x - startTransRef.current.x),
          y: mid.y - c.y - ratio * (startMidRef.current.y - c.y - startTransRef.current.y),
        });
      } else if (modeRef.current === "pan") {
        setTransform(scaleRef.current, {
          x: panStartTransRef.current.x + (e.clientX - panStartRef.current.x),
          y: panStartTransRef.current.y + (e.clientY - panStartRef.current.y),
        });
      }
    },
    [enabled, containerCenter, setTransform]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled || !pointersRef.current.has(e.pointerId)) return;
      pointersRef.current.delete(e.pointerId);

      if (modeRef.current === "pinch") {
        if (scaleRef.current < SNAP_BACK_SCALE) {
          setTransform(1, { x: 0, y: 0 });
        }
        if (pointersRef.current.size === 1 && scaleRef.current > 1) {
          // One finger lifted — continue as a pan with the remaining one
          const [p] = [...pointersRef.current.values()];
          modeRef.current = "pan";
          panStartRef.current = p;
          panStartTransRef.current = { ...transRef.current };
        } else if (pointersRef.current.size === 0) {
          modeRef.current = "none";
        }
        return;
      }

      modeRef.current = "none";
      if (movedRef.current) return;

      // Tap: check for double-tap
      const now = Date.now();
      const isDouble =
        now - lastTapAtRef.current < DOUBLE_TAP_MS &&
        Math.hypot(
          e.clientX - lastTapPosRef.current.x,
          e.clientY - lastTapPosRef.current.y
        ) < DOUBLE_TAP_SLOP_PX;

      if (isDouble) {
        lastTapAtRef.current = 0;
        if (scaleRef.current > 1) {
          setTransform(1, { x: 0, y: 0 });
        } else {
          // Zoom in, bringing the tapped point to the center
          const c = containerCenter();
          setTransform(DOUBLE_TAP_ZOOM, {
            x: -DOUBLE_TAP_ZOOM * (e.clientX - c.x),
            y: -DOUBLE_TAP_ZOOM * (e.clientY - c.y),
          });
        }
      } else {
        lastTapAtRef.current = now;
        lastTapPosRef.current = { x: e.clientX, y: e.clientY };
      }
    },
    [enabled, containerCenter, setTransform]
  );

  const onPointerCancel = useCallback((e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size === 0) modeRef.current = "none";
  }, []);

  return {
    containerRef,
    targetRef,
    reset,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
  };
}
