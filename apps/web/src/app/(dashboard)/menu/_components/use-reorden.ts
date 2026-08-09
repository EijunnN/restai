"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { hayCambio, indiceSoltar, moverElemento } from "./reorder";

/**
 * Arrastrar para reordenar, con eventos de puntero.
 *
 * Sin librería, igual que el plano de sala: es el patrón vivo del repositorio y
 * mete cero kilobytes en el paquete. Los eventos de puntero cubren ratón, dedo y
 * lápiz con el mismo código, que es lo que hace falta cuando la pantalla se usa
 * tanto en un portátil como en la tablet de la barra.
 *
 * Cuatro cosas que parecen detalles y no lo son:
 *
 * 1. `setPointerCapture`: sin él, sacar el dedo del contenedor deja el arrastre
 *    pegado y la fila viajando sola por la pantalla.
 * 2. `touchAction: "none"` en la manija: sin él, el navegador se queda el gesto
 *    para hacer scroll y el arrastre no llega a ocurrir. La lista TIENE scroll,
 *    así que el conflicto es seguro, no hipotético.
 * 3. Los centros se miden UNA vez, al empezar: medirlos en cada movimiento
 *    mientras las filas se recolocan produce un baile en el que la fila
 *    arrastrada persigue su propio hueco.
 * 4. Estado optimista: las mutaciones de la carta solo invalidan la consulta,
 *    así que sin él la fila salta a su sitio anterior hasta que vuelve el GET y
 *    parece que el arrastre no se guardó.
 */

interface Arrastre {
  id: string;
  desde: number;
  centros: number[];
  puntero: number;
}

export function useReordenArrastre({
  ids,
  habilitado,
  onSoltar,
}: {
  /** Orden que manda el servidor. */
  ids: string[];
  habilitado: boolean;
  /** Se llama solo si el orden cambió de verdad. */
  onSoltar: (nuevos: string[]) => void;
}) {
  const [ordenLocal, setOrdenLocal] = useState<string[] | null>(null);
  const [arrastre, setArrastre] = useState<Arrastre | null>(null);
  const filas = useRef(new Map<string, HTMLElement>());

  const visibles = ordenLocal ?? ids;

  /*
    Se suelta el orden optimista cuando el servidor ya devuelve el mismo: si se
    soltara nada más guardar, la lista parpadearía al orden viejo durante el
    tiempo que tarda el GET.
  */
  useEffect(() => {
    if (ordenLocal && !hayCambio(ordenLocal, ids)) setOrdenLocal(null);
  }, [ids, ordenLocal]);

  /** Deshace el orden optimista. Lo usa quien maneje el error del guardado. */
  const revertir = useCallback(() => setOrdenLocal(null), []);

  const registrarFila = useCallback((id: string, el: HTMLElement | null) => {
    if (el) filas.current.set(id, el);
    else filas.current.delete(id);
  }, []);

  const empezar = useCallback(
    (id: string) => (e: React.PointerEvent) => {
      if (!habilitado) return;

      // La fila entera abre la ficha al hacer clic: sin esto, arrastrar acabaría
      // abriendo el plato que se acaba de mover.
      e.preventDefault();
      e.stopPropagation();

      // La captura puede fallar (puntero ya liberado, evento sintético) y lanza
      // en vez de devolver falso. Si se dejara propagar, el arrastre no llegaría
      // ni a empezar y el fallo sería invisible: la manija simplemente no haría
      // nada. Sin captura el arrastre funciona igual mientras el puntero no se
      // salga del contenedor, así que se sigue adelante.
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* sin captura, pero con arrastre */
      }

      const orden = ordenLocal ?? ids;
      const centros = orden.map((otro) => {
        const el = filas.current.get(otro);
        if (!el) return Number.NEGATIVE_INFINITY;
        const r = el.getBoundingClientRect();
        return r.top + r.height / 2;
      });

      setArrastre({ id, desde: orden.indexOf(id), centros, puntero: e.clientY });
    },
    [habilitado, ids, ordenLocal],
  );

  const mover = useCallback(
    (e: React.PointerEvent) => {
      if (!arrastre) return;

      const base = ordenLocal ?? ids;
      const destino = indiceSoltar(e.clientY, arrastre.centros);
      const siguiente = moverElemento(base, base.indexOf(arrastre.id), destino);

      if (hayCambio(base, siguiente)) setOrdenLocal(siguiente);
      setArrastre({ ...arrastre, puntero: e.clientY });
    },
    [arrastre, ids, ordenLocal],
  );

  const soltar = useCallback(() => {
    if (!arrastre) return;
    setArrastre(null);

    const final = ordenLocal;
    // Sin cambio no se llama al servidor: un clic accidental en la manija no
    // tiene por qué generar una escritura ni un aviso.
    if (final && hayCambio(ids, final)) onSoltar(final);
    else setOrdenLocal(null);
  }, [arrastre, ids, onSoltar, ordenLocal]);

  return {
    /** Orden a pintar: el optimista si hay, el del servidor si no. */
    visibles,
    /** Id que se está arrastrando ahora mismo, para destacarlo. */
    arrastrandoId: arrastre?.id ?? null,
    registrarFila,
    revertir,
    /** Props para la MANIJA, no para la fila entera. */
    manija: (id: string) => ({
      onPointerDown: empezar(id),
      onPointerMove: mover,
      onPointerUp: soltar,
      onPointerCancel: soltar,
      style: { touchAction: "none" as const },
    }),
  };
}
