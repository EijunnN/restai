"use client";

import { useCallback, useRef, useState } from "react";
import {
  Bell,
  ChevronUp,
  DoorOpen,
  Grid3X3,
  Layers,
  Maximize2,
  Minus,
  Plus,
  ReceiptText,
  Sprout,
  Users,
  Utensils,
  Wine,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { hasPermission } from "@/lib/permissions";
import { useAuthStore } from "@/stores/auth-store";
import {
  useCreateFixture,
  useDeleteFixture,
  useSpaceFixtures,
  useUpdateFixture,
  useUpdateTablePosition,
  type SpaceFixture,
  type TableRow,
} from "@/hooks/use-tables";
import {
  CANVAS,
  SEAT_PAD,
  SHAPE_SIZE,
  placeFixture,
  placeTable,
  seatPositions,
  type TableShape,
} from "./floor-plan";
import type { TableServiceRequestIndicator } from "./tables-context";

/**
 * Plano de la sala.
 *
 * Deja de ser un diagrama de rectángulos y pasa a parecerse al local: cada mesa
 * tiene su silueta, su giro y sus sillas —rellenas si hay alguien sentado—, y
 * alrededor están las referencias fijas (cocina, barra, baños, entrada) que son
 * las que permiten decir "la 12 es la del fondo".
 *
 * Dos modos, y la distinción importa:
 *  - **Operar** es lo que hace el mozo todo el día: mirar y tocar una mesa para
 *    abrir su ficha. Nada se mueve por accidente.
 *  - **Editar** dibuja el local, y solo aparece con `tables:layout`. Antes el
 *    plano estaba SIEMPRE en modo edición: cualquiera que arrastrase sin querer
 *    movía la sala, o se llevaba un 403 sin haber pedido nada.
 */

interface Props {
  tables: TableRow[];
  requestByTableId: Record<string, TableServiceRequestIndicator>;
  /** Espacio que se está dibujando. Sin él no se puede colocar mobiliario. */
  spaceId?: string | null;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Avisa a la ficha de que ahora se dibuja el local, no se opera. */
  onModeChange?: (editing: boolean) => void;
}

/** Icono y rótulo por defecto de cada tipo de mobiliario. */
const FIXTURE_KIND = {
  kitchen: { icon: Utensils, label: "Cocina" },
  bar: { icon: Wine, label: "Barra" },
  stairs: { icon: ChevronUp, label: "Escalera" },
  restroom: { icon: DoorOpen, label: "Baños" },
  entrance: { icon: DoorOpen, label: "Entrada" },
  wall: { icon: Layers, label: "Muro" },
  plant: { icon: Sprout, label: "Planta" },
  other: { icon: Layers, label: "Elemento" },
} as const;

/** Colores del tablero por estado, con su par `dark:`. */
const ESTADO: Record<string, { top: string; seat: string; ring: string }> = {
  available: {
    top: "bg-card border-border",
    seat: "border-muted-foreground/40",
    ring: "",
  },
  occupied: {
    top: "bg-blue-50 border-blue-400 dark:bg-blue-950/40 dark:border-blue-500/60",
    seat: "border-blue-500 bg-blue-500",
    ring: "shadow-[0_0_28px_rgba(59,130,246,0.18)]",
  },
  reserved: {
    top: "bg-amber-50 border-amber-400 dark:bg-amber-950/30 dark:border-amber-500/60",
    seat: "border-amber-500",
    ring: "",
  },
  maintenance: {
    top: "bg-transparent border-dashed border-border",
    seat: "border-muted-foreground/25",
    ring: "",
  },
};

export function FloorPlannerView({
  tables,
  requestByTableId,
  spaceId,
  selectedId,
  onSelect,
  onModeChange,
}: Props) {
  const role = useAuthStore((s) => s.user?.role);
  const canLayout = hasPermission(role, "tables:layout");

  const [mode, setMode] = useState<"operate" | "edit">("operate");
  const [snap, setSnap] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  /** Arrastre en curso, sea de una mesa o de un elemento fijo. */
  const [drag, setDrag] = useState<{
    kind: "table" | "fixture";
    id: string;
    x: number;
    y: number;
    px: number;
    py: number;
  } | null>(null);
  const [pan, setPan] = useState<{ px: number; py: number; ox: number; oy: number } | null>(
    null,
  );

  // Posición recién soltada, hasta que el caché del servidor se pone al día.
  // Sin esto la mesa vuelve de un salto a su sitio anterior y parece que el
  // arrastre no se guardó.
  const [localPos, setLocalPos] = useState<Record<string, { x: number; y: number }>>({});

  const updatePosition = useUpdateTablePosition();
  const updateFixture = useUpdateFixture();
  const createFixture = useCreateFixture();
  const deleteFixture = useDeleteFixture();
  const { data: fixtures = [] } = useSpaceFixtures(spaceId ?? null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const isEdit = mode === "edit" && canLayout;

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom((z) => Math.min(2.5, Math.max(0.4, z + (e.deltaY > 0 ? -0.1 : 0.1))));
  }, []);

  const startPan = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-plan-item]")) return;
    setPan({ px: e.clientX, py: e.clientY, ox: offset.x, oy: offset.y });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (pan) {
      setOffset({ x: pan.ox + (e.clientX - pan.px), y: pan.oy + (e.clientY - pan.py) });
      return;
    }
    if (!drag) return;

    const dx = (e.clientX - drag.px) / zoom;
    const dy = (e.clientY - drag.py) / zoom;

    if (drag.kind === "table") {
      const t = tables.find((x) => x.id === drag.id);
      if (!t) return;
      const p = placeTable(drag.x + dx, drag.y + dy, (t.shape as TableShape) ?? "square", snap);
      setLocalPos((prev) => ({ ...prev, [drag.id]: p }));
    } else {
      const f = fixtures.find((x) => x.id === drag.id);
      if (!f) return;
      const p = placeFixture(drag.x + dx, drag.y + dy, f.width, f.height, snap);
      setLocalPos((prev) => ({ ...prev, [drag.id]: p }));
    }
  };

  const onPointerUp = () => {
    if (pan) setPan(null);
    if (!drag) return;

    const final = localPos[drag.id];
    const target = drag;
    setDrag(null);
    if (!final) return;

    const clear = () =>
      setLocalPos((prev) => {
        const next = { ...prev };
        delete next[target.id];
        return next;
      });

    if (target.kind === "table") {
      updatePosition.mutate({ id: target.id, x: final.x, y: final.y }, { onSettled: clear });
    } else {
      updateFixture.mutate({ id: target.id, x: final.x, y: final.y }, { onSettled: clear });
    }
  };

  const startDrag = (
    e: React.PointerEvent,
    kind: "table" | "fixture",
    id: string,
    x: number,
    y: number,
  ) => {
    if (!isEdit) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ kind, id, x, y, px: e.clientX, py: e.clientY });
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <style>{`
        @keyframes plan-pulse { 0% { transform: scale(1); opacity: .55 } 70% { transform: scale(2.1); opacity: 0 } 100% { opacity: 0 } }
        .animate-plan-pulse { animation: plan-pulse 2.4s ease-out infinite }
        @media (prefers-reduced-motion: reduce) { .animate-plan-pulse { animation: none } }
      `}</style>

      {/* ── Controles ──────────────────────────────────────────────────── */}
      <div className="flex flex-none flex-wrap items-center gap-2">
        {/* Editar el plano es dibujar el local: sin `tables:layout` el botón no
            existe, en vez de ofrecerlo y devolver un 403 al soltar la mesa. */}
        {canLayout && (
          <button
            type="button"
            aria-pressed={isEdit}
            onClick={() => {
              const next = isEdit ? "operate" : "edit";
              setMode(next);
              onModeChange?.(next === "edit");
            }}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] font-semibold transition-colors",
              isEdit
                ? "bg-primary text-primary-foreground"
                : "bg-foreground/[0.05] text-muted-foreground hover:text-foreground dark:bg-white/[0.06]",
            )}
          >
            <Layers className="h-[15px] w-[15px]" aria-hidden="true" />
            {isEdit ? "Editando el plano" : "Editar plano"}
          </button>
        )}

        {isEdit && (
          <button
            type="button"
            aria-pressed={snap}
            onClick={() => setSnap((v) => !v)}
            title="Ajustar las mesas a una rejilla"
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] font-semibold transition-colors",
              snap
                ? "bg-foreground/[0.10] text-foreground dark:bg-white/[0.12]"
                : "bg-foreground/[0.05] text-muted-foreground hover:text-foreground dark:bg-white/[0.06]",
            )}
          >
            <Grid3X3 className="h-[15px] w-[15px]" aria-hidden="true" />
            Rejilla
          </button>
        )}

        <span className="flex-1" />

        <div className="flex items-center gap-1 rounded-lg bg-muted p-[3px]">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.4, z - 0.1))}
            aria-label="Alejar"
            title="Alejar"
            className="flex h-[30px] w-[30px] items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
          >
            <Minus className="h-4 w-4" aria-hidden="true" />
          </button>
          <span className="min-w-[3rem] text-center text-[12px] tabular-nums text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(2.5, z + 0.1))}
            aria-label="Acercar"
            title="Acercar"
            className="flex h-[30px] w-[30px] items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => {
              setZoom(1);
              setOffset({ x: 0, y: 0 });
            }}
            aria-label="Encuadrar el plano"
            title="Encuadrar"
            className="flex h-[30px] w-[30px] items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
          >
            <Maximize2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* ── Lienzo ─────────────────────────────────────────────────────── */}
      <div
        ref={canvasRef}
        onWheel={handleWheel}
        onPointerDown={startPan}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={cn(
          "relative min-h-[420px] flex-1 select-none overflow-hidden rounded-xl border border-border bg-muted/20",
          pan ? "cursor-grabbing" : "cursor-grab",
        )}
      >
        <div
          className="absolute origin-top-left"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            width: CANVAS.width,
            height: CANVAS.height,
          }}
        >
          {/* Contorno de la sala */}
          <div className="absolute inset-0 rounded-2xl border-[5px] border-border/70" />

          {isEdit && (
            <div
              aria-hidden="true"
              className="absolute inset-0 opacity-[0.35]"
              style={{
                backgroundImage:
                  "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
                backgroundSize: "20px 20px",
                color: "var(--color-border)",
              }}
            />
          )}

          {/* Mobiliario fijo */}
          {fixtures.map((f) => (
            <FixtureBox
              key={f.id}
              fixture={f}
              pos={localPos[f.id]}
              editable={isEdit}
              onPointerDown={(e) =>
                startDrag(e, "fixture", f.id, f.position_x, f.position_y)
              }
              onRemove={isEdit ? () => deleteFixture.mutate(f.id) : undefined}
            />
          ))}

          {/* Mesas */}
          {tables.map((t) => (
            <TableShapeBox
              key={t.id}
              table={t}
              pos={localPos[t.id]}
              selected={selectedId === t.id}
              dragging={drag?.id === t.id}
              editable={isEdit}
              request={requestByTableId[t.id]}
              onSelect={() => onSelect?.(t.id)}
              onPointerDown={(e) => startDrag(e, "table", t.id, t.position_x, t.position_y)}
            />
          ))}
        </div>

        {tables.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-[13.5px] text-muted-foreground">
              No hay mesas en este espacio.
            </p>
          </div>
        )}

        {/* Leyenda */}
        <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card/90 px-3 py-2 text-[11px] text-muted-foreground backdrop-blur">
          <Legend swatch="border border-muted-foreground/50" label="Libre" />
          <Legend swatch="bg-blue-600 dark:bg-blue-500" label="Ocupada" />
          <Legend swatch="bg-amber-500" label="Reservada" />
          <Legend swatch="bg-muted-foreground/30" label="Fuera de servicio" />
        </div>
      </div>

      {/*
        Paleta de mobiliario. Sin esto, la cocina y la barra serían datos que
        nadie puede crear desde la interfaz: el plano quedaría siempre como un
        rectángulo vacío por mucho que la base lo soporte.

        Necesita un espacio concreto: el mobiliario cuelga del ambiente, así que
        con el filtro en "Todas" no hay dónde ponerlo.
      */}
      {isEdit && (
        <div className="flex flex-none flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2">
          <span className="px-1 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            Añadir
          </span>
          {spaceId ? (
            (Object.keys(FIXTURE_KIND) as (keyof typeof FIXTURE_KIND)[])
              .filter((k) => k !== "other")
              .map((kind) => {
                const meta = FIXTURE_KIND[kind];
                const Icon = meta.icon;
                return (
                  <button
                    key={kind}
                    type="button"
                    disabled={createFixture.isPending}
                    title={`Añadir ${meta.label.toLowerCase()} al plano`}
                    onClick={() =>
                      createFixture.mutate({
                        spaceId,
                        kind,
                        // Aparece arriba a la izquierda, dentro del lienzo y
                        // sin taparse con lo que ya hay: desde ahí se arrastra.
                        x: 40,
                        y: 40,
                        width: kind === "bar" || kind === "wall" ? 200 : 120,
                        height: kind === "bar" || kind === "wall" ? 48 : 90,
                      })
                    }
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-foreground/[0.05] px-2.5 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50 dark:bg-white/[0.06]"
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    {meta.label}
                  </button>
                );
              })
          ) : (
            <span className="text-[12px] text-muted-foreground">
              Elige un espacio concreto para colocar cocina, barra o baños.
            </span>
          )}
          <span className="flex-1" />
          <span className="text-[11.5px] text-muted-foreground">
            Doble clic en un elemento para quitarlo
          </span>
        </div>
      )}

      <p className="flex-none text-[11.5px] text-muted-foreground">
        {isEdit
          ? "Arrastra las mesas y el mobiliario para colocarlos. Ctrl + rueda para el zoom."
          : "Toca una mesa para abrir su ficha. Ctrl + rueda para el zoom, arrastra el fondo para moverte."}
      </p>
    </div>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-2 w-2 rounded-full", swatch)} />
      {label}
    </span>
  );
}

