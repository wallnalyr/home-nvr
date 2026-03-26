"use client";

import { useCallback, useRef } from "react";

const SWIPE_THRESHOLD = 60;
const SWIPE_MAX_VERTICAL = 80;

interface UseSwipeNavigationOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
}

export function useSwipeNavigation({ onSwipeLeft, onSwipeRight }: UseSwipeNavigationOptions) {
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    startRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
  }, []);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!startRef.current) return;
    const dx = e.changedTouches[0].clientX - startRef.current.x;
    const dy = Math.abs(e.changedTouches[0].clientY - startRef.current.y);
    startRef.current = null;

    // Must be mostly horizontal
    if (dy > SWIPE_MAX_VERTICAL) return;

    if (dx < -SWIPE_THRESHOLD) {
      onSwipeLeft?.();
    } else if (dx > SWIPE_THRESHOLD) {
      onSwipeRight?.();
    }
  }, [onSwipeLeft, onSwipeRight]);

  return { onTouchStart, onTouchEnd };
}
