"use client";

import { ChevronRight, Settings2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { describirRegla, esObligatorio, type GrupoConUso } from "./menu-filters";

/**
 * Los grupos de modificadores, abiertos.
 *
 * El acordeón anterior enseñaba un grupo cada vez, así que comparar "Extras"
 * con "Guarnición" —lo que se hace justo antes de decidir cuál lleva un plato—
 * pedía dos clics y perder de vista el primero. Aquí las opciones de cada grupo
 * se ven de un vistazo, con su recargo, que es el dato que importa.
 */

export function ModifierGroupsList({
  grupos,
  grupoActivoId,
  onAbrir,
}: {
  grupos: GrupoConUso[];
  grupoActivoId: string | null;
  onAbrir: (id: string) => void;
}) {
  if (grupos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-muted/25 py-16 text-center">
        <Settings2 className="h-7 w-7 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">Ningún grupo cumple lo que has pedido</p>
        <p className="max-w-xs text-xs text-muted-foreground/70">
          Los modificadores son lo que el comensal elige sin cambiar de plato: el
          término de la carne, la guarnición, los extras.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto">
      {grupos.map((g) => {
        const activo = grupoActivoId === g.id;
        const usos = g.used_in_items ?? 0;
        const obligatorio = esObligatorio(g);
        const opciones = g.modifiers ?? [];

        return (
          <button
            key={g.id}
            type="button"
            onClick={() => onAbrir(g.id)}
            className={`shrink-0 rounded-2xl px-4 py-3.5 text-left transition-colors ${
              activo
                ? "bg-muted/70 shadow-[inset_3px_0_0_var(--foreground)]"
                : "bg-muted/25 hover:bg-muted/50"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <span className="truncate text-[15px] font-bold tracking-tight">{g.name}</span>
              <span
                className={`flex h-[19px] shrink-0 items-center rounded-md px-1.5 text-[11px] font-bold ${
                  obligatorio
                    ? "bg-violet-500/15 text-violet-500 dark:text-violet-300"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {obligatorio ? "Obligatorio" : "Opcional"}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {describirRegla(g)}
              </span>
              <span className="flex-1" />
              <span
                className={`shrink-0 text-xs ${
                  usos === 0 ? "text-amber-500" : "text-muted-foreground"
                }`}
              >
                {usos === 0
                  ? "Sin usar"
                  : `${usos} ${usos === 1 ? "producto" : "productos"}`}
              </span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </div>

            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {opciones.length === 0 ? (
                <span className="text-[11.5px] text-amber-500">
                  Sin opciones: el comensal no puede completarlo.
                </span>
              ) : (
                opciones.map((o: any) => (
                  <span
                    key={o.id}
                    className={`flex h-[26px] items-center gap-1.5 rounded-lg px-2.5 text-xs ${
                      o.is_available === false
                        ? "bg-muted/40 text-muted-foreground line-through"
                        : "bg-muted/70"
                    }`}
                  >
                    {o.name}
                    {o.price > 0 && (
                      <span className="font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                        +{formatCurrency(o.price)}
                      </span>
                    )}
                  </span>
                ))
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
