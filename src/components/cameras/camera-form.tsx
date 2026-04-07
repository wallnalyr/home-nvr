"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, Info, Loader2 } from "lucide-react";
import { useEnabledObjects } from "@/hooks/use-enabled-objects";
import { useEnabledAudio } from "@/hooks/use-enabled-audio";
import { ALL_OBJECTS, AUDIO_LABELS } from "@/lib/objects";
import { cn } from "@/lib/utils";
import type { Camera, CameraFormData } from "@/types/camera";

interface DetectCheckResult {
  detector: string;
  detectorLabel: string;
  detectCamerasCount: number;
  maxRecommended: number;
  warnings: string[];
  tips: string[];
}

interface CameraFormProps {
  camera?: Camera | null;
  onSubmit: (data: CameraFormData) => Promise<void>;
  onCancel: () => void;
}

export function CameraForm({ camera, onSubmit, onCancel }: CameraFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [detectCheck, setDetectCheck] = useState<DetectCheckResult | null>(null);
  const { enabledObjects } = useEnabledObjects();
  const { enabledAudio } = useEnabledAudio();
  const [form, setForm] = useState<CameraFormData>({
    name: camera?.name || "",
    rtspUrl: camera?.rtspUrl || "",
    rtspSubUrl: camera?.rtspSubUrl || "",
    enabled: camera?.enabled ?? true,
    detectEnabled: camera?.detectEnabled ?? true,
    detectWidth: camera?.detectWidth ?? 1280,
    detectHeight: camera?.detectHeight ?? 720,
    detectFps: camera?.detectFps ?? 5,
    objectsTrack: camera?.objectsTrack ?? "person,car,cat,dog",
    audioDetect: camera?.audioDetect ?? "fire_alarm,scream,bark,glass",
    recordEnabled: camera?.recordEnabled ?? true,
    recordRetainDays: camera?.recordRetainDays ?? 7,
    snapshotsEnabled: camera?.snapshotsEnabled ?? true,
    notifyEnabled: camera?.notifyEnabled ?? true,
    notifyCooldownSec: camera?.notifyCooldownSec ?? 30,
    motionThreshold: camera?.motionThreshold ?? 30,
  });

  const fetchDetectCheck = useCallback(() => {
    fetch("/api/system/detect-check")
      .then((res) => res.json())
      .then((data: DetectCheckResult) => setDetectCheck(data))
      .catch(() => setDetectCheck(null));
  }, []);

  // Fetch detection check when detection is enabled
  useEffect(() => {
    if (form.detectEnabled) {
      fetchDetectCheck();
    } else {
      setDetectCheck(null);
    }
  }, [form.detectEnabled, fetchDetectCheck]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await onSubmit(form);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setLoading(false);
    }
  };

  const update = (field: keyof CameraFormData, value: unknown) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const hasWarnings = detectCheck && detectCheck.warnings.length > 0;
  const hasTips = detectCheck && detectCheck.tips.length > 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-6 p-4">
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground">General</h3>
        <div className="space-y-2">
          <Label htmlFor="name">Camera Name</Label>
          <Input
            id="name"
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            placeholder="Front Door"
            pattern="^[a-zA-Z0-9 _\-'.]+$"
            required
            className="h-11"
          />
          <p className="text-xs text-muted-foreground">
            Letters, numbers, spaces, hyphens, and underscores
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="rtspUrl">RTSP URL (Main Stream)</Label>
          <Input
            id="rtspUrl"
            value={form.rtspUrl}
            onChange={(e) => update("rtspUrl", e.target.value)}
            placeholder="rtsp://user:pass@192.168.1.100:554/stream1"
            required={!camera}
            className="h-11"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="rtspSubUrl">RTSP URL (Sub Stream, optional)</Label>
          <Input
            id="rtspSubUrl"
            value={form.rtspSubUrl}
            onChange={(e) => update("rtspSubUrl", e.target.value)}
            placeholder="rtsp://user:pass@192.168.1.100:554/stream2"
            className="h-11"
          />
        </div>

        <div className="flex items-center justify-between">
          <Label htmlFor="enabled">Enabled</Label>
          <Switch
            id="enabled"
            checked={form.enabled}
            onCheckedChange={(v) => update("enabled", v)}
          />
        </div>
      </div>

      <Separator />

      <div className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground">Detection</h3>
        <div className="flex items-center justify-between">
          <Label htmlFor="detectEnabled">Object Detection</Label>
          <Switch
            id="detectEnabled"
            checked={form.detectEnabled}
            onCheckedChange={(v) => update("detectEnabled", v)}
          />
        </div>

        {/* Hardware check warnings */}
        {form.detectEnabled && detectCheck && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded-lg bg-secondary/50 px-3 py-2">
              <span className="text-xs text-muted-foreground">
                Detector: <span className="font-medium text-foreground">{detectCheck.detectorLabel}</span>
                {" · "}
                {detectCheck.detectCamerasCount} of {detectCheck.maxRecommended} max cameras
              </span>
            </div>

            {hasWarnings && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 space-y-1">
                {detectCheck.warnings.map((w, i) => (
                  <div key={i} className="flex gap-2 items-start">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />
                    <span className="text-xs text-amber-800">{w}</span>
                  </div>
                ))}
              </div>
            )}

            {hasTips && !hasWarnings && (
              <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 space-y-1">
                {detectCheck.tips.map((t, i) => (
                  <div key={i} className="flex gap-2 items-start">
                    <Info className="h-3.5 w-3.5 text-blue-600 mt-0.5 shrink-0" />
                    <span className="text-xs text-blue-800">{t}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label htmlFor="detectWidth" className="text-xs">Width</Label>
            <Input
              id="detectWidth"
              type="number"
              value={form.detectWidth}
              onChange={(e) => update("detectWidth", parseInt(e.target.value))}
              className="h-9"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="detectHeight" className="text-xs">Height</Label>
            <Input
              id="detectHeight"
              type="number"
              value={form.detectHeight}
              onChange={(e) => update("detectHeight", parseInt(e.target.value))}
              className="h-9"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="detectFps" className="text-xs">FPS</Label>
            <Input
              id="detectFps"
              type="number"
              value={form.detectFps}
              onChange={(e) => update("detectFps", parseInt(e.target.value))}
              className="h-9"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Objects to Track</Label>
          <div className="flex flex-wrap gap-1.5">
            {enabledObjects.map((objId) => {
              const tracked = (form.objectsTrack ?? "")
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
              const isActive = tracked.includes(objId);
              const objDef = ALL_OBJECTS.find((o) => o.id === objId);
              const label = objDef
                ? objDef.label
                : objId.charAt(0).toUpperCase() + objId.slice(1).replace(/_/g, " ");
              return (
                <button
                  key={objId}
                  type="button"
                  onClick={() => {
                    const current = (form.objectsTrack ?? "")
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean);
                    let next: string[];
                    if (isActive) {
                      next = current.filter((o) => o !== objId);
                      if (next.length === 0) return; // keep at least one
                    } else {
                      next = [...current, objId];
                    }
                    update("objectsTrack", next.join(","));
                  }}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150",
                    isActive
                      ? "bg-ios-blue text-white shadow-sm"
                      : "bg-secondary/60 text-secondary-foreground"
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="audioEnabled">Audio</Label>
            <Switch
              id="audioEnabled"
              checked={(form.audioDetect ?? "").split(",").filter(Boolean).length > 0}
              onCheckedChange={(enabled) => {
                if (enabled) {
                  update("audioDetect", enabledAudio.join(","));
                } else {
                  update("audioDetect", "");
                }
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Disables audio for live view, recording, and detection
          </p>
          {(form.audioDetect ?? "").split(",").filter(Boolean).length > 0 && (
          <div className="space-y-1.5">
          <Label className="text-xs">Detection Labels</Label>
          <div className="flex flex-wrap gap-1.5">
            {enabledAudio.map((audioId) => {
              const tracked = (form.audioDetect ?? "")
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
              const isActive = tracked.includes(audioId);
              const audioDef = AUDIO_LABELS.find((a) => a.id === audioId);
              const label = audioDef
                ? audioDef.label
                : audioId.charAt(0).toUpperCase() + audioId.slice(1).replace(/_/g, " ");
              return (
                <button
                  key={audioId}
                  type="button"
                  onClick={() => {
                    const current = (form.audioDetect ?? "")
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean);
                    let next: string[];
                    if (isActive) {
                      next = current.filter((a) => a !== audioId);
                    } else {
                      next = [...current, audioId];
                    }
                    update("audioDetect", next.join(","));
                  }}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150",
                    isActive
                      ? "bg-ios-blue text-white shadow-sm"
                      : "bg-secondary/60 text-secondary-foreground"
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
          </div>
          )}
        </div>
      </div>

      <Separator />

      <div className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground">Recording</h3>
        <div className="flex items-center justify-between">
          <Label htmlFor="recordEnabled">Continuous Recording</Label>
          <Switch
            id="recordEnabled"
            checked={form.recordEnabled}
            onCheckedChange={(v) => update("recordEnabled", v)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="recordRetainDays">Retain Days</Label>
          <Input
            id="recordRetainDays"
            type="number"
            value={form.recordRetainDays}
            onChange={(e) => update("recordRetainDays", parseInt(e.target.value))}
            className="h-11"
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="snapshotsEnabled">Snapshots</Label>
          <Switch
            id="snapshotsEnabled"
            checked={form.snapshotsEnabled}
            onCheckedChange={(v) => update("snapshotsEnabled", v)}
          />
        </div>
      </div>

      <Separator />

      <div className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground">
          Notifications
        </h3>
        <div className="flex items-center justify-between">
          <Label htmlFor="notifyEnabled">Push Notifications</Label>
          <Switch
            id="notifyEnabled"
            checked={form.notifyEnabled}
            onCheckedChange={(v) => update("notifyEnabled", v)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="notifyCooldownSec">Cooldown (seconds)</Label>
          <Input
            id="notifyCooldownSec"
            type="number"
            value={form.notifyCooldownSec}
            onChange={(e) => update("notifyCooldownSec", parseInt(e.target.value))}
            className="h-11"
          />
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive text-center">{error}</p>
      )}

      <div className="flex gap-3 pt-2">
        <Button type="button" variant="secondary" className="flex-1 h-11 rounded-xl" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" className="flex-1 h-11 rounded-xl" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : camera ? "Update" : "Add Camera"}
        </Button>
      </div>
    </form>
  );
}
