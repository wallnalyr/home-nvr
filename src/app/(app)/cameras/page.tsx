"use client";

import { useState, useCallback } from "react";
import { ArrowUpDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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

export default function CamerasPage() {
  const { cameras, mutate } = useCameras();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteCamera, setDeleteCamera] = useState<Camera | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reorderMode, setReorderMode] = useState(false);

  const moveCamera = useCallback(async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= cameras.length) return;
    // Swap sortOrder between the two cameras
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
  }, [cameras, mutate]);

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
    await mutate();
    setSheetOpen(false);
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
    await mutate();
    setEditingId(null);
  };

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
          {!reorderMode && (
            <Button
              size="sm"
              className="gap-1 h-9 rounded-lg"
              onClick={() => setSheetOpen(true)}
            >
              <Plus className="h-4 w-4" />
              Add
            </Button>
          )}
        </div>
      </div>

      <CameraList
        cameras={cameras}
        editingId={reorderMode ? null : editingId}
        onEdit={(cam) => setEditingId(cam.id)}
        onCancelEdit={() => setEditingId(null)}
        onSubmitEdit={handleEdit}
        onDelete={setDeleteCamera}
        reorderMode={reorderMode}
        onMove={moveCamera}
      />

      {/* Add Camera Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Add Camera</SheetTitle>
          </SheetHeader>
          <CameraForm
            onSubmit={handleAdd}
            onCancel={() => setSheetOpen(false)}
          />
        </SheetContent>
      </Sheet>

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
            <Button
              variant="secondary"
              onClick={() => setDeleteCamera(null)}
            >
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
