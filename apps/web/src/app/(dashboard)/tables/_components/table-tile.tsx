"use client";

import { Bell, CreditCard, ReceiptText, RefreshCw, Users } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import type { TableRow } from "@/hooks/use-tables";
import type { TableServiceRequestIndicator } from "./tables-context";

/**
 * Una mesa en la cuadrícula de sala.
 *
 * El criterio de color es deliberado y distinto del que había: **una mesa libre
 * no reclama atención**. Antes los cuatro estados gritaban con un color
 * saturado cada uno, así que un salón medio vacío era un mosaico donde la mesa
 * que pedía la cuenta no destacaba sobre las diez que no necesitaban nada.
 * Ahora el color se reserva para lo que exige una decisión —ocupada, reservada,
 * un aviso sin atender— y lo tranquilo se queda en gris.
 */

type Estado = "available" | "occupied" | "reserved" | "maintenance";

/** Colores por estado, siempre con su par `dark:`. */
const ESTADO: Record<Estado, { label: string; accent: string; card: string; dot: string }> = {
  available: {
    label: "Libre",
    accent: "text-muted-foreground",
    card: "border-border bg-card hover:border-foreground/25",
    dot: "bg-muted-foreground/60",
  },
  occupied: {
    label: "Ocupada",
    accent: "text-blue-700 dark:text-blue-400",
    card:
      "border-blue-300 bg-blue-50/70 hover:border-blue-400 " +
      "dark:border-blue-500/40 dark:bg-blue-950/25 dark:hover:border-blue-500/70",
    dot: "bg-blue-600 dark:bg-blue-400",
  },
  reserved: {
    label: "Reservada",
    accent: "text-amber-700 dark:text-amber-400",
    card:
      "border-amber-300 bg-amber-50/60 hover:border-amber-400 " +
      "dark:border-amber-500/35 dark:bg-amber-950/20 dark:hover:border-amber-500/60",
    dot: "bg-amber-600 dark:bg-amber-400",
  },
  maintenance: {
    label: "Sin servicio",
    accent: "text-muted-foreground/70",
    card: "border-dashed border-border bg-transparent hover:border-foreground/25",
    dot: "bg-muted-foreground/40",
  },
};

/** Aviso pendiente: el único elemento de la tarjeta que late. */
const AVISO = {
  request_bill: {
    icon: ReceiptText,
    label: "Pide la cuenta",
    chip: "bg-violet-600 text-white dark:bg-violet-500",
  },
  call_waiter: {
    icon: Bell,
    label: "Llama al mozo",
    chip: "bg-orange-500 text-white dark:bg-orange-500",
  },
  join: {
    icon: Users,
    label: "Quiere entrar",
    chip: "bg-blue-600 text-white dark:bg-blue-500",
  },
} as const;

interface Props {
  table: TableRow;
  selected: boolean;
  serviceRequest?: TableServiceRequestIndicator;
  /** Alguien escaneó el QR y espera que le abran la cuenta. */
  wantsToJoin?: boolean;
  onSelect: (id: string) => void;
  /** Acción principal. No se pinta si el rol no puede ejecutarla. */
  onPrimary?: (table: TableRow) => void;
  canCharge: boolean;
  canOperate: boolean;
}

