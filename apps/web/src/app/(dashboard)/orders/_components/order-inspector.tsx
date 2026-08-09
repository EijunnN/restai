"use client";

import { Banknote, CreditCard, Printer, Smartphone, Undo2, X } from "lucide-react";
import { Button } from "@restai/ui/components/button";
import { formatCurrency } from "@/lib/utils";
import { useOrder } from "@/hooks/use-orders";
import {
  ACCION_AVANCE,
  ACCION_RETROCESO,
  ETIQUETA_ESTADO,
  formatearEspera,
  saldoPendiente,
  urgenciaDe,
} from "./orders-flow";
import { dondeVa, type OrdenFila } from "./orders-feed";

/**
 * La ficha de la orden, a la derecha.
 *
 * Antes no existía: la pantalla enseñaba "6 ítems" en una columna que además
 * desaparecía por debajo de 768 px, y la única forma de saber QUÉ había pedido
 * una mesa era imprimir el ticket. La fila llevaba `cursor-pointer` desde hacía
 * meses y no hacía nada al pulsarla.
 *
 * El cobro parcial vive aquí y no en un diálogo aparte: lo que hay que decidir
 * al cobrar media cuenta es qué se ha pagado ya y qué falta, y eso es
 * exactamente lo que esta ficha tiene delante.
 */

const ICONO_METODO: Record<string, typeof Banknote> = {
  cash: Banknote,
  card: CreditCard,
  yape: Smartphone,
  plin: Smartphone,
  transfer: CreditCard,
  other: Banknote,
};

const NOMBRE_METODO: Record<string, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  yape: "Yape",
  plin: "Plin",
  transfer: "Transferencia",
  other: "Otro",
};

