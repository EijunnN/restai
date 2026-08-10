"use client";

import { ExternalLink, Plus, Search, TrendingUp } from "lucide-react";
import { Button } from "@restai/ui/components/button";

/**
 * Cabecera: quién eres, qué estás mirando y las dos cosas que vas a hacer.
 *
 * El selector Productos/Modificadores es un par de botones y no las pestañas de
 * Radix porque la pantalla ya no cambia de contenido debajo: cambia la lista de
 * la izquierda y la ficha de la derecha, y el resto del andamiaje se queda.
 */

export function MenuToolbar({
  subtitulo,
  vista,
  onVista,
  totalProductos,
  totalGrupos,
  busqueda,
  onBusqueda,
  puedeCrear,
  puedeVerVentas,
  onVerMasVendidos,
  onCrear,
  urlCarta,
}: {
  subtitulo: string;
  vista: "productos" | "modificadores";
  onVista: (v: "productos" | "modificadores") => void;
  totalProductos: number;
  totalGrupos: number;
  busqueda: string;
  onBusqueda: (v: string) => void;
  puedeCrear: boolean;
  /**
   * Puede leer cifras de venta (`reports:read`). Lo tienen todos los que pueden
   * editar la carta, pero se comprueba igual: montar el botón sin permiso sería
   * ofrecer algo que responde 403.
   */
  puedeVerVentas?: boolean;
  onVerMasVendidos?: () => void;
  onCrear: () => void;
  /** Dirección pública de la carta. Sin ella el botón no se pinta. */
  urlCarta?: string | null;
}) {
  const enProductos = vista === "productos";

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <div className="flex flex-col pr-1.5">
        <h1 className="text-xl font-extrabold leading-tight tracking-tight">Carta</h1>
        <p className="text-[11.5px] text-muted-foreground">{subtitulo}</p>
      </div>

      <span className="hidden h-7 w-px bg-border sm:block" />

      <div className="flex rounded-xl bg-muted p-[3px]">
        <button
          type="button"
          onClick={() => onVista("productos")}
          className={`flex h-[30px] items-center gap-1.5 rounded-[9px] px-3 text-[12.5px] transition-colors ${
            enProductos
              ? "bg-background font-bold shadow-sm"
              : "font-semibold text-muted-foreground hover:text-foreground"
          }`}
        >
          Productos
          {!enProductos && (
            <span className="text-[11px] font-bold opacity-60">{totalProductos}</span>
          )}
        </button>
        <button
          type="button"
          onClick={() => onVista("modificadores")}
          className={`flex h-[30px] items-center gap-1.5 rounded-[9px] px-3 text-[12.5px] transition-colors ${
            !enProductos
              ? "bg-background font-bold shadow-sm"
              : "font-semibold text-muted-foreground hover:text-foreground"
          }`}
        >
          Modificadores
          {enProductos && (
            <span className="text-[11px] font-bold opacity-60">{totalGrupos}</span>
          )}
        </button>
      </div>

      <span className="flex-1" />

      <div className="relative w-full sm:w-[250px]">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-muted-foreground" />
        <input
          value={busqueda}
          onChange={(e) => onBusqueda(e.target.value)}
          placeholder={
            enProductos ? "Buscar plato, ingrediente…" : "Buscar grupo u opción…"
          }
          className="h-9 w-full rounded-xl bg-muted pl-9 pr-3 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {/*
        Abre EXACTAMENTE lo que ve el comensal, no una imitación. Es la forma
        más rápida de descubrir que un plato salió sin foto o que una categoría
        se quedó desactivada, cosas que en esta pantalla no se notan.
      */}
      {urlCarta && (
        <a
          href={urlCarta}
          target="_blank"
          rel="noreferrer"
          className="flex h-9 items-center gap-1.5 rounded-xl bg-muted px-3 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ExternalLink className="h-[15px] w-[15px]" />
          Ver carta
        </a>
      )}

      {/*
        Qué se vende de verdad. Solo en la vista de productos: sobre los grupos de
        modificadores no significa nada.
      */}
      {enProductos && puedeVerVentas && onVerMasVendidos && (
        <button
          type="button"
          onClick={onVerMasVendidos}
          className="flex h-9 items-center gap-1.5 rounded-xl bg-muted px-3 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <TrendingUp className="h-[15px] w-[15px]" />
          Más vendidos
        </button>
      )}

      {puedeCrear && (
        <Button size="sm" className="h-9 rounded-xl" onClick={onCrear}>
          <Plus className="mr-1.5 h-[15px] w-[15px]" />
          {enProductos ? "Nuevo producto" : "Nuevo grupo"}
        </Button>
      )}
    </div>
  );
}