export function TableTile({
  table,
  selected,
  serviceRequest,
  wantsToJoin,
  onSelect,
  onPrimary,
  canCharge,
  canOperate,
}: Props) {
  const estado = ESTADO[(table.status as Estado)] ?? ESTADO.available;
  const sesion = table.active_session;
  const ocupada = table.status === "occupied";
  // Una mesa reservada también se sienta: el cliente llegó.
  const puedeSentar = table.status === "available" || table.status === "reserved";

  const aviso = serviceRequest
    ? AVISO[serviceRequest.type]
    : wantsToJoin
      ? AVISO.join
      : null;
  const AvisoIcon = aviso?.icon;

  // Los puntos son comensales sentados sobre plazas de la mesa. Sin dato
  // declarado se dejan todos vacíos: es más honesto que fingir que está llena.
  const plazas = Math.min(table.capacity ?? 0, 10);
  const sentados =
    ocupada && typeof sesion?.guest_count === "number" ? sesion.guest_count : 0;

  const accionLabel = ocupada ? "Cobrar" : puedeSentar ? "Sentar" : "Reactivar";
  const AccionIcon = ocupada ? CreditCard : puedeSentar ? Users : RefreshCw;
  const puedeAccion = ocupada ? canCharge : canOperate;

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => onSelect(table.id)}
      onKeyDown={(e) => {
        // La sala se maneja también con teclado desde el mostrador, sin ratón.
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(table.id);
        }
      }}
      className={cn(
        "flex min-h-[168px] cursor-pointer flex-col rounded-xl border p-4 transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        estado.card,
        selected && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
      )}
      aria-pressed={selected}
      aria-label={`Mesa ${table.number}, ${estado.label}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[34px] font-extrabold leading-none tracking-[-0.05em] tabular-nums">
          {table.number}
        </span>
        <div className="flex flex-col items-end gap-2">
          <span
            className={cn(
              "text-[10px] font-bold uppercase tracking-[0.16em] whitespace-nowrap",
              estado.accent,
            )}
          >
            {estado.label}
          </span>
          {aviso && AvisoIcon && (
            <span
              title={aviso.label}
              aria-label={aviso.label}
              className={cn(
                "relative flex h-[22px] w-[22px] items-center justify-center rounded-full",
                aviso.chip,
              )}
            >
              <span className="absolute inset-0 rounded-full bg-current opacity-40 animate-mesa-pulse" />
              <AvisoIcon className="relative h-3 w-3" aria-hidden="true" />
            </span>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5">
        {Array.from({ length: plazas }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-[9px] w-[9px] flex-none rounded-full border",
              i < sentados
                ? cn("border-transparent", estado.dot)
                : "border-foreground/20 dark:border-white/20",
            )}
          />
        ))}
        <span className="ml-1 whitespace-nowrap text-[11px] text-muted-foreground tabular-nums">
          {table.capacity} plazas
        </span>
      </div>

      {ocupada && sesion ? (
        <div className="mt-3 flex items-baseline justify-between gap-2">
          <span className="text-[11.5px] text-muted-foreground tabular-nums">
            {sesion.elapsed_minutes}m · {sesion.order_count}{" "}
            {sesion.order_count === 1 ? "pedido" : "pedidos"}
          </span>
          <span className="text-[19px] font-extrabold tracking-[-0.03em] tabular-nums">
            {formatCurrency(sesion.remaining)}
          </span>
        </div>
      ) : (
        <p className="mt-3 text-[11.5px] text-muted-foreground">
          {table.status === "reserved"
            ? "Reservada"
            : table.status === "maintenance"
              ? "Fuera de servicio"
              : ocupada
                ? "Ocupada sin cuenta abierta"
                : table.short_code
                  ? `Código ${table.short_code}`
                  : "Lista para sentar"}
        </p>
      )}

      {puedeAccion && onPrimary ? (
        <button
          type="button"
          onClick={(e) => {
            // La tarjeta entera selecciona; el botón hace su acción y nada más.
            e.stopPropagation();
            onPrimary(table);
          }}
          className={cn(
            "mt-auto flex h-[42px] w-full items-center justify-center gap-2 rounded-lg text-[13.5px] font-bold transition-colors",
            ocupada
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-foreground/[0.06] text-foreground hover:bg-foreground/[0.12] dark:bg-white/[0.08] dark:hover:bg-white/[0.14]",
          )}
        >
          <AccionIcon className="h-[15px] w-[15px]" aria-hidden="true" />
          {accionLabel}
        </button>
      ) : (
        <div className="mt-auto" />
      )}
    </article>
  );
}

/** Hueco de carga con la misma silueta que la tarjeta real. */
export function TableTileSkeleton() {
  return <div className="min-h-[168px] animate-pulse rounded-xl bg-muted" />;
}
