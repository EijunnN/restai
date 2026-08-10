"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { apiFetch } from "@/lib/fetcher";
import { formatCurrency } from "@/lib/utils";
import { useTableActiveSession } from "@/hooks/use-tables";
import type { CuentaAbierta } from "./pos-accounts";

/**
 * Lo que esta cuenta ya pidió.
 *
 * El carrito solo enseñaba lo que está a punto de mandarse, así que para saber
 * si la mesa 12 ya tiene el ceviche había que irse al plano del salón y abrir su
 * cuenta. El resultado conocido: la segunda ronda repite un plato que ya está en
 * la mesa, y el que discute con el cliente es el mozo.
 *
 * Va plegado por defecto: la cabecera responde la pregunta frecuente —cuánto y
 * cuánto lleva— y el detalle solo se abre cuando hay una duda concreta.
 */

interface LineaEnviada {
  clave: string;
  nombre: string;
  cantidad: number;
  total: number;
  detalle?: string;
}

/** Estados de línea que no forman parte de lo pedido. */
function vive(estado?: string): boolean {
  return estado !== "cancelled";
}

export function SentLines({ cuenta }: { cuenta: CuentaAbierta }) {
  const [abierto, setAbierto] = useState(false);

  // Mesa: la visita entera, que es lo que el comensal considera "su cuenta".
  const esMesa = cuenta.tipo === "mesa";
  const visita = useTableActiveSession(esMesa ? cuenta.tableId : null);

  // Mostrador y reparto: la orden es la cuenta.
  const orderId = !esMesa ? cuenta.orderIds[0] : null;
  const orden = useQuery<any>({
    queryKey: ["orders", orderId],
    queryFn: () => apiFetch<any>(`/api/orders/${orderId}`),
    enabled: !!orderId,
  });

  let lineas: LineaEnviada[] = [];
  let cargando = false;

  if (esMesa) {
    cargando = visita.isLoading;
    lineas = (visita.data?.orders ?? []).flatMap((o) =>
      (o.items ?? [])
        .filter((i) => vive(i.status))
        .map((i) => ({
          clave: i.id,
          nombre: i.name,
          cantidad: i.quantity,
          total: i.total,
        })),
    );
  } else if (orderId) {
    cargando = orden.isLoading;
    lineas = ((orden.data?.items ?? []) as any[])
      .filter((i) => vive(i.status))
      .map((i) => ({
        clave: i.id,
        nombre: i.name,
        cantidad: i.quantity,
        total: i.total,
        detalle: [
          ...(i.modifiers ?? []).map((m: any) => m.name),
          ...(i.notes ? [i.notes] : []),
        ].join(" · "),
      }));
  }

  if (cargando) {
    return <div className="mb-2 h-9 animate-pulse rounded-xl bg-muted/60" />;
  }
  if (lineas.length === 0) return null;

  const unidades = lineas.reduce((suma, l) => suma + l.cantidad, 0);
  const importe = lineas.reduce((suma, l) => suma + l.total, 0);

  return (
    <div className="mb-2 rounded-xl border border-border/70 bg-muted/30">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-emerald-600 dark:text-emerald-400">
          Ya pedido
        </span>
        <span className="h-px flex-1 bg-border/70" />
        <span className="text-[11.5px] tabular-nums text-muted-foreground">
          {unidades} {unidades === 1 ? "unidad" : "unidades"} · {formatCurrency(importe)}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${
            abierto ? "rotate-180" : ""
          }`}
        />
      </button>

      {abierto && (
        <ul className="max-h-40 space-y-1 overflow-y-auto px-3 pb-2.5">
          {lineas.map((l) => (
            <li key={l.clave} className="flex items-start gap-2 text-[12px] text-muted-foreground">
              <span className="w-5 shrink-0 text-right font-bold tabular-nums">{l.cantidad}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{l.nombre}</span>
                {l.detalle && (
                  <span className="block truncate text-[11px] text-muted-foreground/70">
                    {l.detalle}
                  </span>
                )}
              </span>
              <span className="shrink-0 tabular-nums">{formatCurrency(l.total)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
