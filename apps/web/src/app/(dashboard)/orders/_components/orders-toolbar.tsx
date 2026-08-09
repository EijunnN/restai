"use client";

import Link from "next/link";
import { Plus, Search, X } from "lucide-react";

/**
 * Cabecera: dónde estás, qué estás mirando y lo que vas a hacer.
 *
 * "En curso" e "Historial" son dos trabajos distintos y por eso son dos
 * pestañas: en el servicio se decide y se actúa; en el historial se busca, se
 * compara y se exporta. Meterlos en la misma tabla —que es lo que había—
 * significa que el servicio vivo queda enterrado bajo meses de comandas.
 */

export function OrdersToolbar({
  subtitulo,
  vista,
  onVista,
  totalEnCurso,
  busqueda,
  onBusqueda,
  puedeCrear,
  acciones,
}: {
  subtitulo: string;
  vista: "curso" | "historial";
  onVista: (v: "curso" | "historial") => void;
  totalEnCurso: number;
  busqueda: string;
  onBusqueda: (v: string) => void;
  puedeCrear: boolean;
  /** El botón de fichar turno, que vive en esta cabecera desde siempre. */
  acciones?: React.ReactNode;
}) {
  const enCurso = vista === "curso";

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <div className="flex flex-col pr-1.5">
        <h1 className="text-xl font-extrabold leading-tight tracking-tight">Órdenes</h1>
        <p className="text-[11.5px] text-muted-foreground">{subtitulo}</p>
      </div>

      <span className="hidden h-7 w-px bg-border sm:block" />

      <div className="flex rounded-xl bg-muted p-[3px]">
        <button
          type="button"
          onClick={() => onVista("curso")}
          className={`flex h-[30px] items-center gap-1.5 rounded-[9px] px-3 text-[12.5px] transition-colors ${
            enCurso
              ? "bg-background font-bold shadow-sm"
              : "font-semibold text-muted-foreground hover:text-foreground"
          }`}
        >
          En curso
          <span className="text-[11px] font-bold opacity-60">{totalEnCurso}</span>
        </button>
        <button
          type="button"
          onClick={() => onVista("historial")}
          className={`flex h-[30px] items-center rounded-[9px] px-3 text-[12.5px] transition-colors ${
            !enCurso
              ? "bg-background font-bold shadow-sm"
              : "font-semibold text-muted-foreground hover:text-foreground"
          }`}
        >
          Historial
        </button>
      </div>

      <span className="flex-1" />

      <div className="relative w-full sm:w-[240px]">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-muted-foreground" />
        <input
          value={busqueda}
          onChange={(e) => onBusqueda(e.target.value)}
          placeholder="Nº, mesa o cliente"
          aria-label="Buscar una orden"
          className="h-9 w-full rounded-xl bg-muted pl-9 pr-8 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
        {busqueda && (
          <button
            type="button"
            onClick={() => onBusqueda("")}
            aria-label="Borrar la búsqueda"
            className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {acciones}

      {/* Las órdenes se levantan en el punto de venta: no hay alta aquí, y
          fingir un botón propio llevaría al mismo sitio dando un rodeo. */}
      {puedeCrear && (
        <Link
          href="/pos"
          className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-[13px] font-bold text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Plus className="h-[15px] w-[15px]" />
          Nueva orden
        </Link>
      )}
    </div>
  );
}