// ── Mesa ────────────────────────────────────────────────────────────────────

function TableShapeBox({
  table,
  pos,
  selected,
  dragging,
  editable,
  request,
  onSelect,
  onPointerDown,
}: {
  table: TableRow;
  pos?: { x: number; y: number };
  selected: boolean;
  dragging: boolean;
  editable: boolean;
  request?: TableServiceRequestIndicator;
  onSelect: () => void;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const shape = ((table.shape as TableShape) ?? "square") as TableShape;
  const size = SHAPE_SIZE[shape] ?? SHAPE_SIZE.square;
  const estado = ESTADO[table.status] ?? ESTADO.available;
  const sesion = table.active_session;
  const ocupada = table.status === "occupied";

  const x = pos?.x ?? table.position_x;
  const y = pos?.y ?? table.position_y;

  // Sillas rellenas = comensales declarados. Sin dato, todas vacías: es más
  // honesto que dar por hecho que la mesa está llena.
  const sentados =
    ocupada && typeof sesion?.guest_count === "number" ? sesion.guest_count : 0;
  const seats = seatPositions(shape, Math.min(table.capacity ?? 0, 12), size.w, size.h);

  const AvisoIcon = request?.type === "request_bill" ? ReceiptText : Bell;

  return (
    <div
      data-plan-item
      data-table-id={table.id}
      onPointerDown={onPointerDown}
      onClick={() => !editable && onSelect()}
      className="absolute"
      style={{
        left: x,
        top: y,
        width: size.w + SEAT_PAD * 2,
        height: size.h + SEAT_PAD * 2,
        transform: `rotate(${table.rotation ?? 0}deg)`,
        cursor: editable ? (dragging ? "grabbing" : "grab") : "pointer",
        touchAction: "none",
        zIndex: dragging ? 30 : selected ? 20 : 2,
      }}
    >
      {seats.map((s, i) => (
        <span
          key={i}
          className={cn(
            "absolute h-[14px] w-[14px] border-[1.5px] box-border",
            s.round ? "rounded-full" : "rounded-[5px]",
            i < sentados ? estado.seat : "border-foreground/20 dark:border-white/20",
          )}
          style={{ left: SEAT_PAD + s.x, top: SEAT_PAD + s.y }}
        />
      ))}

      <div
        className={cn(
          "absolute flex flex-col items-center justify-center gap-0.5 border-[1.5px] shadow-sm",
          shape === "round" ? "rounded-full" : "rounded-xl",
          estado.top,
          estado.ring,
          selected && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
        )}
        style={{ left: SEAT_PAD, top: SEAT_PAD, width: size.w, height: size.h }}
      >
        <span
          className={cn(
            "text-[23px] font-bold leading-none tracking-[-0.04em] tabular-nums",
            table.status === "maintenance" ? "text-muted-foreground/50" : "text-foreground",
          )}
        >
          {table.number}
        </span>
        {ocupada && sesion && (
          <span className="text-[10.5px] font-semibold tabular-nums text-muted-foreground">
            {sesion.elapsed_minutes}m · {sesion.order_count}p
          </span>
        )}
      </div>

      {request && (
        <span
          title={`${request.customerName}: ${
            request.type === "request_bill" ? "pide la cuenta" : "llama al mozo"
          }`}
          className={cn(
            "absolute flex h-6 w-6 items-center justify-center rounded-full text-white shadow",
            request.type === "request_bill"
              ? "bg-violet-600 dark:bg-violet-500"
              : "bg-orange-500",
          )}
          style={{ left: SEAT_PAD + size.w - 8, top: SEAT_PAD - 10 }}
        >
          <span className="absolute inset-0 rounded-full bg-current opacity-40 animate-plan-pulse" />
          <AvisoIcon className="relative h-3 w-3" aria-hidden="true" />
        </span>
      )}
    </div>
  );
}

// ── Mobiliario ──────────────────────────────────────────────────────────────

function FixtureBox({
  fixture,
  pos,
  editable,
  onPointerDown,
  onRemove,
}: {
  fixture: SpaceFixture;
  pos?: { x: number; y: number };
  editable: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onRemove?: () => void;
}) {
  const meta = FIXTURE_KIND[fixture.kind] ?? FIXTURE_KIND.other;
  const Icon = meta.icon;

  return (
    <div
      data-plan-item
      onPointerDown={onPointerDown}
      onDoubleClick={onRemove}
      title={onRemove ? "Doble clic para quitarlo del plano" : undefined}
      className="absolute flex flex-col items-center justify-center gap-1.5 rounded-lg border border-border/60 bg-foreground/[0.03] text-muted-foreground dark:bg-white/[0.03]"
      style={{
        left: pos?.x ?? fixture.position_x,
        top: pos?.y ?? fixture.position_y,
        width: fixture.width,
        height: fixture.height,
        transform: `rotate(${fixture.rotation}deg)`,
        cursor: editable ? "grab" : "default",
        touchAction: "none",
        zIndex: 1,
      }}
    >
      <Icon className="h-4 w-4 opacity-60" aria-hidden="true" />
      <span className="text-[10px] font-bold uppercase tracking-[0.18em] opacity-75">
        {fixture.label || meta.label}
      </span>
    </div>
  );
}
