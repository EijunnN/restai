"use client";

import { useMemo, useState } from "react";
import { Button } from "@restai/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@restai/ui/components/dialog";
import { AlertCircle, Ban, RefreshCw, RotateCcw, Search, UtensilsCrossed } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useKitchenMenuAvailability,
  useKitchenMenuCategories,
  useToggleMenuAvailability,
  type KitchenMenuCategory,
  type KitchenMenuItem,
} from "@/hooks/use-kitchen";

/**
 * Panel de carta del KDS: marcar agotado / reponer sin salir de cocina.
 *
 * El botón que vive en la línea de comanda solo alcanza a los platos que ya
 * están pedidos, y el caso normal es el contrario: se acaba el pescado ANTES de
 * que nadie lo pida, y hasta ahora eso obligaba a llamar al gerente para que lo
 * quitara desde la pantalla de Carta. Aquí está la carta entera.
 *
 * La disponibilidad se lee de GET /api/menu/items y se refresca sola con el
 * evento `menu:availability` (lo invalida el contexto de cocina), así que dos
 * tablets marcando a la vez no se pisan la pantalla.
 */
export function MenuAvailabilityPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [soloAgotados, setSoloAgotados] = useState(false);

  // Solo se consulta con el panel abierto: el KDS pasa el servicio entero
  // montado y no tiene sentido sostener la carta en memoria mientras no se mira.
  const platos = useKitchenMenuAvailability(open);
  const categorias = useKitchenMenuCategories(open);
  const { alternar, enCambio } = useToggleMenuAvailability();

  const nombrePorCategoria = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const c of (categorias.data ?? []) as KitchenMenuCategory[]) {
      mapa.set(c.id, c.name);
    }
    return mapa;
  }, [categorias.data]);

  const termino = busqueda.trim().toLowerCase();

  const grupos = useMemo(() => {
    const lista = ((platos.data ?? []) as KitchenMenuItem[]).filter((p) => {
      if (soloAgotados && p.is_available) return false;
      if (termino && !p.name.toLowerCase().includes(termino)) return false;
      return true;
    });

    const porCategoria = new Map<string, KitchenMenuItem[]>();
    for (const p of lista) {
      const clave = p.category_id ?? "__sin_categoria__";
      const bucket = porCategoria.get(clave);
      if (bucket) bucket.push(p);
      else porCategoria.set(clave, [p]);
    }

    return [...porCategoria.entries()]
      .map(([clave, items]) => ({
        clave,
        titulo:
          clave === "__sin_categoria__"
            ? "Sin categoría"
            : nombrePorCategoria.get(clave) ?? "Sin categoría",
        items: [...items].sort((a, b) => a.name.localeCompare(b.name, "es")),
      }))
      .sort((a, b) => a.titulo.localeCompare(b.titulo, "es"));
  }, [platos.data, soloAgotados, termino, nombrePorCategoria]);

  const totalAgotados = useMemo(
    () => ((platos.data ?? []) as KitchenMenuItem[]).filter((p) => !p.is_available).length,
    [platos.data],
  );

  const hayResultados = grupos.some((g) => g.items.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>Disponibilidad de la carta</DialogTitle>
          <DialogDescription>
            Retira un plato cuando se acabe y repónlo cuando vuelva a haber. El cambio
            llega al instante a los comensales y al punto de venta.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar plato"
              aria-label="Buscar un plato de la carta"
              className="h-11 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <button
            type="button"
            onClick={() => setSoloAgotados((v) => !v)}
            aria-pressed={soloAgotados}
            className={cn(
              "inline-flex h-11 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-semibold transition-colors",
              soloAgotados
                ? "border-destructive bg-destructive/10 text-destructive"
                : "border-border bg-background hover:bg-muted",
            )}
          >
            <Ban className="h-4 w-4" aria-hidden="true" />
            Solo agotados
            {totalAgotados > 0 && (
              <span className="rounded-full bg-destructive/20 px-2 py-0.5 text-xs font-bold tabular-nums text-destructive">
                {totalAgotados}
              </span>
            )}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {platos.isLoading ? (
            <div className="space-y-2 py-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-14 animate-pulse rounded-xl bg-muted" />
              ))}
            </div>
          ) : platos.error ? (
            <div
              role="alert"
              className="flex flex-col items-start gap-3 rounded-2xl border border-destructive/50 bg-destructive/5 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
                <p className="text-sm text-destructive">
                  No se pudo cargar la carta: {(platos.error as Error).message}
                </p>
              </div>
              <Button
                variant="outline"
                className="h-10 shrink-0 rounded-xl"
                onClick={() => platos.refetch()}
              >
                <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                Reintentar
              </Button>
            </div>
          ) : !hayResultados ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <UtensilsCrossed className="h-10 w-10 text-muted-foreground/40" aria-hidden="true" />
              <p className="text-sm font-semibold text-foreground">
                {soloAgotados
                  ? "No hay ningún plato agotado"
                  : termino
                    ? `Ningún plato coincide con «${busqueda.trim()}»`
                    : "Esta sede todavía no tiene platos en la carta"}
              </p>
              <p className="max-w-sm text-sm text-muted-foreground">
                {soloAgotados
                  ? "Toda la carta está disponible ahora mismo."
                  : termino
                    ? "Revisa cómo está escrito o borra la búsqueda."
                    : "Pídele al gerente que dé de alta los platos desde la pantalla de Carta."}
              </p>
            </div>
          ) : (
            <div className="space-y-5 py-1">
              {grupos.map((grupo) => (
                <section key={grupo.clave}>
                  <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                    {grupo.titulo}
                  </h3>
                  <ul className="space-y-2">
                    {grupo.items.map((plato) => {
                      const agotado = !plato.is_available;
                      const ocupado = enCambio.has(plato.id);
                      return (
                        <li
                          key={plato.id}
                          className={cn(
                            "flex items-center justify-between gap-3 rounded-xl border px-3 py-2",
                            agotado
                              ? "border-destructive/40 bg-destructive/5"
                              : "border-border bg-card",
                          )}
                        >
                          <div className="min-w-0">
                            <p
                              className={cn(
                                "truncate text-sm font-semibold",
                                agotado ? "text-muted-foreground line-through" : "text-foreground",
                              )}
                            >
                              {plato.name}
                            </p>
                            <p
                              className={cn(
                                "text-xs font-medium",
                                agotado ? "text-destructive" : "text-muted-foreground",
                              )}
                            >
                              {agotado ? "Agotado en la carta" : "Disponible"}
                            </p>
                          </div>

                          <button
                            type="button"
                            disabled={ocupado}
                            onClick={() => alternar(plato.id, plato.name, agotado)}
                            aria-label={
                              agotado
                                ? `Reponer ${plato.name} en la carta`
                                : `Marcar ${plato.name} como agotado en la carta`
                            }
                            className={cn(
                              "inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border px-4 text-sm font-bold transition-colors disabled:opacity-50",
                              agotado
                                ? "border-green-600/50 text-green-700 hover:bg-green-500/10 dark:text-green-400"
                                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                            )}
                          >
                            {agotado ? (
                              <>
                                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                                {ocupado ? "Guardando…" : "Reponer"}
                              </>
                            ) : (
                              <>
                                <Ban className="h-4 w-4" aria-hidden="true" />
                                {ocupado ? "Guardando…" : "Sin stock"}
                              </>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
