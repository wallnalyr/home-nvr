"use client";

import { useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function FrigateSettings() {
  const { data: stats, isLoading } = useSWR("/api/frigate/stats", fetcher, {
    refreshInterval: 30000,
  });
  const [regenerating, setRegenerating] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [configPreview, setConfigPreview] = useState<string | null>(null);

  const handleRegenerate = async () => {
    if (!confirmRegenerate) {
      setConfirmRegenerate(true);
      return;
    }
    setConfirmRegenerate(false);
    setRegenerating(true);
    try {
      const res = await fetch("/api/frigate/config", { method: "POST" });
      if (res.ok) {
        const yaml = await res.text();
        setConfigPreview(yaml);
      }
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between bg-card rounded-xl shadow-sm p-4">
        <div>
          <h3 className="text-sm font-medium">Frigate NVR</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Object detection and recording engine
          </p>
        </div>
        <Badge
          variant={
            isLoading
              ? "secondary"
              : stats?.error
                ? "destructive"
                : "default"
          }
        >
          {isLoading ? "Checking..." : stats?.error ? "Offline" : "Online"}
        </Badge>
      </div>

      {confirmRegenerate ? (
        <div className="bg-card rounded-xl shadow-sm p-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            This will restart Frigate. Live streams will briefly disconnect
            and in-progress recordings may be interrupted.
          </p>
          <div className="flex gap-2">
            <Button
              variant="destructive"
              onClick={handleRegenerate}
              disabled={regenerating}
              className="flex-1 h-10 gap-2 rounded-xl"
            >
              {regenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Confirm Restart"
              )}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setConfirmRegenerate(false)}
              className="flex-1 h-10 rounded-xl"
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="secondary"
          onClick={handleRegenerate}
          disabled={regenerating}
          className="w-full h-11 gap-2 rounded-xl"
        >
          {regenerating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Regenerate Config
        </Button>
      )}

      {configPreview && (
        <div className="rounded-xl bg-card shadow-sm p-3 overflow-auto max-h-64">
          <pre className="text-xs font-mono whitespace-pre">
            {configPreview}
          </pre>
        </div>
      )}

      <div className="bg-card rounded-xl shadow-sm p-4">
        <div className="flex items-center gap-1.5 mb-1">
          <Sparkles className="h-4 w-4 text-ios-blue" />
          <h3 className="text-sm font-medium">Frigate+</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-2">
          Custom-trained models for better detection accuracy. Set{" "}
          <code className="text-[10px] bg-secondary px-1 py-0.5 rounded">PLUS_API_KEY</code>{" "}
          and{" "}
          <code className="text-[10px] bg-secondary px-1 py-0.5 rounded">FRIGATE_PLUS_MODEL_ID</code>{" "}
          in your environment to enable.
        </p>
        {stats?.service?.detector_name && (
          <div className="flex items-center gap-2 rounded-lg bg-secondary/50 px-3 py-2">
            <span className="text-xs text-muted-foreground">
              Model:{" "}
              <span className="font-medium text-foreground">
                {stats.service.detector_name}
              </span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