export function OrderInspector({
  orden,
  ahora,
  cambiando,
  puedeAvanzar,
  puedeCobrar,
  puedeAnular,
  onCerrar,
  onAvanzar,
  onCobrar,
  onImprimir,
  onAnular,
}: {
  orden: OrdenFila;
  ahora: number;
  cambiando: boolean;
  puedeAvanzar: boolean;
  puedeCobrar: boolean;
  puedeAnular: boolean;
  onCerrar: () => void;
  onAvanzar: (orden: OrdenFila, destino: string) => void;
  onCobrar: (orden: OrdenFila) => void;
  onImprimir: (orden: OrdenFila) => void;
  onAnular: (orden: OrdenFila) => void;
}) {
  // El detalle trae líneas, opciones y cobros. La fila de la lista ya está en
  // memoria, así que la ficha se pinta entera desde el primer momento y solo se
  // rellena lo que falta cuando llega.
  const { data: detalle, isLoading } = useOrder(orden.id);
  const d: any = detalle ?? {};

  const u = urgenciaDe(orden, ahora);
  const accion = ACCION_AVANCE[orden.status as keyof typeof ACCION_AVANCE];
  const retroceso = ACCION_RETROCESO[orden.status as keyof typeof ACCION_RETROCESO];

  const items: any[] = d.items ?? [];
  const cobros: any[] = (d.payments ?? []).filter((p: any) => !p.voided_at && p.status === "completed");
  const anulados: any[] = (d.payments ?? []).filter((p: any) => p.voided_at);
  const cobrado = d.total_paid ?? orden.total_paid ?? 0;
  const total = d.total ?? orden.total ?? 0;
  const falta = saldoPendiente({ total, total_paid: cobrado });
  const pctCobrado = total > 0 ? Math.min(100, Math.round((cobrado / total) * 100)) : 0;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl bg-muted/35">
      <div className="shrink-0 border-b border-border/60 p-4">
        <div className="flex items-start gap-2.5">
          <div className="min-w-0 flex-1">
            <p
              className={`text-[10.5px] font-bold uppercase tracking-[0.2em] ${
                u.urgente ? "text-amber-500" : "text-muted-foreground"
              }`}
            >
              {ETIQUETA_ESTADO[orden.status] ?? orden.status}
              {u.urgente ? ` · ${formatearEspera(u.minutosEnEstado)} en este paso` : ""}
            </p>
            <h3 className="mt-1.5 text-2xl font-extrabold leading-tight tracking-tight">
              {orden.order_number ?? "—"} · {dondeVa(orden)}
            </h3>
            <p className="mt-1.5 text-[12.5px] text-muted-foreground">
              {[
                orden.customer_name || "Sin cliente",
                (() => {
                  const n = orden.item_count ?? items.length;
                  return `${n} ${n === 1 ? "línea" : "líneas"}`;
                })(),
                d.waiter_name || orden.waiter_name,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar la ficha"
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-muted text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {(accion || retroceso) && (
          <div className="mt-3.5 flex items-center gap-2">
            {accion && (accion.cobro ? puedeCobrar : puedeAvanzar) && (
              <Button
                className="h-10 flex-1"
                disabled={cambiando}
                onClick={() =>
                  accion.cobro ? onCobrar(orden) : onAvanzar(orden, accion.destino)
                }
              >
                {cambiando ? "…" : accion.etiqueta}
              </Button>
            )}
            {retroceso && puedeAvanzar && (
              <Button
                variant="ghost"
                className="h-10"
                disabled={cambiando}
                onClick={() => onAvanzar(orden, retroceso)}
                title={`Volver a ${ETIQUETA_ESTADO[retroceso]}`}
              >
                <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                Retroceder
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {/* Cobro parcial: solo cuando ya hay algo cobrado y algo pendiente. */}
        {cobrado > 0 && falta > 0 && (
          <div className="mb-4 rounded-2xl bg-muted/70 p-3.5">
            <div className="flex items-baseline justify-between">
              <span className="text-[12.5px] text-muted-foreground">Total de la cuenta</span>
              <span className="text-[15px] font-bold tabular-nums">{formatCurrency(total)}</span>
            </div>
            <div className="my-3 h-2 overflow-hidden rounded-full bg-muted-foreground/20">
              <div className="h-full bg-emerald-500" style={{ width: `${pctCobrado}%` }} />
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[12.5px] text-emerald-600 dark:text-emerald-400">
                Cobrado {formatCurrency(cobrado)}
              </span>
              <span className="text-[12.5px] text-muted-foreground">
                Falta {formatCurrency(falta)}
              </span>
            </div>
          </div>
        )}

        {cobros.length > 0 && (
          <>
            <p className="mb-2.5 text-[10.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
              Cobros registrados
            </p>
            <div className="mb-4 flex flex-col gap-1.5">
              {cobros.map((p) => {
                const Icono = ICONO_METODO[p.method] ?? Banknote;
                return (
                  <div
                    key={p.id}
                    className="flex items-center gap-2.5 rounded-xl bg-muted/60 px-3 py-2.5"
                  >
                    <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-background/70 text-muted-foreground">
                      <Icono className="h-[15px] w-[15px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold">
                        {NOMBRE_METODO[p.method] ?? p.method}
                      </span>
                      <span className="block text-[11.5px] text-muted-foreground">
                        {new Date(p.created_at).toLocaleTimeString("es-PE", {
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZone: "America/Lima",
                        })}
                        {p.reference ? ` · ${p.reference}` : ""}
                      </span>
                    </span>
                    <span className="text-[13px] font-bold tabular-nums">
                      {formatCurrency(p.amount)}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {anulados.length > 0 && (
          <p className="mb-4 rounded-xl bg-amber-500/10 px-3 py-2.5 text-[11.5px] leading-snug text-amber-600 dark:text-amber-400">
            {anulados.length === 1
              ? "Hay un cobro anulado en esta cuenta"
              : `Hay ${anulados.length} cobros anulados en esta cuenta`}
            : el saldo volvió a subir por eso.
          </p>
        )}

        <div className="mb-2.5 flex items-center justify-between">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
            {items.length > 0
              ? `${items.length} ${items.length === 1 ? "línea" : "líneas"}`
              : "Líneas"}
          </p>
        </div>

        {isLoading && items.length === 0 ? (
          <div className="h-24 animate-pulse rounded-xl bg-muted" />
        ) : items.length === 0 ? (
          <p className="rounded-xl bg-muted/50 px-3 py-4 text-center text-[12px] text-muted-foreground">
            Esta orden no tiene líneas.
          </p>
        ) : (
          <div className="flex flex-col">
            {items.map((i) => {
              const anulada = i.status === "cancelled";
              const opciones = (i.modifiers ?? []).map((m: any) => m.name).join(" · ");
              return (
                <div
                  key={i.id}
                  className={`flex items-start gap-2.5 border-b border-border/40 py-2.5 last:border-b-0 ${
                    anulada ? "opacity-50" : ""
                  }`}
                >
                  <span className="min-w-[22px] text-[12.5px] font-bold tabular-nums text-muted-foreground">
                    {i.quantity}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`text-[13.5px] font-semibold ${anulada ? "line-through" : ""}`}
                    >
                      {i.name}
                    </span>
                    {(opciones || i.notes || anulada) && (
                      <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
                        {anulada
                          ? i.cancel_reason
                            ? `Anulada: ${i.cancel_reason}`
                            : "Anulada"
                          : [opciones, i.notes].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </span>
                  <span
                    className={`text-[13px] font-semibold tabular-nums ${
                      anulada ? "text-muted-foreground line-through" : ""
                    }`}
                  >
                    {formatCurrency(i.total ?? 0)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border/60 p-4">
        <div className="flex items-baseline justify-between py-0.5">
          <span className="text-[12.5px] text-muted-foreground">Subtotal</span>
          <span className="text-[12.5px] tabular-nums">
            {formatCurrency(d.subtotal ?? orden.total ?? 0)}
          </span>
        </div>
        {(d.discount ?? 0) > 0 && (
          <div className="flex items-baseline justify-between py-0.5">
            <span className="text-[12.5px] text-muted-foreground">Descuento</span>
            <span className="text-[12.5px] tabular-nums text-emerald-600 dark:text-emerald-400">
              −{formatCurrency(d.discount)}
            </span>
          </div>
        )}
        <div className="flex items-baseline justify-between py-0.5">
          <span className="text-[12.5px] text-muted-foreground">IGV incluido</span>
          <span className="text-[12.5px] tabular-nums text-muted-foreground">
            {formatCurrency(d.tax ?? 0)}
          </span>
        </div>
        <div className="mt-2 flex items-baseline justify-between">
          <span className="text-[13px] font-semibold">Total</span>
          <span className="text-2xl font-extrabold tabular-nums tracking-tight">
            {formatCurrency(total)}
          </span>
        </div>

        <div className="mt-3 flex items-center gap-2">
          {puedeCobrar && falta > 0 && (
            <Button variant="secondary" className="h-10 flex-1" onClick={() => onCobrar(orden)}>
              <Banknote className="mr-1.5 h-[15px] w-[15px]" />
              {cobrado > 0 ? `Cobrar ${formatCurrency(falta)}` : "Cobrar"}
            </Button>
          )}
          <button
            type="button"
            onClick={() => onImprimir(orden)}
            aria-label="Imprimir la boleta"
            className="flex h-10 w-10 items-center justify-center rounded-[11px] bg-muted text-muted-foreground transition-colors hover:text-foreground"
          >
            <Printer className="h-[15px] w-[15px]" />
          </button>
          {puedeAnular && (
            <button
              type="button"
              onClick={() => onAnular(orden)}
              aria-label="Anular la orden"
              className="flex h-10 w-10 items-center justify-center rounded-[11px] bg-destructive/10 text-destructive transition-colors hover:bg-destructive/20"
            >
              <X className="h-[15px] w-[15px]" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
