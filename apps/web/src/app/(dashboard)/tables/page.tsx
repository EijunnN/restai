"use client";

import { useState, useMemo, useRef, useCallback } from "react";
import { Button } from "@restai/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@restai/ui/components/card";
import { Badge } from "@restai/ui/components/badge";
import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@restai/ui/components/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@restai/ui/components/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@restai/ui/components/tabs";
import {
  Plus,
  QrCode,
  Users,
  RefreshCw,
  Trash2,
  Edit2,
  Download,
  LayoutGrid,
  Check,
  X,
  Bell,
  Map,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Grid3X3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useTables,
  useCreateTable,
  useUpdateTableStatus,
  useUpdateTablePosition,
  useDeleteTable,
  useSpaces,
  useCreateSpace,
  useUpdateSpace,
  useDeleteSpace,
  usePendingSessions,
  useApproveSession,
  useRejectSession,
} from "@/hooks/use-tables";

// --- QR Code SVG Generator ---

function generateQRMatrix(data: string): boolean[][] {
  const size = 21;
  const matrix: boolean[][] = Array.from({ length: size }, () =>
    Array(size).fill(false)
  );

  // Finder patterns (top-left, top-right, bottom-left)
  const drawFinder = (row: number, col: number) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const isOuter = r === 0 || r === 6 || c === 0 || c === 6;
        const isInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        if (isOuter || isInner) {
          matrix[row + r][col + c] = true;
        }
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    matrix[6][i] = i % 2 === 0;
    matrix[i][6] = i % 2 === 0;
  }

  // Data encoding - simple hash of the string
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash + data.charCodeAt(i)) | 0;
  }

  // Fill data area with deterministic pattern based on the hash
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      // Skip finder patterns and timing
      if ((r < 8 && c < 8) || (r < 8 && c >= size - 8) || (r >= size - 8 && c < 8)) continue;
      if (r === 6 || c === 6) continue;

      const seed = (hash + r * 31 + c * 37 + r * c * 13) & 0xffff;
      matrix[r][c] = seed % 3 !== 0;
    }
  }

  return matrix;
}

function QRCodeSVG({ value, size = 200 }: { value: string; size?: number }) {
  const matrix = useMemo(() => generateQRMatrix(value), [value]);
  const cellSize = size / matrix.length;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width={size} height={size} fill="white" />
      {matrix.map((row, r) =>
        row.map(
          (cell, c) =>
            cell && (
              <rect
                key={`${r}-${c}`}
                x={c * cellSize}
                y={r * cellSize}
                width={cellSize}
                height={cellSize}
                fill="black"
              />
            )
        )
      )}
    </svg>
  );
}

// --- Status config ---

const statusConfig: Record<
  string,
  { label: string; color: string; bgColor: string; darkBgColor: string }
> = {
  available: {
    label: "Disponible",
    color: "text-green-700 dark:text-green-400",
    bgColor: "bg-green-50 border-green-200",
    darkBgColor: "dark:bg-green-950/30 dark:border-green-800",
  },
  occupied: {
    label: "Ocupada",
    color: "text-blue-700 dark:text-blue-400",
    bgColor: "bg-blue-50 border-blue-200",
    darkBgColor: "dark:bg-blue-950/30 dark:border-blue-800",
  },
  reserved: {
    label: "Reservada",
    color: "text-orange-700 dark:text-orange-400",
    bgColor: "bg-orange-50 border-orange-200",
    darkBgColor: "dark:bg-orange-950/30 dark:border-orange-800",
  },
  maintenance: {
    label: "Mantenimiento",
    color: "text-red-700 dark:text-red-400",
    bgColor: "bg-red-50 border-red-200",
    darkBgColor: "dark:bg-red-950/30 dark:border-red-800",
  },
};

const statusOptions = [
  { value: "available", label: "Disponible" },
  { value: "occupied", label: "Ocupada" },
  { value: "reserved", label: "Reservada" },
  { value: "maintenance", label: "Mantenimiento" },
];

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-muted rounded", className)} />;
}

