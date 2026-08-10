/**
 * Reordenar arrastrando: la parte que se puede probar sin ratón.
 *
 * El arrastre en sí es un puñado de eventos de puntero; lo que se equivoca de
 * verdad es lo de alrededor —a qué posición corresponde el puntero, si el
 * arrastre significa algo en la vista actual, y si al soltar ha cambiado algo—
 * y eso es lo que vive aquí.
 */

/**
 * Mueve un elemento a una posición. No muta la lista original.
 *
 * `hasta` es una posición de INSERCIÓN medida sobre la lista ORIGINAL, con el
 * elemento arrastrado todavía dentro: 0 = delante de todos, `length` = detrás de
 * todos. Es lo que devuelve `indiceSoltar`, que cuenta cuántos centros de fila
 * han quedado por encima del puntero.
 *
 * De ahí el ajuste al bajar, que es donde estuvo el fallo. Al sacar el elemento
 * de su sitio, todo lo que estaba por debajo sube un puesto, así que insertar en
 * el índice sin corregir lo deja UNA posición más abajo de donde se soltó.
 * Arrastrar la primera fila justo por debajo del centro de la segunda daba
 * `B, C, A, D` en vez de `B, A, C, D`.
 *
 * El síntoma era desconcertante justamente porque solo pasaba en un sentido:
 * subiendo el índice de inserción no se ve afectado —lo que se quita está por
 * debajo del destino— y funcionaba bien. Media función correcta se siente como
 * "va a ratos", que es peor que no ir.
 */
export function moverElemento<T>(lista: T[], desde: number, hasta: number): T[] {
  if (desde < 0 || desde >= lista.length) return lista;

  // Bajando, el hueco que deja el propio elemento corre un puesto el destino.
  const ajustado = hasta > desde ? hasta - 1 : hasta;
  if (ajustado === desde) return lista;

  const copia = [...lista];
  const [elemento] = copia.splice(desde, 1);
  // Se recorta DESPUÉS de sacarlo: soltar más allá del final debe dejarlo el
  // último, no descolocar la lista ni crear un hueco.
  const destino = Math.max(0, Math.min(ajustado, copia.length));
  copia.splice(destino, 0, elemento!);
  return copia;
}

/**
 * ¿En qué posición cae el puntero?
 *
 * Se compara contra el CENTRO de cada fila, no contra su borde: con los bordes,
 * el elemento arrastrado salta de sitio en cuanto rozas el vecino y la lista
 * tiembla. Con el centro hay que pasar de largo la mitad, que es lo que la mano
 * espera.
 *
 * @param centros centro vertical de cada fila, en el mismo orden que la lista.
 */
export function indiceSoltar(y: number, centros: number[]): number {
  let indice = 0;
  for (const centro of centros) {
    if (y > centro) indice += 1;
    else break;
  }
  return indice;
}

/** ¿La lista quedó distinta? Si no, no hay nada que guardar ni que deshacer. */
export function hayCambio(antes: string[], despues: string[]): boolean {
  if (antes.length !== despues.length) return true;
  return antes.some((id, i) => id !== despues[i]);
}

/**
 * ¿Tiene sentido arrastrar en esta vista?
 *
 * Es la comprobación que evita el desastre silencioso: si la tabla está
 * ordenada por precio y arrastras la tercera fila a la primera, ¿qué posición
 * le escribes? Ninguna respuesta es correcta, porque lo que ves no es el orden
 * de la carta. Y con "Todas" las categorías mezcladas pasa lo mismo: la
 * posición de un plato es relativa a SU categoría, no a la mezcla.
 *
 * Devuelve el motivo por el que no se puede, o `null` si se puede.
 */
export function motivoNoArrastrable({
  ordenadoPorCarta,
  categoriaConcreta,
  hayFiltro,
  hayBusqueda,
}: {
  ordenadoPorCarta: boolean;
  categoriaConcreta: boolean;
  hayFiltro: boolean;
  hayBusqueda: boolean;
}): string | null {
  if (!ordenadoPorCarta) {
    return "Estás viendo otro orden. Vuelve a «Posición en la carta» para poder moverlos.";
  }
  if (!categoriaConcreta) {
    return "Elige una categoría: la posición de un plato es dentro de la suya, no entre todas.";
  }
  // Con un filtro o una búsqueda activos, la lista tiene huecos: entre la fila 1
  // y la 2 que ves puede haber tres platos escondidos. Mover ahí escribiría un
  // orden que nadie ha visto.
  if (hayFiltro || hayBusqueda) {
    return "Quita el filtro y la búsqueda: con la lista incompleta, mover uno recolocaría los que no ves.";
  }
  return null;
}

/**
 * Posiciones a guardar a partir del orden final.
 *
 * Se envía la lista ENTERA y el servidor asigna 0,1,2… No se envía "este va al
 * puesto 4": dos administradores moviendo a la vez con posiciones relativas
 * dejan la carta con dos platos en el mismo puesto y un hueco.
 */
export function posicionesDesdeOrden(ids: string[]): { id: string; sortOrder: number }[] {
  return ids.map((id, indice) => ({ id, sortOrder: indice }));
}
