"use client";

import { Bike, Package, UtensilsCrossed } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import {
  ACCION_AVANCE,
  ETAPAS,
  ETIQUETA_ESTADO,
  agruparPorUrgencia,
  formatearEspera,
  indiceEtapa,
  urgenciaDe,
  type OrdenParaUrgencia,
} from "./orders-flow";

/**
 * El servicio en curso, agrupado por lo que hay que hacer.
 *
 * La tabla anterior ordenaba por hora de entrada y de más nueva a más vieja, o
 * sea que la orden urgente quedaba la ÚLTIMA. Aquí lo primero que se ve es lo
 * que reclama: un plato listo sin servir, una mesa servida sin cobrar, una
 * comanda que se pasó de su tiempo.
 *
 * El estado va como riel de seis tramos y no como insignia de color: una
 * insignia dice dónde estás, un riel dice además cuánto falta. El color queda
 * para lo urgente, que es lo único que debería llamar la atención.
 */

const ICONO_TIPO: Record<string, typeof UtensilsCrossed> = {
  dine_in: UtensilsCrossed,
  delivery: Bike,
  takeout: Package,
};

const REJILLA =
  "grid items-center gap-3 px-3 " +
  "grid-cols-[34px_minmax(0,1fr)_86px_112px] " +
  "@2xl:grid-cols-[34px_minmax(0,1fr)_140px_86px_112px] " +
  "@4xl:grid-cols-[34px_minmax(0,1fr)_140px_86px_104px_124px]";

export interface OrdenFila extends OrdenParaUrgencia {
  id: string;
  order_number?: string | null;
  type?: string;
  table_number?: number | null;
  customer_name?: string | null;
  waiter_name?: string | null;
  item_count?: number;
  total?: number;
  total_paid?: number;
  delivery_address?: string | null;
}

/** "Mesa 12", "Delivery · San Isidro", "Para llevar". */
export function dondeVa(orden: OrdenFila): string {
  if (orden.type === "delivery") {
    return orden.delivery_address ? `Delivery · ${orden.delivery_address}` : "Delivery";
  }
  if (orden.type === "takeout") return "Para llevar";
  return orden.table_number != null ? `Mesa ${orden.table_number}` : "Sin mesa";
}

const ETIQUETA_PAGO: Record<string, string> = {
  paid: "Pagada",
  partial: "Parcial",
  unpaid: "Sin pagar",
};

