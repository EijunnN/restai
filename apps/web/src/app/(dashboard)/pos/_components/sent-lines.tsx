"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { apiFetch } from "@/lib/fetcher";
import { formatCurrency } from "@/lib/utils";
import { useTableActiveSession } from "@/hooks/use-tables";
import type { CuentaAbierta } from "./pos-accounts";

/**
 * Lo que esta cuenta ya pidió, comanda por comanda y con su hora.
 *
 * El carrito solo enseñaba lo que está a punto de mandarse, así que para saber
 * si la mesa 12 ya tiene el ceviche había que irse al plano del salón y abrir su
 * cuenta. El resultado conocido: la segunda ronda repite un plato que ya está en
 * la mesa, y el que discute con el cliente es el mozo.
 *
 * La hora no es decoración: "enviado 20:31" es lo que convierte "está en cocina"
 * en "lleva veinticinco minutos en cocina", que es la única versión accionable.
 *
 * Va plegado por defecto: la cabecera responde la pregunta frecuente —cuánto
 * hay y por cuánto— y el detalle solo se abre ante una duda concreta.
 */

interface LineaEnviada {
  clave: string;
  nombre: string;
  cantidad: number;
  total: number;
  detalle?: string;
}

interface ComandaEnviada {
  clave: string;
  /** "20:31", en la hora del local. */
  hora: string;
  /** El mismo instante en milisegundos, para poder ordenar. */
  instante: number;
  numero: string | null;
  lineas: LineaEnviada[];
}

/** Estados de línea que no forman parte de lo pedido. */
function vive(estado?: string): boolean {
  return estado !== "cancelled";
}

/**
 * Las comandas, de la más antigua a la más reciente.
 *
 * El endpoint no promete ningún orden, y aquí el orden ES el dato: la cabecera
 * anuncia "desde HH:MM" leyendo la primera, así que con la lista sin ordenar
 * podía anunciar la hora de la ronda que acaba de salir y hacer parecer recién
 * pedida una mesa que lleva cuarenta minutos esperando. Además se leen como se
 * apilan los tickets en el pase: lo primero que entró, arriba.
 */
export function ordenarPorAntiguedad<T extends { instante: number }>(comandas: T[]): T[] {
  return [...comandas].sort((a, b) => a.instante - b.instante);
}

/** Milisegundos de un ISO, o `Infinity` si no se puede leer (va al final). */
function instanteDe(iso: string | undefined): number {
  const t = iso ? new Date(iso).getTime() : Number.NaN;
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

/**
 * "20:31" en hora peruana.
 *
 * Fija a America/Lima y no a la del navegador: la tablet de un local puede tener
 * la zona mal puesta, y una hora de envío equivocada manda a alguien a reclamar
 * a la cocina por un plato que acaba de entrar.
 */
export function horaDeLima(iso: string): string {
  const t = new Date(iso);
  if (!Number.isFinite(t.getTime())) return "";
  return new Intl.DateTimeFormat("es-PE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Lima",
  }).format(t);
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

  let comandas: ComandaEnviada[] = [];
  let cargando = false;

  if (esMesa) {
    cargando = visita.isLoading;
    comandas = (visita.data?.orders ?? [])
      .map((o) => ({
        clave: o.id,
        hora: horaDeLima(o.created_at),
        instante: instanteDe(o.created_at),
        numero: o.order_number ?? null,
        lineas: (o.items ?? [])
          .filter((i) => vive(i.status))
          .map((i) => ({
            clave: i.id,
            nombre: i.name,
            cantidad: i.quantity,
            total: i.total,
          })),
      }))
      .filter((c) => c.lineas.length > 0);
    comandas = ordenarPorAntiguedad(comandas);
  } else if (orderId) {
    cargando = orden.isLoading;
    const o = orden.data;
    const lineas = ((o?.items ?? []) as any[])
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
    if (lineas.length > 0) {
      comandas = [
        {
          clave: o.id,
          hora: horaDeLima(o.created_at),
          instante: instanteDe(o.created_at),
          numero: o.order_number ?? null,
          lineas,
        },
      ];
    }
  }

  if (cargando) {
    return <div className="mb-2 h-9 animate-pulse rounded-xl bg-muted/60" />;
  }
  if (comandas.length === 0) return null;

  const todas = comandas.flatMap((c) => c.lineas);
  const unidades = todas.reduce((suma, l) => suma + l.cantidad, 0);
  const importe = todas.reduce((suma, l) => suma + l.total, 0);
  // Ya ordenadas por antigüedad: la primera responde "¿desde cuándo lleva esta
  // cuenta esperando algo?".
  const desde = comandas[0]?.hora;

  return (
    <div className="mb-2 rounded-xl border border-border/70 bg-muted/30">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        aria-label={`Ya en cocina: ${unidades} unidades por ${formatCurrency(importe)}. ${
          abierto ? "Plegar" : "Desplegar"
        } el detalle`}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-emerald-600 dark:text-emerald-400">
          Ya en cocina
        </span>
        <span className="h-px flex-1 bg-border/70" />
        <span className="text-[11.5px] tabular-nums text-muted-foreground">
          {desde && `desde ${desde} · `}
          {formatCurrency(importe)}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${
            abierto ? "rotate-180" : ""
          }`}
        />
      </button>

      {abierto && (
        <div className="max-h-48 space-y-2.5 overflow-y-auto px-3 pb-2.5">
          {comandas.map((comanda) => (
            <div key={comanda.clave}>
              {/* Con varias rondas, saber cuál salió a qué hora es el dato. */}
              {comandas.length > 1 && (
                <p className="mb-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground/70">
                  Enviado {comanda.hora}
                </p>
              )}
              <ul className="space-y-1">
                {comanda.lineas.map((l) => (
                  <li
                    key={l.clave}
                    className="flex items-start gap-2 text-[12px] text-muted-foreground"
                  >
                    <span className="w-5 shrink-0 text-right font-bold tabular-nums">
                      {l.cantidad}
                    </span>
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
