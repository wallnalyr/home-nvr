"use client";

import { Button } from "@/components/ui/button";
import { Bookmark, CheckSquare, Trash2, X } from "lucide-react";
import type { Camera } from "@/types/camera";

interface EventFiltersProps {
  cameras: Camera[];
  enabledObjects: string[];
  selectedCamera: string;
  selectedLabel: string;
  selectedRange: string;
  showSaved: boolean;
  onCameraChange: (camera: string) => void;
  onLabelChange: (label: string) => void;
  onRangeChange: (range: string) => void;
  onShowSavedChange: (saved: boolean) => void;
  selectMode?: boolean;
  selectedCount?: number;
  totalCount?: number;
  deleting?: boolean;
  onEnterSelectMode?: () => void;
  onExitSelectMode?: () => void;
  onSelectAll?: () => void;
  onDeleteSelected?: () => void;
}

const DATE_RANGES = [
  { value: "today", label: "Today" },
  { value: "3d", label: "Last 3 Days" },
  { value: "7d", label: "Last Week" },
  { value: "14d", label: "Last 2 Weeks" },
  { value: "30d", label: "Last Month" },
];

function PillRow({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide px-1">
        {label}
      </label>
      <div className="overflow-x-auto scrollbar-hide">
        <div className="flex gap-1.5 w-max">
          {options.map((opt) => {
            const isSelected = selected === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => onChange(opt.value)}
                className={`
                  shrink-0 px-3 py-1.5 rounded-full text-xs font-medium
                  transition-all duration-150
                  ${
                    isSelected
                      ? "bg-ios-blue text-white shadow-sm"
                      : "bg-secondary/60 text-secondary-foreground"
                  }
                `}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function EventFilters({
  cameras,
  enabledObjects,
  selectedCamera,
  selectedLabel,
  selectedRange,
  showSaved,
  onCameraChange,
  onLabelChange,
  onRangeChange,
  onShowSavedChange,
  selectMode,
  selectedCount = 0,
  totalCount = 0,
  deleting,
  onEnterSelectMode,
  onExitSelectMode,
  onSelectAll,
  onDeleteSelected,
}: EventFiltersProps) {
  // Select mode action bar
  if (selectMode) {
    return (
      <div className="px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={onExitSelectMode}
              className="tap-target inline-flex items-center justify-center h-9 w-9 rounded-lg text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
            <span className="text-sm font-medium">
              {selectedCount} selected
            </span>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-8 rounded-lg"
              onClick={onSelectAll}
              disabled={selectedCount === totalCount}
            >
              Select All
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-8 rounded-lg text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={onDeleteSelected}
              disabled={selectedCount === 0 || deleting}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const cameraOptions = [
    { value: "all", label: "All" },
    ...cameras.map((cam) => ({ value: cam.slug, label: cam.name })),
  ];

  const labelOptions = [
    { value: "all", label: "All" },
    ...enabledObjects.map((l) => ({
      value: l,
      label: l.charAt(0).toUpperCase() + l.slice(1).replace(/_/g, " "),
    })),
  ];

  return (
    <div className="space-y-2 px-4 py-3">
      {/* Camera pills + action buttons */}
      <div className="flex gap-2 items-end">
        <div className="flex-1 min-w-0">
          <PillRow
            label="Camera"
            options={cameraOptions}
            selected={selectedCamera}
            onChange={onCameraChange}
          />
        </div>
        <div className="flex gap-1 shrink-0 pb-0.5">
          <Button
            variant={showSaved ? "default" : "ghost"}
            size="icon"
            className={`h-8 w-8 rounded-lg ${
              showSaved
                ? "bg-ios-blue text-white hover:bg-ios-blue/90"
                : "bg-secondary/50 text-muted-foreground hover:bg-secondary"
            }`}
            onClick={() => onShowSavedChange(!showSaved)}
          >
            <Bookmark
              className={`h-3.5 w-3.5 ${showSaved ? "fill-white" : ""}`}
            />
          </Button>
          {onEnterSelectMode && totalCount > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg bg-secondary/50 text-muted-foreground hover:bg-secondary"
              onClick={onEnterSelectMode}
            >
              <CheckSquare className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Object pills */}
      <PillRow
        label="Object"
        options={labelOptions}
        selected={selectedLabel}
        onChange={onLabelChange}
      />

      {/* Date range */}
      <PillRow
        label="Date"
        options={DATE_RANGES}
        selected={selectedRange}
        onChange={onRangeChange}
      />
    </div>
  );
}
