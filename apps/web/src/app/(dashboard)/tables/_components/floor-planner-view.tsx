"use client";

import { useState, useRef, useCallback } from "react";
import { Button } from "@restai/ui/components/button";
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Grid3X3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUpdateTablePosition } from "@/hooks/use-tables";
import { statusConfig, plannerStatusColors } from "./constants";

export function FloorPlannerView({ tables }: { tables: any[] }) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragTablePos, setDragTablePos] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [panOffsetStart, setPanOffsetStart] = useState({ x: 0, y: 0 });
  const [showGrid, setShowGrid] = useState(true);
  // Track positions of recently dragged tables to prevent snap-back
  const [localPositions, setLocalPositions] = useState<Record<string, { x: number; y: number }>>({});
  const updatePosition = useUpdateTablePosition();
  const canvasRef = useRef<HTMLDivElement>(null);

  const getTableSize = useCallback((capacity: number) => {
    if (capacity <= 2) return { w: 80, h: 80 };
    if (capacity <= 4) return { w: 96, h: 80 };
    return { w: 112, h: 80 };
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom((z) => Math.min(3, Math.max(0.25, z + delta)));
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Only start panning if clicking on the canvas background (not a table)
    if ((e.target as HTMLElement).closest("[data-table-id]")) return;
    setIsPanning(true);
    setPanStart({ x: e.clientX, y: e.clientY });
    setPanOffsetStart({ ...offset });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [offset]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (isPanning) {
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      setOffset({ x: panOffsetStart.x + dx, y: panOffsetStart.y + dy });
    }
    if (dragging) {
      const dx = (e.clientX - dragStart.x) / zoom;
      const dy = (e.clientY - dragStart.y) / zoom;
      setDragTablePos((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
      setDragStart({ x: e.clientX, y: e.clientY });
    }
  }, [isPanning, panStart, panOffsetStart, dragging, dragStart, zoom]);

  const handlePointerUp = useCallback(() => {
    if (isPanning) {
      setIsPanning(false);
    }
    if (dragging) {
      const finalX = Math.round(dragTablePos.x);
      const finalY = Math.round(dragTablePos.y);
      // Keep the position locally so the table doesn't snap back
      setLocalPositions((prev) => ({ ...prev, [dragging]: { x: finalX, y: finalY } }));
      updatePosition.mutate(
        { id: dragging, x: finalX, y: finalY },
        {
          onSettled: () => {
            // Clear local override once query cache is up to date
            setLocalPositions((prev) => {
              const next = { ...prev };
              delete next[dragging];
              return next;
            });
          },
        }
      );
      setDragging(null);
    }
  }, [isPanning, dragging, dragTablePos, updatePosition]);

  const handleTablePointerDown = useCallback((e: React.PointerEvent, table: any) => {
    e.stopPropagation();
    const localPos = localPositions[table.id];
    setDragging(table.id);
    setDragStart({ x: e.clientX, y: e.clientY });
    setDragTablePos({ x: localPos?.x ?? table.position_x, y: localPos?.y ?? table.position_y });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [localPositions]);

  const gridSize = 40;

  return (
    <div className="flex flex-col gap-3">
      {/* Controls */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}>
          <ZoomOut className="h-4 w-4" />
        </Button>
        <span className="text-xs text-muted-foreground min-w-[3rem] text-center">
          {Math.round(zoom * 100)}%
        </span>
        <Button variant="outline" size="sm" onClick={() => { setOffset({ x: 0, y: 0 }); setZoom(1); }}>
          <RotateCcw className="h-4 w-4" />
        </Button>
        <Button
          variant={showGrid ? "default" : "outline"}
          size="sm"
          onClick={() => setShowGrid((g) => !g)}
        >
          <Grid3X3 className="h-4 w-4" />
        </Button>
        <div className="ml-auto flex gap-3 text-xs text-muted-foreground">
          {Object.entries(plannerStatusColors).map(([status, colors]) => (
            <div key={status} className="flex items-center gap-1">
              <div className={cn("w-3 h-3 rounded border", colors.bg, colors.border)} />
              <span>{statusConfig[status]?.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={canvasRef}
        className="relative overflow-hidden rounded-lg border bg-muted/30 select-none"
        style={{ height: "calc(100vh - 420px)", minHeight: 400, cursor: isPanning ? "grabbing" : "grab" }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Transform layer */}
        <div
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
            position: "absolute",
            inset: 0,
          }}
        >
          {/* Grid */}
          {showGrid && (
            <svg className="absolute inset-0 pointer-events-none" width="100%" height="100%" style={{ minWidth: 3000, minHeight: 3000, position: "absolute", top: -1500, left: -1500 }}>
              <defs>
                <pattern id="grid" width={gridSize} height={gridSize} patternUnits="userSpaceOnUse">
                  <path d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`} fill="none" stroke="currentColor" strokeWidth="0.5" className="text-muted-foreground/20" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid)" />
            </svg>
          )}

          {/* Tables */}
          {tables.map((table: any) => {
            const isBeingDragged = dragging === table.id;
            const localPos = localPositions[table.id];
            const posX = isBeingDragged ? dragTablePos.x : (localPos?.x ?? table.position_x);
            const posY = isBeingDragged ? dragTablePos.y : (localPos?.y ?? table.position_y);
            const size = getTableSize(table.capacity);
            const colors = plannerStatusColors[table.status] || plannerStatusColors.available;

            return (
              <div
                key={table.id}
                data-table-id={table.id}
                className={cn(
                  "absolute rounded-lg border-2 flex flex-col items-center justify-center select-none transition-shadow",
                  colors.bg,
                  colors.border,
                  isBeingDragged ? "shadow-lg z-50 opacity-90" : "shadow-sm hover:shadow-md cursor-grab",
                )}
                style={{
                  width: size.w,
                  height: size.h,
                  transform: `translate(${posX}px, ${posY}px)`,
                  touchAction: "none",
                }}
                onPointerDown={(e) => handleTablePointerDown(e, table)}
              >
                <span className={cn("text-lg font-bold leading-none", colors.text)}>
                  {table.number}
                </span>
                <span className="text-[10px] text-muted-foreground mt-0.5">
                  {table.capacity}p
                </span>
                <span className={cn("text-[9px] mt-0.5", colors.text)}>
                  {statusConfig[table.status]?.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Empty state */}
        {tables.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-muted-foreground">No hay mesas para mostrar</p>
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Arrastra las mesas para posicionarlas. Usa la rueda del raton para hacer zoom. Clic y arrastra el fondo para desplazarte.
      </p>
    </div>
  );
}
