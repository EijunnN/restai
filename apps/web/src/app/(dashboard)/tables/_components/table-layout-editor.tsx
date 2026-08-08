"use client";

import { Loader2, Minus, Plus, RotateCcw, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useUpdateTable,
  useUpdateTablePosition,
  type TableRow,
} from "@/hooks/use-tables";
import { normalizeRotation, type TableShape } from "./floor-plan";

/**
 * Ajustes de una mesa EN EL PLANO: silueta, aforo y giro.
 *
 * Va aparte de la ficha de operación porque responde a otra pregunta. El mozo
 * pregunta "¿qué pasa en esta mesa?"; esto contesta "¿cómo es esta mesa?", y
 * solo hace falta el día que se monta el local o se cambia la distribución. Por
 * eso vive tras `tables:layout` y solo aparece con el plano en modo edición.
 */

const FORMAS: { key: TableShape; label: string }[] = [
  { key: "round", label: "Redonda" },
  { key: "square", label: "Cuadrada" },
  { key: "rect", label: "Rect." },
  { key: "bar", label: "Barra" },
];

/** El giro se mueve en pasos de 15°: suficiente para una terraza, sin temblor. */
const PASO_GIRO = 15;

export function TableLayoutEditor({ table }: { table: TableRow }) {
  const placement = useUpdateTablePosition();
  const updateTable = useUpdateTable();

  const shape = ((table.shape as TableShape) ?? "square") as TableShape;
  const rotation = table.rotation ?? 0;
  const busy = placement.isPending || updateTable.isPending;

  /** Forma y giro viajan por el endpoint de plano, con la posición actual. */
  const place = (patch: { shape?: TableShape; rotation?: number }) =>
    placement.mutate({
      id: table.id,
      x: table.position_x,
      y: table.position_y,
      ...patch,
    });

  return (
    <div className="border-t border-border pt-4">
      <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
        Forma
      </p>
      <div className="flex gap-1 rounded-xl bg-muted p-1">
        {FORMAS.map((f) => (
          <button
            key={f.key}
            type="button"
            disabled={busy}
            aria-pressed={shape === f.key}
            onClick={() => place({ shape: f.key })}
            className={cn(
              "h-8 flex-1 rounded-lg text-[11.5px] font-semibold transition-colors disabled:opacity-50",
              shape === f.key
                ? "bg-background text-foreground shadow"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="mt-4 flex gap-2.5">
        <div className="flex-1">
          <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            Aforo
          </p>
          <Stepper
            value={table.capacity}
            busy={busy}
            onDown={() =>
              updateTable.mutate({ id: table.id, capacity: Math.max(1, table.capacity - 1) })
            }
            onUp={() =>
              updateTable.mutate({ id: table.id, capacity: Math.min(50, table.capacity + 1) })
            }
            downLabel="Quitar una plaza"
            upLabel="Añadir una plaza"
          />
        </div>

        <div className="flex-1">
          <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            Giro
          </p>
          <Stepper
            value={`${rotation}°`}
            busy={busy}
            icon="rotate"
            onDown={() => place({ rotation: normalizeRotation(rotation - PASO_GIRO) })}
            onUp={() => place({ rotation: normalizeRotation(rotation + PASO_GIRO) })}
            downLabel="Girar a la izquierda"
            upLabel="Girar a la derecha"
          />
        </div>
      </div>

      {busy && (
        <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          Guardando…
        </p>
      )}
    </div>
  );
}

function Stepper({
  value,
  busy,
  icon,
  onDown,
  onUp,
  downLabel,
  upLabel,
}: {
  value: string | number;
  busy: boolean;
  icon?: "rotate";
  onDown: () => void;
  onUp: () => void;
  downLabel: string;
  upLabel: string;
}) {
  const Down = icon === "rotate" ? RotateCcw : Minus;
  const Up = icon === "rotate" ? RotateCw : Plus;
  return (
    <div className="flex h-10 items-center justify-between rounded-xl bg-muted px-2">
      <button
        type="button"
        disabled={busy}
        onClick={onDown}
        aria-label={downLabel}
        title={downLabel}
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
      >
        <Down className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <span className="text-[16px] font-bold tabular-nums">{value}</span>
      <button
        type="button"
        disabled={busy}
        onClick={onUp}
        aria-label={upLabel}
        title={upLabel}
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
      >
        <Up className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