export function OrdersFeed({
  ordenes,
  ordenActivaId,
  ahora,
  cambiandoId,
  puedeAvanzar,
  puedeCobrar,
  onAbrir,
  onAvanzar,
  onCobrar,
}: {
  ordenes: OrdenFila[];
  ordenActivaId: string | null;
  /** Se pasa desde fuera para que todas las filas cuenten con el mismo reloj. */
  ahora: number;
  /** Id con una transición en vuelo. Bloquea SOLO esa fila, no la lista entera. */
  cambiandoId: string | null;
  puedeAvanzar: boolean;
  puedeCobrar: boolean;
  onAbrir: (id: string) => void;
  onAvanzar: (orden: OrdenFila, destino: string) => void;
  onCobrar: (orden: OrdenFila) => void;
}) {
  const secciones = agruparPorUrgencia(ordenes, ahora);

  if (secciones.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl bg-muted/25 py-16 text-center">
        <UtensilsCrossed className="h-7 w-7 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">No hay nada abierto ahora mismo</p>
        <p className="max-w-xs text-xs text-muted-foreground/70">
          Las órdenes aparecen aquí en cuanto entran, por el QR de una mesa o desde el
          punto de venta.
        </p>
      </div>
    );
  }

  return (
    <div className="@container min-h-0 flex-1 overflow-y-auto">
      {secciones.map((seccion) => (
        <section key={seccion.clave}>
          <div className="flex items-center gap-3 px-3 pb-1.5 pt-4">
            <span
              className={`text-[12.5px] font-bold ${
                seccion.destacada ? "text-amber-500" : "text-foreground/80"
              }`}
            >
              {seccion.titulo}
            </span>
            <span className="h-px flex-1 bg-border/60" />
            <span className="text-[11.5px] text-muted-foreground">
              {seccion.ordenes.length}{" "}
              {seccion.ordenes.length === 1 ? "orden" : "órdenes"}
            </span>
          </div>

          {seccion.ordenes.map((orden) => (
            <Fila
              key={orden.id}
              orden={orden}
              activa={ordenActivaId === orden.id}
              ahora={ahora}
              cambiando={cambiandoId === orden.id}
              puedeAvanzar={puedeAvanzar}
              puedeCobrar={puedeCobrar}
              onAbrir={onAbrir}
              onAvanzar={onAvanzar}
              onCobrar={onCobrar}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

function Fila({
  orden,
  activa,
  ahora,
  cambiando,
  puedeAvanzar,
  puedeCobrar,
  onAbrir,
  onAvanzar,
  onCobrar,
}: {
  orden: OrdenFila;
  activa: boolean;
  ahora: number;
  cambiando: boolean;
  puedeAvanzar: boolean;
  puedeCobrar: boolean;
  onAbrir: (id: string) => void;
  onAvanzar: (orden: OrdenFila, destino: string) => void;
  onCobrar: (orden: OrdenFila) => void;
}) {
  const u = urgenciaDe(orden, ahora);
  const Icono = ICONO_TIPO[orden.type ?? "dine_in"] ?? UtensilsCrossed;
  const accion = ACCION_AVANCE[orden.status as keyof typeof ACCION_AVANCE];
  const etapaActual = indiceEtapa(orden.status);
  const pagada = orden.payment_status === "paid";

  // Cobrar exige su propio permiso; avanzar, el suyo. Un botón que muere en un
  // 403 es peor que un botón que no está.
  const puedePulsar = accion?.cobro ? puedeCobrar : puedeAvanzar;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onAbrir(orden.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onAbrir(orden.id);
        }
      }}
      className={`${REJILLA} h-16 cursor-pointer rounded-2xl text-left transition-colors hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        activa ? "bg-muted/70 shadow-[inset_0_0_0_1px_var(--border)]" : ""
      }`}
    >
      <span
        className={`flex h-[34px] w-[34px] items-center justify-center rounded-xl bg-muted ${
          orden.type === "delivery"
            ? "text-blue-500"
            : orden.type === "takeout"
              ? "text-amber-600 dark:text-amber-500"
              : "text-muted-foreground"
        }`}
      >
        <Icono className="h-4 w-4" />
      </span>

      <span className="flex min-w-0 flex-col gap-[3px]">
        <span className="flex min-w-0 items-center gap-[7px]">
          <span className="text-[13.5px] font-bold tabular-nums">
            {orden.order_number ?? "—"}
          </span>
          <span className="truncate text-[13px]">{dondeVa(orden)}</span>
        </span>
        <span className="truncate text-[11.5px] text-muted-foreground">
          {[
            orden.customer_name || "Sin cliente",
            `${orden.item_count ?? 0} ${orden.item_count === 1 ? "línea" : "líneas"}`,
            orden.waiter_name,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>

      {/* El riel: el estado como POSICIÓN, no como etiqueta de color. */}
      <span className="hidden min-w-0 flex-col gap-1.5 @2xl:flex">
        <span className="text-[11.5px] font-semibold text-muted-foreground">
          {ETIQUETA_ESTADO[orden.status] ?? orden.status}
        </span>
        <span className="flex gap-1">
          {ETAPAS.map((_, i) => (
            <span
              key={i}
              className={`h-[5px] w-5 rounded-full ${
                i < etapaActual
                  ? "bg-foreground/40"
                  : i === etapaActual
                    ? u.urgente
                      ? "bg-amber-500"
                      : "bg-foreground"
                    : "bg-muted-foreground/20"
              }`}
            />
          ))}
        </span>
      </span>

      <span className="flex flex-col items-end gap-0.5">
        <span
          className={`text-[13px] font-bold tabular-nums ${
            u.urgente ? "text-amber-500" : ""
          }`}
        >
          {formatearEspera(orden.status === "ready" ? u.minutosEnEstado : u.minutosTotales)}
        </span>
        <span className="text-[10.5px] text-muted-foreground">{u.pista}</span>
      </span>

      <span className="hidden flex-col items-end gap-1 @4xl:flex">
        <span className="text-[13.5px] font-bold tabular-nums">
          {formatCurrency(orden.total ?? 0)}
        </span>
        <span
          className={`flex h-[18px] items-center rounded-md px-1.5 text-[10.5px] font-bold ${
            pagada
              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
              : orden.payment_status === "partial"
                ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                : "bg-muted text-muted-foreground"
          }`}
        >
          {ETIQUETA_PAGO[orden.payment_status ?? "unpaid"]}
        </span>
      </span>

      <span className="flex justify-end">
        {accion && puedePulsar && (
          <button
            type="button"
            disabled={cambiando}
            onClick={(e) => {
              e.stopPropagation();
              if (accion.cobro) onCobrar(orden);
              else onAvanzar(orden, accion.destino);
            }}
            className={`h-[34px] whitespace-nowrap rounded-[10px] px-3.5 text-[12.5px] font-bold transition-colors disabled:opacity-50 ${
              u.urgente
                ? "bg-foreground text-background"
                : "bg-muted text-foreground hover:bg-muted/70"
            }`}
          >
            {cambiando ? "…" : accion.etiqueta}
          </button>
        )}
      </span>
    </div>
  );
}
