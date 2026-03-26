"use client";

import { useCallback, useRef, useState } from "react";

const PULL_THRESHOLD = 80;
const MAX_PULL = 120;

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void>;
  getScrollContainer?: () => HTMLElement | null;
}

export function usePullToRefresh({ onRefresh, getScrollContainer }: UsePullToRefreshOptions) {
  const [pulling, setPulling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const startYRef = useRef(0);
  const activeRef = useRef(false);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (refreshing) return;
    const container = getScrollContainer?.() ?? (e.currentTarget as HTMLElement).closest("main");
    if (container && container.scrollTop > 0) return;
    startYRef.current = e.touches[0].clientY;
    activeRef.current = true;
  }, [refreshing, getScrollContainer]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!activeRef.current || refreshing) return;
    const dy = e.touches[0].clientY - startYRef.current;
    if (dy < 0) {
      activeRef.current = false;
      setPulling(false);
      setPullDistance(0);
      return;
    }
    const clamped = Math.min(dy * 0.5, MAX_PULL);
    setPullDistance(clamped);
    setPulling(clamped > 0);
  }, [refreshing]);

  const onTouchEnd = useCallback(async () => {
    if (!activeRef.current) return;
    activeRef.current = false;

    if (pullDistance >= PULL_THRESHOLD) {
      setRefreshing(true);
      setPullDistance(PULL_THRESHOLD * 0.5);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
      }
    }
    setPulling(false);
    setPullDistance(0);
  }, [pullDistance, onRefresh]);

  return {
    pulling: pulling || refreshing,
    refreshing,
    pullDistance,
    pullReady: pullDistance >= PULL_THRESHOLD,
    handlers: { onTouchStart, onTouchMove, onTouchEnd },
  };
}
