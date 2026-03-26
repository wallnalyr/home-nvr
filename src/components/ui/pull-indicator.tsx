"use client";

import { Loader2, ArrowDown } from "lucide-react";

interface PullIndicatorProps {
  pulling: boolean;
  refreshing: boolean;
  pullReady: boolean;
  pullDistance: number;
}

export function PullIndicator({ pulling, refreshing, pullReady, pullDistance }: PullIndicatorProps) {
  if (!pulling) return null;

  return (
    <div
      className="flex justify-center overflow-hidden transition-[height] duration-150"
      style={{ height: refreshing ? 40 : pullDistance * 0.5 }}
    >
      <div className="flex items-center justify-center py-2">
        {refreshing ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <ArrowDown
            className="h-5 w-5 text-muted-foreground transition-transform duration-150"
            style={{ transform: pullReady ? "rotate(180deg)" : "rotate(0deg)" }}
          />
        )}
      </div>
    </div>
  );
}
