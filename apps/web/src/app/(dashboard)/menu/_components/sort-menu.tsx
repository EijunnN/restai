"use client";

import { Check, SlidersHorizontal } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@restai/ui/components/popover";
import { ORDENES, type ClaveOrden } from "./menu-filters";

/**
 * Ordena la VISTA, no la carta.
 *
 * El rótulo lo dice en voz alta porque la confusión es cara: quien ordena por
 * precio y ve los caros arriba puede creer que acaba de cambiar lo que ve el
 * comensal. No lo ha hecho. La posición en la carta se cambia en otro sitio.
 */
export function SortMenu({
  criterio,
  onCambiar,
}: {
  criterio: ClaveOrden;
  onCambiar: (c: ClaveOrden) => void;
}) {
  const actual = ORDENES.find((o) => o.clave === criterio);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-[30px] items-center gap-1.5 rounded-[9px] bg-muted px-2.5 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {actual?.label ?? "Ordenar"}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-1.5">
        {ORDENES.map((o) => (
          <button
            key={o.clave}
            type="button"
            onClick={() => onCambiar(o.clave)}
            className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-muted ${
              o.clave === criterio ? "font-semibold" : ""
            }`}
          >
            <Check
              className={`h-3.5 w-3.5 shrink-0 ${
                o.clave === criterio ? "opacity-100" : "opacity-0"
              }`}
            />
            {o.label}
          </button>
        ))}
        <p className="mt-1 border-t border-border/60 px-2.5 pb-1 pt-2 text-[11px] leading-snug text-muted-foreground">
          Cambia cómo lo ves aquí. Lo que ve el comensal sigue igual.
        </p>
      </PopoverContent>
    </Popover>
  );
}
