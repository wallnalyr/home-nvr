"use client";

import { useState, useSyncExternalStore } from "react";
import { useIsStandalone } from "@/hooks/use-is-standalone";
import { Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const emptySubscribe = () => () => {};

export function InstallPrompt() {
  const isStandalone = useIsStandalone();
  const [dismissed, setDismissed] = useState(false);
  const isIOS = useSyncExternalStore(
    emptySubscribe,
    () => /iPad|iPhone|iPod/.test(navigator.userAgent),
    () => false
  );

  if (isStandalone || dismissed || !isIOS) return null;

  return (
    <div className="fixed bottom-20 left-4 right-4 z-50 rounded-2xl bg-card p-4 shadow-lg">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-ios-blue/10 p-2">
          <Share className="h-5 w-5 text-ios-blue" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm">Install Camera Monitor</p>
          <p className="text-xs text-muted-foreground mt-1">
            Tap the share button, then &quot;Add to Home Screen&quot; for the
            best experience with push notifications.
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 -mt-1 -mr-1"
          onClick={() => setDismissed(true)}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
