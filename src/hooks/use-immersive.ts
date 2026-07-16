"use client";

import { useEffect } from "react";

/**
 * Hides app chrome (the bottom nav) while a video fullscreen overlay
 * is active.
 *
 * The overlays are position:fixed inside <main>, whose
 * -webkit-overflow-scrolling creates a stacking context on iOS — so
 * no z-index can lift them above the sibling nav (z-10). Hiding the
 * nav is the only way it neither paints over the overlay's bottom
 * controls nor steals their touches.
 */
export function useImmersive(active: boolean) {
  useEffect(() => {
    if (!active) return;
    document.body.classList.add("video-fullscreen");
    return () => document.body.classList.remove("video-fullscreen");
  }, [active]);
}
