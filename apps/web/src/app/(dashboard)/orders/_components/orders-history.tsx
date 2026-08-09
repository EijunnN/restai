"use client";

import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { dondeVa, type OrdenFila } from "./orders-feed";

/**
 * El historial: aquí SÍ una tabla densa.
 *
 * Es otro trabajo que el servicio en curso. En el salón se decide y se actúa —de
 * ahí el riel, los grupos por urgencia y un botón grande por fila—; aquí se
 * busca, se compara y se cuadra caja, y para eso lo que sirve son columnas
 * alineadas y muchas filas a la vez.
 *
 * El pie dice lo que suman las órdenes CON LOS FILTROS PUESTOS, no el total del
 * mes: es la cifra que se está mirando, y calcularla a mano sumando la pantalla
 * es la forma más rápida de equivocarse.
 */

const REJILLA =
  "grid items-center gap-3.5 px-4 " +
  "grid-cols-[86px_minmax(0,1fr)_96px_92px] " +
  "@2xl:grid-cols-[86px_minmax(0,1fr)_110px_96px_92px] " +
  "@4xl:grid-cols-[86px_minmax(0,1fr)_110px_96px_60px_104px_92px_92px]";

const NOMBRE_METODO: Record<string, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  yape: "Yape",
  plin: "Plin",
  transfer: "Transferencia",
  other: "Otro",
  mixto: "Mixto",
};

export interface PeriodoHistorial {
  clave: string;
  nombre: string;
  from?: string;
  to?: string;
}

/** Fechas en hora de Lima: el día operativo peruano, no el del navegador. */
function hoyLima(desplazamientoDias = 0): string {
  const ahora = new Date();
  const lima = new Date(ahora.toLocaleString("en-US", { timeZone: "America/Lima" }));
  lima.setDate(lima.getDate() + desplazamientoDias);
  return lima.toISOString().slice(0, 10);
}

export function periodosHistorial(): PeriodoHistorial[] {
  return [
    { clave: "hoy", nombre: "Hoy", from: hoyLima(), to: hoyLima() },
    { clave: "ayer", nombre: "Ayer", from: hoyLima(-1), to: hoyLima(-1) },
    { clave: "7d", nombre: "Últimos 7 días", from: hoyLima(-6), to: hoyLima() },
    { clave: "30d", nombre: "Últimos 30 días", from: hoyLima(-29), to: hoyLima() },
    { clave: "todo", nombre: "Todo" },
  ];
}