// --- Floor Planner Status Colors ---
const plannerStatusColors: Record<string, { bg: string; border: string; text: string }> = {
  available: { bg: "bg-green-100 dark:bg-green-900/40", border: "border-green-400 dark:border-green-600", text: "text-green-800 dark:text-green-300" },
  occupied: { bg: "bg-blue-100 dark:bg-blue-900/40", border: "border-blue-400 dark:border-blue-600", text: "text-blue-800 dark:text-blue-300" },
  reserved: { bg: "bg-orange-100 dark:bg-orange-900/40", border: "border-orange-400 dark:border-orange-600", text: "text-orange-800 dark:text-orange-300" },
  maintenance: { bg: "bg-red-100 dark:bg-red-900/40", border: "border-red-400 dark:border-red-600", text: "text-red-800 dark:text-red-300" },
};

function FloorPlannerView({ tables }: { tables: any[] }) {
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

export default function TablesPage() {
  const [activeTab, setActiveTab] = useState("all");
  const [viewMode, setViewMode] = useState<"grid" | "planner">("grid");
  const [qrDialog, setQrDialog] = useState<any>(null);
  const [createTableDialog, setCreateTableDialog] = useState(false);
  const [createSpaceDialog, setCreateSpaceDialog] = useState(false);
  const [editSpaceDialog, setEditSpaceDialog] = useState<any>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: "table" | "space"; id: string; name: string } | null>(null);

  // Form states
  const [newTableNumber, setNewTableNumber] = useState("");
  const [newTableCapacity, setNewTableCapacity] = useState("4");
  const [newTableSpaceId, setNewTableSpaceId] = useState("none");
  const [newSpaceName, setNewSpaceName] = useState("");
  const [newSpaceDescription, setNewSpaceDescription] = useState("");
  const [newSpaceFloor, setNewSpaceFloor] = useState("1");
  const [editSpaceName, setEditSpaceName] = useState("");
  const [editSpaceDescription, setEditSpaceDescription] = useState("");
  const [editSpaceFloor, setEditSpaceFloor] = useState("1");

  // Data hooks
  const { data: spacesData, isLoading: spacesLoading } = useSpaces();
  const { data: tablesData, isLoading: tablesLoading, error, refetch } = useTables();
  const createTable = useCreateTable();
  const updateTableStatus = useUpdateTableStatus();
  const deleteTable = useDeleteTable();
  const createSpace = useCreateSpace();
  const updateSpace = useUpdateSpace();
  const deleteSpace = useDeleteSpace();

  const { data: pendingData } = usePendingSessions();
  const approveSession = useApproveSession();
  const rejectSession = useRejectSession();
  const pendingSessions: any[] = pendingData ?? [];

  const spaces: any[] = spacesData ?? [];
  const allTables: any[] = tablesData?.tables ?? [];
  const branchSlug: string = tablesData?.branchSlug ?? "";
  const isLoading = spacesLoading || tablesLoading;

  // Filter tables by active tab
  const filteredTables = useMemo(() => {
    if (activeTab === "all") return allTables;
    if (activeTab === "unassigned") return allTables.filter((t: any) => !t.space_id);
    return allTables.filter((t: any) => t.space_id === activeTab);
  }, [allTables, activeTab]);

  const counts = {
    total: allTables.length,
    available: allTables.filter((t: any) => t.status === "available").length,
    occupied: allTables.filter((t: any) => t.status === "occupied").length,
    reserved: allTables.filter((t: any) => t.status === "reserved").length,
  };

  const handleCreateTable = () => {
    const num = parseInt(newTableNumber);
    const cap = parseInt(newTableCapacity);
    if (!num || num < 1) return;
    createTable.mutate(
      {
        number: num,
        capacity: cap || 4,
        spaceId: newTableSpaceId === "none" ? undefined : newTableSpaceId,
      },
      {
        onSuccess: () => {
          setCreateTableDialog(false);
          setNewTableNumber("");
          setNewTableCapacity("4");
          setNewTableSpaceId("none");
        },
      }
    );
  };

  const handleCreateSpace = () => {
    if (!newSpaceName.trim()) return;
    createSpace.mutate(
      {
        name: newSpaceName.trim(),
        description: newSpaceDescription.trim() || undefined,
        floorNumber: parseInt(newSpaceFloor) || 1,
      },
      {
        onSuccess: () => {
          setCreateSpaceDialog(false);
          setNewSpaceName("");
          setNewSpaceDescription("");
          setNewSpaceFloor("1");
        },
      }
    );
  };

  const handleUpdateSpace = () => {
    if (!editSpaceDialog || !editSpaceName.trim()) return;
    updateSpace.mutate(
      {
        id: editSpaceDialog.id,
        name: editSpaceName.trim(),
        description: editSpaceDescription.trim() || undefined,
        floorNumber: parseInt(editSpaceFloor) || 1,
      },
      {
        onSuccess: () => setEditSpaceDialog(null),
      }
    );
  };

  const handleDelete = () => {
    if (!deleteConfirm) return;
    if (deleteConfirm.type === "table") {
      deleteTable.mutate(deleteConfirm.id, {
        onSuccess: () => setDeleteConfirm(null),
      });
    } else {
      deleteSpace.mutate(deleteConfirm.id, {
        onSuccess: () => {
          setDeleteConfirm(null);
          if (activeTab === deleteConfirm.id) setActiveTab("all");
        },
      });
    }
  };

  const handleStatusChange = (tableId: string, newStatus: string) => {
    updateTableStatus.mutate({ id: tableId, status: newStatus });
  };

  const handleDownloadQR = (table: any) => {
    const container = document.getElementById(`qr-svg-${table.id}`);
    const svgEl = container?.querySelector("svg");
    if (!svgEl) return;
    const svgData = new XMLSerializer().serializeToString(svgEl);
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 400;
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.onload = () => {
      ctx?.drawImage(img, 0, 0, 400, 400);
      const a = document.createElement("a");
      a.download = `mesa-${table.number}-qr.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
    };
    img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgData)));
  };

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Mesas</h1>
        </div>
        <div className="p-4 rounded-lg border border-destructive/50 bg-destructive/5 flex items-center justify-between">
          <p className="text-sm text-destructive">
            Error al cargar mesas: {(error as Error).message}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Mesas y Espacios</h1>
          <p className="text-muted-foreground">
            {isLoading
              ? "Cargando..."
              : `${counts.available} disponibles, ${counts.occupied} ocupadas de ${counts.total} mesas`}
          </p>
        </div>
        <div className="flex gap-2">
          <div className="flex border rounded-md">
            <Button
              variant={viewMode === "grid" ? "default" : "ghost"}
              size="sm"
              className="rounded-r-none"
              onClick={() => setViewMode("grid")}
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "planner" ? "default" : "ghost"}
              size="sm"
              className="rounded-l-none"
              onClick={() => setViewMode("planner")}
            >
              <Map className="h-4 w-4" />
            </Button>
          </div>
          <Button variant="outline" onClick={() => setCreateSpaceDialog(true)}>
            <LayoutGrid className="h-4 w-4 mr-2" />
            Nuevo Espacio
          </Button>
          <Button onClick={() => setCreateTableDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Nueva Mesa
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total", value: counts.total, color: "text-foreground" },
          { label: "Disponibles", value: counts.available, color: "text-green-600 dark:text-green-400" },
          { label: "Ocupadas", value: counts.occupied, color: "text-blue-600 dark:text-blue-400" },
          { label: "Reservadas", value: counts.reserved, color: "text-orange-600 dark:text-orange-400" },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">{stat.label}</p>
              <p className={cn("text-2xl font-bold", stat.color)}>
                {isLoading ? "-" : stat.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Pending Session Requests */}
      {pendingSessions.length > 0 && (
        <Card className="border-2 border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Bell className="h-4 w-4 text-amber-600" />
              Solicitudes pendientes ({pendingSessions.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {pendingSessions.map((session: any) => (
                <div
                  key={session.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-background border"
                >
                  <div>
                    <p className="font-medium">{session.customer_name}</p>
                    <p className="text-sm text-muted-foreground">
                      Mesa {session.table_number}
                      {session.customer_phone && ` · ${session.customer_phone}`}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      disabled={rejectSession.isPending}
                      onClick={() => rejectSession.mutate(session.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      disabled={approveSession.isPending}
                      onClick={() => approveSession.mutate(session.id)}
                    >
                      <Check className="h-4 w-4 mr-1" />
                      Aceptar
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs: All / Per Space / Unassigned */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center gap-2 overflow-x-auto">
          <TabsList>
            <TabsTrigger value="all">Todas</TabsTrigger>
            {spaces.map((space: any) => (
              <TabsTrigger key={space.id} value={space.id}>
                {space.name}
              </TabsTrigger>
            ))}
            <TabsTrigger value="unassigned">Sin espacio</TabsTrigger>
          </TabsList>
        </div>

        {/* Space info card (when a specific space is selected) */}
        {activeTab !== "all" && activeTab !== "unassigned" && (() => {
          const currentSpace = spaces.find((s: any) => s.id === activeTab);
          if (!currentSpace) return null;
          return (
            <Card className="mt-4">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">{currentSpace.name}</h3>
                  {currentSpace.description && (
                    <p className="text-sm text-muted-foreground">{currentSpace.description}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Piso {currentSpace.floor_number} - {filteredTables.length} mesas
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditSpaceName(currentSpace.name);
                      setEditSpaceDescription(currentSpace.description || "");
                      setEditSpaceFloor(String(currentSpace.floor_number));
                      setEditSpaceDialog(currentSpace);
                    }}
                  >
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setDeleteConfirm({
                        type: "space",
                        id: currentSpace.id,
                        name: currentSpace.name,
                      })
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })()}

        {/* View: Grid or Floor Planner */}
        {viewMode === "planner" ? (
          <div className="mt-4">
            <FloorPlannerView tables={filteredTables} />
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 mt-4">
            {isLoading
              ? Array.from({ length: 12 }).map((_, i) => (
                  <Skeleton key={i} className="rounded-xl h-36" />
                ))
              : filteredTables.map((table: any) => {
                  const config = statusConfig[table.status] || statusConfig.available;
                  return (
                    <Card
                      key={table.id}
                      className={cn(
                        "border-2 transition-all hover:shadow-md",
                        config.bgColor,
                        config.darkBgColor
                      )}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-2xl font-bold">{table.number}</span>
                          <Badge variant="outline" className={config.color}>
                            {config.label}
                          </Badge>
                        </div>
                        <div className="space-y-1 mb-3">
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            {table.capacity} personas
                          </p>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => setQrDialog(table)}
                            title="Ver QR"
                          >
                            <QrCode className="h-4 w-4" />
                          </Button>
                          {table.status === "available" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              disabled={updateTableStatus.isPending}
                              onClick={() => handleStatusChange(table.id, "occupied")}
                            >
                              Ocupar
                            </Button>
                          )}
                          {table.status === "occupied" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              disabled={updateTableStatus.isPending}
                              onClick={() => handleStatusChange(table.id, "available")}
                            >
                              Liberar
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 ml-auto text-destructive hover:text-destructive"
                            onClick={() =>
                              setDeleteConfirm({
                                type: "table",
                                id: table.id,
                                name: `Mesa ${table.number}`,
                              })
                            }
                            title="Eliminar"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        {/* Status selector */}
                        <Select value={table.status} onValueChange={(v) => handleStatusChange(table.id, v)}>
                          <SelectTrigger className="mt-2 h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {statusOptions.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </CardContent>
                    </Card>
                  );
                })}
          </div>
        )}
      </Tabs>

      {/* QR Code Dialog */}
      <Dialog open={!!qrDialog} onOpenChange={(open) => !open && setQrDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Codigo QR - Mesa {qrDialog?.number}
            </DialogTitle>
          </DialogHeader>
          {qrDialog && (
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="bg-white p-4 rounded-lg" id={`qr-svg-${qrDialog.id}`}>
                <QRCodeSVG
                  value={`http://localhost:3000/${branchSlug}/${qrDialog.qr_code}`}
                  size={240}
                />
              </div>
              <p className="text-sm text-muted-foreground text-center break-all">
                {`http://localhost:3000/${branchSlug}/${qrDialog.qr_code}`}
              </p>
              <p className="text-xs text-muted-foreground">
                Codigo: {qrDialog.qr_code}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setQrDialog(null)}>
              Cerrar
            </Button>
            <Button onClick={() => qrDialog && handleDownloadQR(qrDialog)}>
              <Download className="h-4 w-4 mr-2" />
              Descargar PNG
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Table Dialog */}
      <Dialog open={createTableDialog} onOpenChange={setCreateTableDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva Mesa</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="table-number">Numero de mesa</Label>
              <Input
                id="table-number"
                type="number"
                min={1}
                value={newTableNumber}
                onChange={(e) => setNewTableNumber(e.target.value)}
                placeholder="Ej: 1"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="table-capacity">Capacidad (personas)</Label>
              <Input
                id="table-capacity"
                type="number"
                min={1}
                max={50}
                value={newTableCapacity}
                onChange={(e) => setNewTableCapacity(e.target.value)}
                placeholder="4"
              />
            </div>
            <div className="space-y-2">
              <Label>Espacio (opcional)</Label>
              <Select value={newTableSpaceId} onValueChange={setNewTableSpaceId}>
                <SelectTrigger>
                  <SelectValue placeholder="Sin espacio" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin espacio</SelectItem>
                  {spaces.map((space: any) => (
                    <SelectItem key={space.id} value={space.id}>
                      {space.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateTableDialog(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleCreateTable}
              disabled={createTable.isPending || !newTableNumber}
            >
              {createTable.isPending ? "Creando..." : "Crear Mesa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Space Dialog */}
      <Dialog open={createSpaceDialog} onOpenChange={setCreateSpaceDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo Espacio</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="space-name">Nombre del espacio</Label>
              <Input
                id="space-name"
                value={newSpaceName}
                onChange={(e) => setNewSpaceName(e.target.value)}
                placeholder="Ej: Salon Principal, Terraza"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="space-description">Descripcion (opcional)</Label>
              <Input
                id="space-description"
                value={newSpaceDescription}
                onChange={(e) => setNewSpaceDescription(e.target.value)}
                placeholder="Area al aire libre..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="space-floor">Piso</Label>
              <Input
                id="space-floor"
                type="number"
                min={0}
                value={newSpaceFloor}
                onChange={(e) => setNewSpaceFloor(e.target.value)}
                placeholder="1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateSpaceDialog(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleCreateSpace}
              disabled={createSpace.isPending || !newSpaceName.trim()}
            >
              {createSpace.isPending ? "Creando..." : "Crear Espacio"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Space Dialog */}
      <Dialog open={!!editSpaceDialog} onOpenChange={(open) => !open && setEditSpaceDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Espacio</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-space-name">Nombre</Label>
              <Input
                id="edit-space-name"
                value={editSpaceName}
                onChange={(e) => setEditSpaceName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-space-desc">Descripcion</Label>
              <Input
                id="edit-space-desc"
                value={editSpaceDescription}
                onChange={(e) => setEditSpaceDescription(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-space-floor">Piso</Label>
              <Input
                id="edit-space-floor"
                type="number"
                min={0}
                value={editSpaceFloor}
                onChange={(e) => setEditSpaceFloor(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditSpaceDialog(null)}>
              Cancelar
            </Button>
            <Button
              onClick={handleUpdateSpace}
              disabled={updateSpace.isPending || !editSpaceName.trim()}
            >
              {updateSpace.isPending ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar Eliminacion</DialogTitle>
          </DialogHeader>
          <p className="py-4 text-sm text-muted-foreground">
            {deleteConfirm?.type === "space"
              ? `Estas seguro de eliminar el espacio "${deleteConfirm.name}"? Solo se puede eliminar si no tiene mesas asignadas.`
              : `Estas seguro de eliminar "${deleteConfirm?.name}"? Esta accion no se puede deshacer.`}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteTable.isPending || deleteSpace.isPending}
            >
              {deleteTable.isPending || deleteSpace.isPending
                ? "Eliminando..."
                : "Eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
