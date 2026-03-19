"use client";

import { useState, useEffect } from "react";
import { Bell, BellOff, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIsStandalone } from "@/hooks/use-is-standalone";
import { usePushSubscription } from "@/hooks/use-push-subscription";
import { useNotificationPermission } from "@/hooks/use-notification-permission";

export function PushManager() {
  const isStandalone = useIsStandalone();
  const { permission, requestPermission } = useNotificationPermission();
  const { subscription, subscribe, unsubscribe } = usePushSubscription();
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    setIsIOS(/iPhone|iPad/.test(navigator.userAgent));
  }, []);

  const handleToggle = async () => {
    setLoading(true);
    setError(null);
    try {
      if (subscription) {
        await unsubscribe();
      } else {
        if (permission === "default") {
          const granted = await requestPermission();
          if (!granted) {
            setError("Notification permission was denied");
            setLoading(false);
            return;
          }
        }
        if (permission === "denied") {
          setError("Notifications are blocked in device settings");
          setLoading(false);
          return;
        }
        await subscribe();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle notifications");
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async () => {
    if (testing) return;
    setTesting(true);
    setError(null);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Test failed");
      } else if (data.summary?.failed > 0) {
        setError(`Test sent but ${data.summary.failed} failed: ${data.sendResults?.find((r: { success: boolean; error?: string }) => !r.success)?.error}`);
      }
    } catch {
      setError("Failed to send test notification");
    } finally {
      setTesting(false);
    }
  };

  if (!isStandalone && isIOS) {
    return (
      <div className="rounded-lg bg-secondary/50 p-4">
        <p className="text-sm text-muted-foreground">
          Push notifications require the app to be installed. Add to Home Screen
          first.
        </p>
      </div>
    );
  }

  if (permission === "denied") {
    return (
      <div className="rounded-lg bg-secondary/50 p-4">
        <p className="text-sm text-muted-foreground">
          Notifications are blocked. Enable them in your device Settings.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button
          variant={subscription ? "secondary" : "default"}
          onClick={handleToggle}
          disabled={loading}
          className="tap-target gap-2 flex-1"
        >
          {subscription ? (
            <>
              <BellOff className="h-4 w-4" />
              Disable
            </>
          ) : (
            <>
              <Bell className="h-4 w-4" />
              Enable Notifications
            </>
          )}
        </Button>
        {subscription && (
          <Button
            variant="outline"
            onClick={handleTest}
            disabled={testing}
            className="tap-target"
          >
            Test
          </Button>
        )}
      </div>
      {error && (
        <div className="flex gap-2 items-start rounded-lg bg-red-50 border border-red-200 px-3 py-2">
          <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}
    </div>
  );
}
