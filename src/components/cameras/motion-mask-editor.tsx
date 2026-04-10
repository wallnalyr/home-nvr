"use client";

import { useCallback, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2, Undo2, X } from "lucide-react";
import Image from "next/image";

interface MotionMaskEditorProps {
  cameraSlug: string;
  value: string | null;
  onChange: (mask: string | null) => void;
  detectWidth: number;
  detectHeight: number;
}

type Point = [number, number]; // normalized [0-1]
type Polygon = Point[];

function parsePolygons(value: string | null): Polygon[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every(Array.isArray)) return parsed;
  } catch {
    // invalid JSON
  }
  return [];
}

function serializePolygons(polygons: Polygon[]): string | null {
  if (polygons.length === 0) return null;
  return JSON.stringify(polygons);
}

export function MotionMaskEditor({
  cameraSlug,
  value,
  onChange,
  detectWidth,
  detectHeight,
}: MotionMaskEditorProps) {
  const [open, setOpen] = useState(false);
  const [polygons, setPolygons] = useState<Polygon[]>(() =>
    parsePolygons(value),
  );
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const [selectedPolygon, setSelectedPolygon] = useState<number | null>(null);
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      setOpen(isOpen);
      if (isOpen) {
        setPolygons(parsePolygons(value));
        setCurrentPoints([]);
        setSelectedPolygon(null);
        setSnapshotUrl(
          `/api/go2rtc/frame?src=${encodeURIComponent(cameraSlug)}&t=${Date.now()}`,
        );
      }
    },
    [value, cameraSlug],
  );

  const aspectRatio = detectWidth / detectHeight;

  const getRelativeCoords = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = e.currentTarget;
      const rect = svg.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      return [
        Math.max(0, Math.min(1, x)),
        Math.max(0, Math.min(1, y)),
      ] as Point;
    },
    [],
  );

  const handleSvgClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      // Don't place points when clicking a polygon to select it
      if ((e.target as SVGElement).dataset.polygonIndex) {
        setSelectedPolygon(
          Number((e.target as SVGElement).dataset.polygonIndex),
        );
        return;
      }
      setSelectedPolygon(null);
      const point = getRelativeCoords(e);
      setCurrentPoints((prev) => [...prev, point]);
    },
    [getRelativeCoords],
  );

  const finishPolygon = useCallback(() => {
    if (currentPoints.length < 3) return;
    const newPolygons = [...polygons, currentPoints];
    setPolygons(newPolygons);
    setCurrentPoints([]);
    onChange(serializePolygons(newPolygons));
  }, [currentPoints, polygons, onChange]);

  const undoPoint = useCallback(() => {
    setCurrentPoints((prev) => prev.slice(0, -1));
  }, []);

  const deletePolygon = useCallback(
    (index: number) => {
      const newPolygons = polygons.filter((_, i) => i !== index);
      setPolygons(newPolygons);
      setSelectedPolygon(null);
      onChange(serializePolygons(newPolygons));
    },
    [polygons, onChange],
  );

  const clearAll = useCallback(() => {
    setPolygons([]);
    setCurrentPoints([]);
    setSelectedPolygon(null);
    onChange(null);
  }, [onChange]);

  const polygonCount = parsePolygons(value).length;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button type="button" variant="secondary" className="h-9 rounded-lg">
            <Pencil className="mr-2 h-3.5 w-3.5" />
            {polygonCount > 0
              ? `Edit Mask (${polygonCount} zone${polygonCount !== 1 ? "s" : ""})`
              : "Draw Mask"}
          </Button>
        }
      />
      <DialogContent className="max-w-2xl" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Motion Mask</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Tap to place points. Areas inside masks are ignored for motion
            detection.
          </p>
        </DialogHeader>

        <div
          ref={containerRef}
          className="relative w-full overflow-hidden rounded-lg bg-black"
          style={{ aspectRatio }}
        >
          {snapshotUrl && (
            <Image
              ref={imgRef}
              src={snapshotUrl}
              alt="Camera snapshot"
              fill
              className="object-contain"
              draggable={false}
              unoptimized
            />
          )}
          <svg
            className="absolute inset-0 h-full w-full cursor-crosshair"
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
            onClick={handleSvgClick}
          >
            {/* Completed polygons */}
            {polygons.map((poly, i) => (
              <polygon
                key={i}
                data-polygon-index={i}
                points={poly.map((p) => `${p[0]},${p[1]}`).join(" ")}
                fill={
                  selectedPolygon === i
                    ? "rgba(239,68,68,0.5)"
                    : "rgba(239,68,68,0.35)"
                }
                stroke={selectedPolygon === i ? "#fff" : "rgba(239,68,68,0.8)"}
                strokeWidth={selectedPolygon === i ? 0.004 : 0.002}
                className="cursor-pointer"
              />
            ))}
            {/* In-progress polygon lines */}
            {currentPoints.length >= 2 && (
              <polyline
                points={currentPoints.map((p) => `${p[0]},${p[1]}`).join(" ")}
                fill="none"
                stroke="#facc15"
                strokeWidth={0.003}
                strokeDasharray="0.008 0.004"
              />
            )}
            {/* Closing preview line (last point → first point) */}
            {currentPoints.length >= 3 && (
              <line
                x1={currentPoints[currentPoints.length - 1][0]}
                y1={currentPoints[currentPoints.length - 1][1]}
                x2={currentPoints[0][0]}
                y2={currentPoints[0][1]}
                stroke="#facc15"
                strokeWidth={0.002}
                strokeDasharray="0.006 0.004"
                opacity={0.5}
              />
            )}
            {/* In-progress vertices */}
            {currentPoints.map((p, i) => (
              <circle
                key={i}
                cx={p[0]}
                cy={p[1]}
                r={0.008}
                fill="#facc15"
                stroke="#000"
                strokeWidth={0.002}
              />
            ))}
          </svg>

          {/* Delete button overlay for selected polygon */}
          {selectedPolygon !== null && (
            <div className="absolute top-2 right-2">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="h-8 rounded-lg"
                onClick={() => deletePolygon(selectedPolygon)}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Delete Zone
              </Button>
            </div>
          )}
        </div>

        <DialogFooter>
          <div className="flex w-full items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-9 rounded-lg"
              disabled={currentPoints.length === 0}
              onClick={undoPoint}
            >
              <Undo2 className="mr-1.5 h-3.5 w-3.5" />
              Undo
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              className="h-9 rounded-lg"
              disabled={currentPoints.length < 3}
              onClick={finishPolygon}
            >
              Finish Polygon
            </Button>
            <div className="flex-1" />
            {(polygons.length > 0 || currentPoints.length > 0) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 rounded-lg text-destructive"
                onClick={clearAll}
              >
                <X className="mr-1.5 h-3.5 w-3.5" />
                Clear All
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-9 rounded-lg"
              onClick={() => setOpen(false)}
            >
              Done
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
