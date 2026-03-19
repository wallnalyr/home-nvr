"use client";

import { useState, useEffect, useCallback } from "react";
import useSWR from "swr";
import { PushManager } from "@/components/pwa/push-manager";
import { useEnabledObjects } from "@/hooks/use-enabled-objects";
import { useEnabledAudio } from "@/hooks/use-enabled-audio";
import { ALL_OBJECTS, AUDIO_LABELS } from "@/lib/objects";
import { Loader2, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function NotificationSettings() {
  const { enabledObjects } = useEnabledObjects();
  const { enabledAudio } = useEnabledAudio();
  const { data, mutate } = useSWR<{ notificationObjects: string[] | null }>(
    "/api/settings/notification-objects",
    fetcher
  );
  const { data: audioNotifData, mutate: mutateAudioNotif } = useSWR<{
    notificationAudio: string[] | null;
  }>("/api/settings/notification-audio", fetcher);

  // null = all enabled objects (default)
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [audioSelected, setAudioSelected] = useState<Set<string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [audioDirty, setAudioDirty] = useState(false);

  useEffect(() => {
    if (data !== undefined) {
      setSelected(
        data.notificationObjects ? new Set(data.notificationObjects) : null
      );
    }
  }, [data]);

  useEffect(() => {
    if (audioNotifData !== undefined) {
      setAudioSelected(
        audioNotifData.notificationAudio
          ? new Set(audioNotifData.notificationAudio)
          : null
      );
    }
  }, [audioNotifData]);

  const isAll = selected === null;
  const effectiveSelected = isAll
    ? new Set(enabledObjects)
    : selected;

  const toggleAll = useCallback(() => {
    if (isAll) {
      // Switch to explicit selection with current enabled objects
      setSelected(new Set(enabledObjects));
    } else {
      // Switch back to "all"
      setSelected(null);
    }
    setDirty(true);
  }, [isAll, enabledObjects]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      // If switching from "all" mode, start with all enabled objects
      const base = prev ?? new Set(enabledObjects);
      const next = new Set(base);
      if (next.has(id)) {
        if (next.size <= 1) return prev; // keep at least one
        next.delete(id);
      } else {
        next.add(id);
      }
      setDirty(true);
      return next;
    });
  }, [enabledObjects]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/notification-objects", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notificationObjects: selected ? Array.from(selected) : null,
        }),
      });
      if (res.ok) {
        mutate();
        setDirty(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const isAudioAll = audioSelected === null;

  const toggleAudioAll = useCallback(() => {
    if (isAudioAll) {
      setAudioSelected(new Set(enabledAudio));
    } else {
      setAudioSelected(null);
    }
    setAudioDirty(true);
  }, [isAudioAll, enabledAudio]);

  const toggleAudioItem = useCallback(
    (id: string) => {
      setAudioSelected((prev) => {
        const base = prev ?? new Set(enabledAudio);
        const next = new Set(base);
        if (next.has(id)) {
          if (next.size <= 1) return prev;
          next.delete(id);
        } else {
          next.add(id);
        }
        setAudioDirty(true);
        return next;
      });
    },
    [enabledAudio]
  );

  const saveAudioNotif = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/notification-audio", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notificationAudio: audioSelected ? Array.from(audioSelected) : null,
        }),
      });
      if (res.ok) {
        mutateAudioNotif();
        setAudioDirty(false);
      }
    } finally {
      setSaving(false);
    }
  };

  // Only show objects that are in the enabled set
  const availableObjects = ALL_OBJECTS.filter((o) =>
    enabledObjects.includes(o.id)
  );

  const availableAudio = AUDIO_LABELS.filter((a) =>
    enabledAudio.includes(a.id)
  );

  return (
    <div className="space-y-4 p-4">
      <div className="bg-card rounded-xl shadow-sm p-4">
        <h3 className="text-sm font-medium mb-1">Push Notifications</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Receive alerts when cameras detect motion or objects. Requires iOS
          16.4+ in standalone (Add to Home Screen) mode.
        </p>
        <PushManager />
      </div>

      <div className="bg-card rounded-xl shadow-sm p-4 space-y-3">
        <div>
          <h3 className="text-sm font-medium mb-1">Notify For</h3>
          <p className="text-xs text-muted-foreground">
            Choose which detected objects trigger push notifications.
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={toggleAll}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150",
              isAll
                ? "bg-ios-blue text-white shadow-sm"
                : "bg-secondary/60 text-secondary-foreground"
            )}
          >
            All
          </button>
          {availableObjects.map((obj) => {
            const isActive = !isAll && effectiveSelected?.has(obj.id);
            return (
              <button
                key={obj.id}
                type="button"
                onClick={() => toggle(obj.id)}
                disabled={isAll}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150",
                  isAll
                    ? "bg-ios-blue/20 text-ios-blue"
                    : isActive
                      ? "bg-ios-blue text-white shadow-sm"
                      : "bg-secondary/60 text-secondary-foreground"
                )}
              >
                {obj.label}
              </button>
            );
          })}
        </div>

        {dirty && (
          <button
            onClick={save}
            disabled={saving}
            className="w-full h-11 rounded-xl bg-ios-blue text-white text-sm font-medium flex items-center justify-center gap-2 transition-opacity disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Save Changes"
            )}
          </button>
        )}
      </div>

      {availableAudio.length > 0 && (
        <div className="bg-card rounded-xl shadow-sm p-4 space-y-3">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <Volume2 className="h-4 w-4 text-ios-blue" />
              <h3 className="text-sm font-medium">Audio Alerts</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Choose which detected sounds trigger push notifications.
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={toggleAudioAll}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150",
                isAudioAll
                  ? "bg-ios-blue text-white shadow-sm"
                  : "bg-secondary/60 text-secondary-foreground"
              )}
            >
              All
            </button>
            {availableAudio.map((audio) => {
              const isActive =
                !isAudioAll && audioSelected?.has(audio.id);
              return (
                <button
                  key={audio.id}
                  type="button"
                  onClick={() => toggleAudioItem(audio.id)}
                  disabled={isAudioAll}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150",
                    isAudioAll
                      ? "bg-ios-blue/20 text-ios-blue"
                      : isActive
                        ? "bg-ios-blue text-white shadow-sm"
                        : "bg-secondary/60 text-secondary-foreground"
                  )}
                >
                  {audio.label}
                </button>
              );
            })}
          </div>

          {audioDirty && (
            <button
              onClick={saveAudioNotif}
              disabled={saving}
              className="w-full h-11 rounded-xl bg-ios-blue text-white text-sm font-medium flex items-center justify-center gap-2 transition-opacity disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Save Changes"
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
