"use client";

import { useState, useEffect, useCallback } from "react";
import useSWR from "swr";
import {
  ALL_OBJECTS,
  DEFAULT_ENABLED_OBJECTS,
  AUDIO_LABELS,
  AUDIO_CATEGORIES,
  DEFAULT_ENABLED_AUDIO,
} from "@/lib/objects";
import type { ObjectDef, AudioLabelDef } from "@/lib/objects";
import { Loader2, Sparkles, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

const CATEGORIES = [
  { id: "people" as const, label: "People" },
  { id: "vehicles" as const, label: "Vehicles" },
  { id: "animals" as const, label: "Animals" },
  { id: "objects" as const, label: "Objects" },
  { id: "delivery" as const, label: "Delivery" },
];

export function ObjectsSettings() {
  const { data, mutate } = useSWR<{ enabledObjects: string[] }>(
    "/api/settings/objects",
    fetcher
  );
  const { data: audioData, mutate: mutateAudio } = useSWR<{
    enabledAudio: string[];
  }>("/api/settings/audio", fetcher);

  const [enabled, setEnabled] = useState<Set<string>>(
    new Set(DEFAULT_ENABLED_OBJECTS)
  );
  const [enabledAudio, setEnabledAudio] = useState<Set<string>>(
    new Set(DEFAULT_ENABLED_AUDIO)
  );
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [audioDirty, setAudioDirty] = useState(false);

  useEffect(() => {
    if (data?.enabledObjects) {
      setEnabled(new Set(data.enabledObjects));
    }
  }, [data]);

  useEffect(() => {
    if (audioData?.enabledAudio) {
      setEnabledAudio(new Set(audioData.enabledAudio));
    }
  }, [audioData]);

  const toggle = useCallback(
    (id: string) => {
      setEnabled((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          if (next.size <= 1) return prev; // keep at least one
          next.delete(id);
        } else {
          next.add(id);
        }
        setDirty(true);
        return next;
      });
    },
    []
  );

  const toggleAudio = useCallback((id: string) => {
    setEnabledAudio((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      setAudioDirty(true);
      return next;
    });
  }, []);

  const saveAudio = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/audio", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabledAudio: Array.from(enabledAudio) }),
      });
      if (res.ok) {
        mutateAudio();
        setAudioDirty(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/objects", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabledObjects: Array.from(enabled) }),
      });
      if (res.ok) {
        mutate();
        setDirty(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const renderCategory = (
    category: (typeof CATEGORIES)[number],
    objects: ObjectDef[]
  ) => {
    if (objects.length === 0) return null;
    return (
      <div key={category.id}>
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
          {category.label}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {objects.map((obj) => {
            const isEnabled = enabled.has(obj.id);
            return (
              <button
                key={obj.id}
                type="button"
                onClick={() => toggle(obj.id)}
                className={cn(
                  "inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150",
                  isEnabled
                    ? "bg-ios-blue text-white shadow-sm"
                    : "bg-secondary/60 text-secondary-foreground"
                )}
              >
                {obj.plusOnly && (
                  <Sparkles className="h-3 w-3 shrink-0 opacity-70" />
                )}
                {obj.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const standardObjects = ALL_OBJECTS.filter((o) => !o.plusOnly);
  const plusObjects = ALL_OBJECTS.filter((o) => o.plusOnly);

  return (
    <div className="space-y-4 p-4">
      <div className="bg-card rounded-xl shadow-sm p-4 space-y-4">
        <div>
          <h3 className="text-sm font-medium mb-1">Tracked Objects</h3>
          <p className="text-xs text-muted-foreground">
            Select which objects are available for tracking, event filtering, and
            notifications across the app.
          </p>
        </div>

        <div className="space-y-3">
          {CATEGORIES.map((cat) =>
            renderCategory(
              cat,
              standardObjects.filter((o) => o.category === cat.id)
            )
          )}
        </div>
      </div>

      <div className="bg-card rounded-xl shadow-sm p-4 space-y-4">
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <Sparkles className="h-4 w-4 text-ios-blue" />
            <h3 className="text-sm font-medium">Frigate+ Objects</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            These objects require a Frigate+ model. Enable them only if you have
            a Frigate+ subscription and model configured.
          </p>
        </div>

        <div className="space-y-3">
          {CATEGORIES.map((cat) =>
            renderCategory(
              cat,
              plusObjects.filter((o) => o.category === cat.id)
            )
          )}
        </div>
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

      <div className="bg-card rounded-xl shadow-sm p-4 space-y-4">
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <Volume2 className="h-4 w-4 text-ios-blue" />
            <h3 className="text-sm font-medium">Audio Detection</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Detect sounds like fire alarms, glass breaking, screams, and barking.
            Enabled sounds are added to all cameras and can trigger notifications.
          </p>
        </div>

        <div className="space-y-3">
          {AUDIO_CATEGORIES.map((cat) => {
            const items = AUDIO_LABELS.filter(
              (a: AudioLabelDef) => a.category === cat.id
            );
            if (items.length === 0) return null;
            return (
              <div key={cat.id}>
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                  {cat.label}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {items.map((audio: AudioLabelDef) => {
                    const isEnabled = enabledAudio.has(audio.id);
                    return (
                      <button
                        key={audio.id}
                        type="button"
                        onClick={() => toggleAudio(audio.id)}
                        className={cn(
                          "px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150",
                          isEnabled
                            ? "bg-ios-blue text-white shadow-sm"
                            : "bg-secondary/60 text-secondary-foreground"
                        )}
                      >
                        {audio.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {audioDirty && (
          <button
            onClick={saveAudio}
            disabled={saving}
            className="w-full h-11 rounded-xl bg-ios-blue text-white text-sm font-medium flex items-center justify-center gap-2 transition-opacity disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Save Audio Settings"
            )}
          </button>
        )}
      </div>
    </div>
  );
}
