"use client";

import {
  Camera as CameraIcon,
  Trash2,
  ChevronDown,
  ChevronUp,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CameraForm } from "./camera-form";
import type { Camera, CameraFormData } from "@/types/camera";

interface CameraListProps {
  cameras: Camera[];
  editingId: string | null;
  onEdit: (camera: Camera) => void;
  onCancelEdit: () => void;
  onSubmitEdit: (data: CameraFormData) => Promise<void>;
  onAutoSave?: (cameraId: string, data: CameraFormData) => Promise<void>;
  onDelete: (camera: Camera) => void;
  reorderMode?: boolean;
  onMove?: (index: number, direction: -1 | 1) => void;
}

export function CameraList({
  cameras,
  editingId,
  onEdit,
  onCancelEdit,
  onSubmitEdit,
  onAutoSave,
  onDelete,
  reorderMode,
  onMove,
}: CameraListProps) {
  if (cameras.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center px-4">
        <div className="rounded-2xl bg-card shadow-sm p-4 mb-4">
          <CameraIcon className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-muted-foreground text-sm">No cameras added yet</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-4 rounded-2xl bg-card shadow-sm overflow-hidden divide-y divide-border">
      {cameras.map((camera, index) => {
        const isEditing = editingId === camera.id;

        return (
          <div key={camera.id}>
            <div
              className="flex items-center gap-3 px-4 py-3 cursor-pointer"
              onClick={
                reorderMode
                  ? undefined
                  : () => (isEditing ? onCancelEdit() : onEdit(camera))
              }
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">
                    {camera.name}
                  </span>
                  {!reorderMode && (
                    <Badge
                      variant={camera.enabled ? "default" : "secondary"}
                      className="text-[10px] px-1.5 py-0"
                    >
                      {camera.enabled ? "Active" : "Disabled"}
                    </Badge>
                  )}
                </div>
                {!reorderMode && (
                  <div className="flex gap-2 mt-0.5">
                    {camera.detectEnabled && (
                      <span className="text-[10px] text-muted-foreground">
                        Detect
                      </span>
                    )}
                    {camera.recordEnabled && (
                      <span className="text-[10px] text-muted-foreground">
                        Record
                      </span>
                    )}
                    {camera.snapshotsEnabled && (
                      <span className="text-[10px] text-muted-foreground">
                        Snap
                      </span>
                    )}
                  </div>
                )}
              </div>

              {reorderMode ? (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => onMove?.(index, -1)}
                    disabled={index === 0}
                    className="tap-target inline-flex items-center justify-center rounded-md text-muted-foreground disabled:opacity-30 h-9 w-9"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => onMove?.(index, 1)}
                    disabled={index === cameras.length - 1}
                    className="tap-target inline-flex items-center justify-center rounded-md text-muted-foreground disabled:opacity-30 h-9 w-9"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(camera);
                    }}
                    className="tap-target inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive transition-colors h-9 w-9"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                  {isEditing ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              )}
            </div>

            {isEditing && !reorderMode && (
              <div className="border-t border-border bg-secondary/20">
                <CameraForm
                  camera={camera}
                  onSubmit={onSubmitEdit}
                  onAutoSave={
                    onAutoSave
                      ? (data) => onAutoSave(camera.id, data)
                      : undefined
                  }
                  onCancel={onCancelEdit}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
