"use client";

import { useState, useCallback, useRef } from "react";
import useSWR from "swr";
import { ArrowUpDown, Plus, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { authFetcher } from "@/lib/fetcher";
import { Button } from "@/components/ui/button";
import { CameraList } from "@/components/cameras/camera-list";
import { CameraForm } from "@/components/cameras/camera-form";
import { useCameras } from "@/hooks/use-cameras";
import type { Camera, CameraFormData } from "@/types/camera";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface HealthDrift {
  configDrift: {
    status: "ok" | "drift" | "unreachable";
    mismatches: string[];
  } | null;
}

export default function CamerasPage() {
  const { data: health } = useSWR<HealthDrift>(
    "/api/system/health",
    authFetcher,
    { refreshInterval: 60000, revalidateOnFocus: true },
  );
  const drift = health?.configDrift;
  const { cameras, mutate } = useCameras();
  const [addingCamera, setAddingCamera] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteCamera, setDeleteCamera] = useState<Camera | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reorderMode, setReorderMode] = useState(false);

  const moveCamera = useCallback(
    async (index: number, direction: -1 | 1) => {
      const target = index + direction;
      if (target < 0 || target >= cameras.length) return;
      const a = cameras[index];
      const b = cameras[target];
      await Promise.all([
        fetch(`/api/cameras/${a.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sortOrder: target }),
        }),
        fetch(`/api/cameras/${b.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sortOrder: index }),
        }),
      ]);
      await mutate();
    },
    [cameras, mutate],
  );

  const handleAdd = async (data: CameraFormData) => {
    const res = await fetch("/api/cameras", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to add camera");
    }
    warnIfConfigStale(await res.json().catch(() => null));
    await mutate();
    setAddingCamera(false);
  };

  // A camera save can succeed in the DB while the Frigate config push
  // fails — the PUT then returns 200 with a configWarning. Until now that
  // warning was dropped on the floor, so zone/setting edits could silently
  // never reach Frigate. Throttled: auto-save fires on every form change,
  // and a persistent failure must not toast per keystroke.
  const lastConfigWarnAtRef = useRef(0);
  const warnIfConfigStale = (body: unknown) => {
    const warning = (body as { configWarning?: string } | null)?.configWarning;
    if (!warning) return;
    const now = Date.now();
    if (now - lastConfigWarnAtRef.current < 30000) return;
    lastConfigWarnAtRef.current = now;
    toast.warning(
      `Saved, but Frigate hasn't applied it yet: ${warning.slice(0, 180)}`,
      { duration: 10000 },
    );
  };

  const handleEdit = async (data: CameraFormData) => {
    if (!editingId) return;
    const res = await fetch(`/api/cameras/${editingId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to update camera");
    }
    warnIfConfigStale(await res.json().catch(() => null));
    await mutate();
    setEditingId(null);
  };

  const handleAutoSave = useCallback(
    async (cameraId: string, data: CameraFormData) => {
      const res = await fetch(`/api/cameras/${cameraId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save");
      }
      warnIfConfigStale(await res.json().catch(() => null));
      await mutate();
    },
    [mutate],
  );

  const handleDelete = async () => {
    if (!deleteCamera) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/cameras/${deleteCamera.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete");
      await mutate();
    } finally {
      setDeleting(false);
      setDeleteCamera(null);
    }
  };

  return (
    <div>
      {drift?.status === "drift" && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">
              Frigate is not running your latest camera config
            </p>
            <p className="mt-0.5 text-muted-foreground">
              Exclusion zones or detection settings may be inactive.
              Auto-repair is retrying; you can also push manually via
              Settings → Frigate → Regenerate Config.
            </p>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm text-muted-foreground">
          {cameras.length} camera{cameras.length !== 1 ? "s" : ""}
        </span>
        <div className="flex items-center gap-1">
          {cameras.length > 1 && (
            <Button
              size="sm"
              variant={reorderMode ? "default" : "ghost"}
              className="gap-1 h-9 rounded-lg"
              onClick={() => setReorderMode(!reorderMode)}
            >
              <ArrowUpDown className="h-4 w-4" />
              {reorderMode ? "Done" : "Reorder"}
            </Button>
          )}
          {!reorderMode && !addingCamera && (
            <Button
              size="sm"
              className="gap-1 h-9 rounded-lg"
              onClick={() => {
                setAddingCamera(true);
                setEditingId(null);
              }}
            >
              <Plus className="h-4 w-4" />
              Add
            </Button>
          )}
          {addingCamera && (
            <Button
              size="sm"
              variant="ghost"
              className="gap-1 h-9 rounded-lg"
              onClick={() => setAddingCamera(false)}
            >
              <X className="h-4 w-4" />
              Cancel
            </Button>
          )}
        </div>
      </div>

      {/* Inline Add Camera Form */}
      {addingCamera && (
        <div className="mx-4 mb-4 rounded-2xl bg-card shadow-sm overflow-hidden">
          <div className="px-4 pt-3 pb-1">
            <h3 className="text-sm font-semibold">Add Camera</h3>
          </div>
          <CameraForm
            onSubmit={handleAdd}
            onCancel={() => setAddingCamera(false)}
          />
        </div>
      )}

      <CameraList
        cameras={cameras}
        editingId={reorderMode ? null : editingId}
        onEdit={(cam) => {
          setEditingId(cam.id);
          setAddingCamera(false);
        }}
        onCancelEdit={() => setEditingId(null)}
        onSubmitEdit={handleEdit}
        onAutoSave={handleAutoSave}
        onDelete={setDeleteCamera}
        reorderMode={reorderMode}
        onMove={moveCamera}
      />

      {/* Delete Confirmation */}
      <Dialog
        open={!!deleteCamera}
        onOpenChange={(open) => !open && setDeleteCamera(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Camera</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{deleteCamera?.name}&quot;?
              This will remove the camera from Frigate and delete all associated
              settings.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleteCamera(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