export function HistoryPeriods({
  periodos,
  activo,
  onElegir,
  totalPeriodo,
  ordenesPeriodo,
}: {
  periodos: PeriodoHistorial[];
  activo: string;
  onElegir: (clave: string) => void;
  totalPeriodo: number;
  ordenesPeriodo: number;
}) {
  const ticketMedio = ordenesPeriodo > 0 ? Math.round(totalPeriodo / ordenesPeriodo) : 0;

  return (
    <div className="flex min-h-0 flex-col gap-0.5">
      <p className="mb-2 ml-2.5 text-[10.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
        Periodo
      </p>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {periodos.map((p) => (
          <button
            key={p.clave}
            type="button"
            onClick={() => onElegir(p.clave)}
            className={`flex h-[34px] w-full items-center rounded-[10px] px-2.5 text-[13px] transition-colors ${
              activo === p.clave
                ? "bg-muted font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="min-w-0 flex-1 truncate text-left">{p.nombre}</span>
          </button>
        ))}
      </div>

      <div className="mt-3 rounded-2xl bg-muted/60 p-3.5">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
          Periodo
        </p>
        <p className="mt-2 text-[30px] font-extrabold leading-none tabular-nums tracking-tight">
          {formatCurrency(totalPeriodo)}
        </p>
        <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">
          {ordenesPeriodo === 0
            ? "Sin órdenes en este periodo."
            : `${ordenesPeriodo} ${ordenesPeriodo === 1 ? "orden cerrada" : "órdenes cerradas"} · ticket medio ${formatCurrency(ticketMedio)}`}
        </p>
      </div>
    </div>
  );
}

export function OrdersHistory({
  ordenes,
  cargando,
  pagina,
  totalPaginas,
  total,
  onPagina,
  onAbrir,
}: {
  ordenes: OrdenFila[];
  cargando: boolean;
  pagina: number;
  totalPaginas: number;
  total: number;
  onPagina: (p: number) => void;
  onAbrir: (id: string) => void;
}) {
  return (
    <div className="@container flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-muted/25">
      <div
        className={`${REJILLA} h-9 shrink-0 border-b border-border/60 text-[10.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground`}
      >
        <span>Orden</span>
        <span>Cliente y mesa</span>
        <span className="hidden @2xl:block">Mozo</span>
        <span>Cerrada</span>
        <span className="hidden text-right @4xl:block">Ítems</span>
        <span className="hidden @4xl:block">Método</span>
        <span className="text-right">Total</span>
        <span className="hidden text-right @4xl:block">Boleta</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {cargando && ordenes.length === 0 && (
          <div className="space-y-1 p-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-11 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        )}

        {!cargando && ordenes.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <Search className="h-7 w-7 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              Ninguna orden cerrada con esos filtros
            </p>
            <p className="text-xs text-muted-foreground/70">
              Prueba con otro periodo o borra la búsqueda.
            </p>
          </div>
        )}

        {ordenes.map((o) => {
          const anulada = o.status === "cancelled";
          return (
            <div
              key={o.id}
              role="button"
              tabIndex={0}
              onClick={() => onAbrir(o.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onAbrir(o.id);
                }
              }}
              className={`${REJILLA} h-12 cursor-pointer border-b border-border/30 text-left transition-colors hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                anulada ? "opacity-60" : ""
              }`}
            >
              <span className="flex items-center gap-2">
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    anulada ? "bg-destructive" : "bg-emerald-500"
                  }`}
                />
                <span className="truncate text-[13px] font-bold tabular-nums">
                  {o.order_number ?? "—"}
                </span>
              </span>

              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-[13px]">
                  {o.customer_name || "Sin cliente"}
                </span>
                <span className="truncate text-[11.5px] text-muted-foreground">
                  {dondeVa(o)}
                </span>
              </span>

              <span className="hidden truncate text-[12.5px] text-muted-foreground @2xl:block">
                {o.waiter_name || "Autoservicio"}
              </span>

              <span className="text-[12.5px] tabular-nums text-muted-foreground">
                {new Date(o.status_changed_at ?? o.created_at).toLocaleString("es-PE", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "America/Lima",
                })}
              </span>

              <span className="hidden text-right text-[12.5px] tabular-nums text-muted-foreground @4xl:block">
                {o.item_count ?? 0}
              </span>

              <span className="hidden @4xl:block">
                {(o as any).payment_method ? (
                  <span className="inline-flex h-5 items-center rounded-md bg-muted px-2 text-[11px] font-semibold text-muted-foreground">
                    {NOMBRE_METODO[(o as any).payment_method] ?? (o as any).payment_method}
                  </span>
                ) : (
                  <span className="text-[11.5px] text-muted-foreground/60">—</span>
                )}
              </span>

              <span className="text-right text-[13.5px] font-bold tabular-nums">
                {formatCurrency(o.total ?? 0)}
              </span>

              <span
                className={`hidden text-right text-[11.5px] tabular-nums @4xl:block ${
                  (o as any).invoice_number ? "text-muted-foreground" : "text-amber-500"
                }`}
              >
                {anulada ? "Anulada" : ((o as any).invoice_number ?? "Pendiente")}
              </span>
            </div>
          );
        })}
      </div>

      {totalPaginas > 1 && (
        <div className="flex h-12 shrink-0 items-center gap-3 border-t border-border/60 px-4">
          <span className="text-[12.5px] tabular-nums text-muted-foreground">
            Página {pagina} de {totalPaginas} · {total}{" "}
            {total === 1 ? "orden" : "órdenes"}
          </span>
          <span className="flex-1" />
          <button
            type="button"
            disabled={pagina <= 1}
            onClick={() => onPagina(pagina - 1)}
            aria-label="Página anterior"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={pagina >= totalPaginas}
            onClick={() => onPagina(pagina + 1)}
            aria-label="Página siguiente"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
