"use client";

import { useCallback, useRef } from "react";

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_ZOOM = 2.5;

interface Transform {
  scale: number;
  x: number;
  y: number;
}

/**
 * Hook for pinch-to-zoom and pan on a container element.
 *
 * Returns a ref to attach to the container and event handlers.
 * The container's children are transformed via CSS transform.
 *
 * - Two-finger pinch: zoom in/out centered between fingers
 * - One-finger drag (while zoomed): pan around
 * - Double-tap: toggle between 1x and 2.5x zoom at tap point
 * - Release at <1x: snap back to 1x
 */
export function usePinchZoom() {
  const containerRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<Transform>({ scale: 1, x: 0, y: 0 });

  // Pinch state
  const initialDistRef = useRef(0);
  const initialScaleRef = useRef(1);
  const initialMidRef = useRef({ x: 0, y: 0 });
  const initialTransRef = useRef({ x: 0, y: 0 });
  const isPinchingRef = useRef(false);

  // Pan state (single finger while zoomed)
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const panTransStartRef = useRef({ x: 0, y: 0 });

  // Double-tap detection
  const lastTapRef = useRef(0);
  const lastTapPosRef = useRef({ x: 0, y: 0 });

  const applyTransform = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { scale, x, y } = transformRef.current;
    const child = el.firstElementChild as HTMLElement | null;
    if (child) {
      child.style.transform =
        scale === 1 && x === 0 && y === 0
          ? ""
          : `translate(${x}px, ${y}px) scale(${scale})`;
      child.style.transformOrigin = "0 0";
    }
  }, []);

  const clampTranslation = useCallback(
    (scale: number, x: number, y: number) => {
      const el = containerRef.current;
      if (!el || scale <= 1) return { x: 0, y: 0 };

      const rect = el.getBoundingClientRect();
      const maxX = (rect.width * (scale - 1)) / 2;
      const maxY = (rect.height * (scale - 1)) / 2;

      return {
        x: Math.max(-maxX, Math.min(maxX, x)),
        y: Math.max(-maxY, Math.min(maxY, y)),
      };
    },
    [],
  );

  const setTransform = useCallback(
    (scale: number, x: number, y: number) => {
      const clamped = clampTranslation(scale, x, y);
      transformRef.current = { scale, x: clamped.x, y: clamped.y };
      applyTransform();
    },
    [clampTranslation, applyTransform],
  );

  const resetZoom = useCallback(() => {
    setTransform(1, 0, 0);
  }, [setTransform]);

  const isZoomed = useCallback(() => {
    return transformRef.current.scale > 1;
  }, []);

  const fingerDist = (t1: React.Touch, t2: React.Touch) =>
    Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Start pinch
      isPinchingRef.current = true;
      isPanningRef.current = false;
      const t = transformRef.current;
      initialDistRef.current = fingerDist(e.touches[0], e.touches[1]);
      initialScaleRef.current = t.scale;
      initialMidRef.current = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
      };
      initialTransRef.current = { x: t.x, y: t.y };
      e.preventDefault();
    } else if (e.touches.length === 1 && transformRef.current.scale > 1) {
      // Start pan (only when zoomed)
      isPanningRef.current = true;
      panStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      };
      panTransStartRef.current = {
        x: transformRef.current.x,
        y: transformRef.current.y,
      };
      e.preventDefault();
    }
  }, []);

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (isPinchingRef.current && e.touches.length === 2) {
        const dist = fingerDist(e.touches[0], e.touches[1]);
        const ratio = dist / initialDistRef.current;
        const newScale = Math.max(
          MIN_SCALE,
          Math.min(MAX_SCALE, initialScaleRef.current * ratio),
        );

        // Pan based on midpoint movement
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const dx = midX - initialMidRef.current.x;
        const dy = midY - initialMidRef.current.y;

        setTransform(
          newScale,
          initialTransRef.current.x + dx,
          initialTransRef.current.y + dy,
        );
        e.preventDefault();
      } else if (isPanningRef.current && e.touches.length === 1) {
        const dx = e.touches[0].clientX - panStartRef.current.x;
        const dy = e.touches[0].clientY - panStartRef.current.y;
        setTransform(
          transformRef.current.scale,
          panTransStartRef.current.x + dx,
          panTransStartRef.current.y + dy,
        );
        e.preventDefault();
      }
    },
    [setTransform],
  );

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (isPinchingRef.current) {
        isPinchingRef.current = false;
        // Snap back if below 1x
        if (transformRef.current.scale < 1.05) {
          resetZoom();
        }
        return;
      }

      if (isPanningRef.current) {
        isPanningRef.current = false;
        return;
      }

      // Double-tap detection (only on single-finger tap, not after pinch/pan)
      if (e.changedTouches.length === 1 && e.touches.length === 0) {
        const now = Date.now();
        const touch = e.changedTouches[0];
        const tapPos = { x: touch.clientX, y: touch.clientY };
        const timeDelta = now - lastTapRef.current;
        const distDelta = Math.hypot(
          tapPos.x - lastTapPosRef.current.x,
          tapPos.y - lastTapPosRef.current.y,
        );

        if (timeDelta < DOUBLE_TAP_MS && distDelta < 30) {
          // Double tap detected
          e.preventDefault();
          if (transformRef.current.scale > 1) {
            resetZoom();
          } else {
            // Zoom in centered on tap point
            const el = containerRef.current;
            if (el) {
              const rect = el.getBoundingClientRect();
              const cx = tapPos.x - rect.left - rect.width / 2;
              const cy = tapPos.y - rect.top - rect.height / 2;
              // Offset so the tap point stays in place after zoom
              const offsetX = cx * (1 - DOUBLE_TAP_ZOOM);
              const offsetY = cy * (1 - DOUBLE_TAP_ZOOM);
              setTransform(DOUBLE_TAP_ZOOM, offsetX, offsetY);
            }
          }
          lastTapRef.current = 0;
        } else {
          lastTapRef.current = now;
          lastTapPosRef.current = tapPos;
        }
      }
    },
    [resetZoom, setTransform],
  );

  return {
    containerRef,
    isZoomed,
    resetZoom,
    handlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
    },
  };
}
