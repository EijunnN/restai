"use client";

import { cn } from "@/lib/utils";

/**
 * Cabecera de una columna del tablero.
 *
 * Deliberadamente sobria: un punto de color para identificar la columna de un
 * vistazo, el nombre, cuántas hay y cuánto lleva esperando la más antigua. Nada
 * pulsa ni late aquí — la alerta de retraso vive en una sola banda arriba del
 * tablero, y el tiempo de cada comanda se colorea en su propia tarjeta. Repartir
 * la misma alarma por tres sitios era lo que acababa anestesiando la vista.
 */

const DOT: Record<Variant, string> = {
  pending: "bg-amber-500",
  preparing: "bg-blue-500",
  ready: "bg-green-500",
};

type Variant = "pending" | "preparing" | "ready";

export function ColumnHeader({
  label,
  count,
  variant,
  /** Antigüedad de la comanda más vieja de la columna, ya formateada. */
  oldest,
  /** Texto alternativo al de "más antigua" (la columna de listos usa otro). */
  meta,
}: {
  label: string;
  count: number;
  variant: Variant;
  oldest?: string;
  meta?: string;
}) {
  return (
    <div className="flex flex-none items-center gap-2.5 border-b border-border px-4 py-3">
      <span className={cn("h-1.5 w-1.5 rounded-[2px]", DOT[variant])} />

      <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground">
        {label}
      </h2>

      <span className="flex h-[22px] min-w-[22px] items-center justify-center rounded px-1.5 text-[12px] font-bold tabular-nums text-muted-foreground bg-foreground/[0.06] dark:bg-white/[0.06]">
        {count}
      </span>

      <span className="flex-1" />

      {meta ? (
        <span className="text-[11px] text-muted-foreground">{meta}</span>
      ) : count > 0 && oldest ? (
        <span className="text-[11px] text-muted-foreground">
          más antigua <span className="tabular-nums">{oldest}</span>
        </span>
      ) : null}
    </div>
  );
}
