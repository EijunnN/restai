"use client";

/**
 * Los filtros rápidos.
 *
 * Un chip con recuento cero no se esconde: que "Sin foto" marque 0 es
 * exactamente la información que se busca. Se apaga y se deja sin pulsar, para
 * que la barra no cambie de tamaño cada vez que se arregla un plato.
 */

export function FilterChips<T extends string>({
  filtros,
  activo,
  conteo,
  onCambiar,
  nota,
  extra,
}: {
  filtros: readonly { clave: T; label: string; punto?: "verde" | "ambar" }[];
  activo: T;
  conteo: Record<T, number>;
  onCambiar: (clave: T) => void;
  nota?: string;
  /** Controles que van al final de la barra, como el orden de la vista. */
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {filtros.map((f) => {
        const n = conteo[f.clave] ?? 0;
        const seleccionado = activo === f.clave;
        const vacio = n === 0 && !seleccionado;

        return (
          <button
            key={f.clave}
            type="button"
            disabled={vacio}
            onClick={() => onCambiar(f.clave)}
            className={`flex h-[30px] items-center gap-1.5 rounded-[10px] px-3 text-[12.5px] font-semibold transition-colors ${
              seleccionado
                ? "bg-foreground text-background"
                : vacio
                  ? "cursor-default bg-muted/40 text-muted-foreground/50"
                  : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.punto && (
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  f.punto === "verde" ? "bg-emerald-500" : "bg-amber-500"
                }`}
              />
            )}
            {f.label}
            <span className="text-[11px] font-bold tabular-nums opacity-60">{n}</span>
          </button>
        );
      })}

      <span className="flex-1" />
      {nota && <span className="text-[11.5px] text-muted-foreground">{nota}</span>}
      {extra}
    </div>
  );
}
