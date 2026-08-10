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
 * 3. Los centros se miden UNA vez, al empezar, y cada movimiento recompone la
 *    lista DESDE el orden inicial —nunca encadenando sobre el resultado del
 *    movimiento anterior—. Encadenar parecía equivalente y no lo es: en cuanto
 *    la fila se movía una vez, su índice actual dejaba de coincidir con el hueco
 *    que miden los centros, y volver hacia atrás la dejaba clavada. Bajabas dos
 *    puestos, subías de nuevo y ya no volvía. Recomponer desde el principio es
 *    además idempotente: el mismo píxel da siempre el mismo orden.
 * 4. Estado optimista: las mutaciones de la carta solo invalidan la consulta,
 *    así que sin él la fila salta a su sitio anterior hasta que vuelve el GET y
 *    parece que el arrastre no se guardó.
 */

interface Arrastre {
  id: string;
  /** Orden al empezar. Cada movimiento recompone DESDE aquí, nunca encadenando. */
  orden: string[];
  /** Posición del elemento en `orden`. Fija durante todo el arrastre. */
  desde: number;
  /** Centro vertical de cada hueco, medido una vez al empezar. */
  centros: number[];
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

      setArrastre({ id, orden, desde: orden.indexOf(id), centros });
    },
    [habilitado, ids, ordenLocal],
  );

  const mover = useCallback(
    (e: React.PointerEvent) => {
      if (!arrastre) return;

      /*
        Siempre desde el orden INICIAL y el índice INICIAL. Recomponer sobre el
        resultado anterior hacía que, tras el primer salto, el índice actual del
        elemento dejara de corresponder con el hueco que miden los centros: al
        volver hacia arriba el cálculo daba "quédate donde estás" y la fila se
        quedaba clavada abajo.
      */
      const destino = indiceSoltar(e.clientY, arrastre.centros);
      const siguiente = moverElemento(arrastre.orden, arrastre.desde, destino);

      // Solo se repinta si el orden cambia de verdad: si no, cada píxel de
      // movimiento provocaría un renderizado de la lista entera.
      setOrdenLocal((actual) => {
        const previo = actual ?? arrastre.orden;
        return hayCambio(previo, siguiente) ? siguiente : actual;
      });
    },
    [arrastre],
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
