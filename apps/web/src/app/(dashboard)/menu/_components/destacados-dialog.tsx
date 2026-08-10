"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@restai/ui/components/dialog";
import { Button } from "@restai/ui/components/button";
import { Loader2, Star, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { useTopItems } from "@/hooks/use-reports";
import { useBulkUpdateMenuItems } from "@/hooks/use-menu";

/**
 * Qué se vende de verdad, y la oferta de anclarlo en la caja.
 *
 * Existe porque nadie sabe de memoria qué se vende más, y menos que nadie quien
 * cocina: los operadores sobrevaloran el plato del que están orgullosos e
 * infravaloran el aburrido que se vende solo. Esta pantalla es la cifra delante.
 *
 * Pero la cifra NO reordena la caja por su cuenta. Lo que hace rápida a una caja
 * es que la mano vaya sola, y una fila de atajos que se recalcula cada semana
 * obliga a releerla cada semana. Aquí el sistema propone QUÉ entra y una persona
 * decide CUÁNDO cambia — así un catering puntual de doscientas empanadas no le
 * reconfigura el punto de venta a nadie a mitad de servicio.
 */

/** Cuánto mira hacia atrás la sugerencia. */
const DIAS = 30;
/** Cuántos platos caben cómodos en la fila anclada de la caja. */
const RECOMENDADOS = 6;

/** "2026-08-10" en la fecha civil peruana, que es la que entiende el informe. */
function diaDeLima(desplazamientoDias = 0): string {
  const ahora = new Date();
  const lima = new Date(ahora.getTime() - 5 * 60 * 60 * 1000);
  lima.setUTCDate(lima.getUTCDate() + desplazamientoDias);
  return lima.toISOString().slice(0, 10);
}

export function DestacadosDialog({
  abierto,
  onCerrar,
}: {
  abierto: boolean;
  onCerrar: () => void;
}) {
  const desde = useMemo(() => diaDeLima(-DIAS), []);
  const hasta = useMemo(() => diaDeLima(0), []);
  const { data: ranking, isLoading } = useTopItems(
    abierto ? desde : undefined,
    abierto ? hasta : undefined,
    12,
  );
  const bulk = useBulkUpdateMenuItems();

  /** Lo que quedará anclado al aplicar. */
  const [elegidos, setElegidos] = useState<Set<string>>(() => new Set());
  /** La selección se siembra UNA vez por apertura, o se pisaría al teclear. */
  const [sembrado, setSembrado] = useState(false);

  useEffect(() => {
    if (!abierto) {
      setSembrado(false);
      return;
    }
    if (sembrado || !ranking) return;
    setSembrado(true);
    /*
      Arranca con lo ya anclado MÁS los primeros vendibles hasta completar seis.
      Sembrar solo con el ranking borraría de un plumazo lo que el dueño hubiera
      anclado a mano por un motivo que el sistema no conoce: el postre de la casa
      que hay que empujar, el combo del día.
    */
    const inicial = new Set(ranking.filter((r) => r.isFeatured).map((r) => r.menuItemId));
    for (const fila of ranking) {
      if (inicial.size >= RECOMENDADOS) break;
      if (fila.isSellable) inicial.add(fila.menuItemId);
    }
    setElegidos(inicial);
  }, [abierto, ranking, sembrado]);

  const yaAnclados = useMemo(
    () => new Set((ranking ?? []).filter((r) => r.isFeatured).map((r) => r.menuItemId)),
    [ranking],
  );

  const aAnclar = [...elegidos].filter((id) => !yaAnclados.has(id));
  const aSoltar = [...yaAnclados].filter((id) => !elegidos.has(id));
  const hayCambio = aAnclar.length > 0 || aSoltar.length > 0;

  const aplicar = async () => {
    try {
      // Dos llamadas porque el lote lleva UN valor: primero se sueltan los que
      // salen y después se anclan los que entran. Cada una es atómica.
      if (aSoltar.length > 0) {
        await bulk.mutateAsync({ ids: aSoltar, patch: { isFeatured: false } });
      }
      if (aAnclar.length > 0) {
        await bulk.mutateAsync({ ids: aAnclar, patch: { isFeatured: true } });
      }
      toast.success(
        `${elegidos.size} ${elegidos.size === 1 ? "plato anclado" : "platos anclados"} en la caja`,
        { description: "Quien cobra los verá arriba, siempre en el mismo sitio." },
      );
      onCerrar();
    } catch (err: any) {
      toast.error("No se pudo aplicar", { description: err?.message });
    }
  };

  const filas = ranking ?? [];
  const maximo = filas[0]?.totalQuantity ?? 1;

  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="flex max-h-[85vh] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Lo que más se vende
          </DialogTitle>
          <DialogDescription>
            Últimos {DIAS} días en esta sede. Elige cuáles quieres anclar arriba de la caja
            para que quien cobra no tenga que buscarlos.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2 py-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-11 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        ) : filas.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Todavía no hay ventas en los últimos {DIAS} días. Cuando las haya, aquí saldrá
            el ranking real.
          </p>
        ) : (
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
            {filas.map((fila, indice) => {
              const elegido = elegidos.has(fila.menuItemId);
              return (
                <button
                  key={fila.menuItemId}
                  type="button"
                  disabled={!fila.isSellable}
                  aria-pressed={elegido}
                  onClick={() =>
                    setElegidos((prev) => {
                      const siguiente = new Set(prev);
                      if (siguiente.has(fila.menuItemId)) siguiente.delete(fila.menuItemId);
                      else siguiente.add(fila.menuItemId);
                      return siguiente;
                    })
                  }
                  className={`relative flex w-full items-center gap-3 overflow-hidden rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-50 ${
                    elegido ? "border-amber-500/40 bg-amber-500/[0.08]" : "border-border/70 hover:bg-muted/50"
                  }`}
                >
                  {/* Barra de fondo: la proporción se lee antes que el número. */}
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 left-0 bg-foreground/[0.045]"
                    style={{ width: `${Math.round((fila.totalQuantity / maximo) * 100)}%` }}
                  />
                  <span className="relative w-4 shrink-0 text-[11px] font-bold tabular-nums text-muted-foreground">
                    {indice + 1}
                  </span>
                  <Star
                    className={`relative h-4 w-4 shrink-0 ${
                      elegido ? "fill-amber-500 text-amber-500" : "text-muted-foreground/30"
                    }`}
                  />
                  <span className="relative min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{fila.name}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {/*
                        Solo VECES, no importe. La fila anclada existe para
                        ahorrar toques, y los toques van con la frecuencia; poner
                        el dinero al lado invita a anclar el plato caro que se
                        vende cuatro veces por semana, que es justo lo contrario.
                      */}
                      Se cantó {fila.totalQuantity}{" "}
                      {fila.totalQuantity === 1 ? "vez" : "veces"}
                      {!fila.isSellable && " · fuera de la carta"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-2 border-t pt-3">
          <p className="min-w-0 flex-1 text-[11.5px] text-muted-foreground">
            {hayCambio
              ? `${aAnclar.length > 0 ? `+${aAnclar.length} ` : ""}${aSoltar.length > 0 ? `−${aSoltar.length}` : ""} · quedarán ${elegidos.size} anclados`
              : `${elegidos.size} anclados · sin cambios`}
          </p>
          <Button variant="outline" className="h-10" onClick={onCerrar}>
            Cerrar
          </Button>
          <Button className="h-10" disabled={!hayCambio || bulk.isPending} onClick={aplicar}>
            {bulk.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Aplicando…
              </>
            ) : (
              "Aplicar"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
