/**
 * La carta, tal y como la mira quien cobra.
 *
 * La rejilla del punto de venta era la misma que ve el comensal: tarjetas con
 * foto grande, cuatro por fila como mucho, ocho platos en pantalla. Pero el
 * cajero no está eligiendo qué le apetece —ya sabe lo que es un lomo saltado—,
 * está buscando un nombre concreto lo más rápido posible. Con fichas de texto
 * caben dieciséis en el mismo hueco, y el plato que se canta cincuenta veces por
 * noche deja de estar a dos scrolls de distancia.
 *
 * Aquí vive la parte que se puede razonar sin pintar nada: qué platos entran,
 * en qué sección, y en qué orden.
 */

export interface PlatoDeCarta {
  id: string;
  name: string;
  price: number;
  image_url: string | null;
  is_available: boolean;
  category_id?: string;
  sort_order?: number;
  /** Cuántos grupos de opciones cuelgan del plato. 0 = se añade de un toque. */
  modifier_group_count?: number;
  /** Anclado arriba de la carta de la caja. No afecta a la del comensal. */
  is_featured?: boolean;
}

export interface CategoriaDeCarta {
  id: string;
  name: string;
  /**
   * Si es `false`, el dueño la sacó de la carta y el comensal NO la ve por QR
   * (`customer.ts` filtra por `is_active`). El punto de venta sí la deja vender
   * —a veces hay motivo: personal, temporada a medio montar— pero la marca, para
   * que nadie la cante creyendo que está publicada.
   */
  is_active?: boolean;
}

export interface SeccionDeCarta {
  id: string;
  titulo: string;
  /** "9 platos", "2 coinciden". Lo que va a la derecha de la cabecera. */
  nota: string;
  /** La categoría no está publicada en la carta del comensal. */
  oculta: boolean;
  /** Es la sección anclada de destacados, no una categoría de la carta. */
  anclada?: boolean;
  platos: PlatoDeCarta[];
}

/**
 * Normaliza para buscar: sin tildes, sin mayúsculas.
 *
 * Se usa la propiedad Unicode `\p{Diacritic}` y no un rango de caracteres
 * literales: ese rango son marcas combinantes INVISIBLES en el editor, y
 * cualquier herramienta que reescriba el archivo con otra codificación las
 * destroza sin que nadie lo note hasta que "aji" deja de encontrar "Ají de
 * gallina". Así el fuente es ASCII y se puede leer.
 */
export function normalizar(texto: string): string {
  return texto
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

/**
 * ¿Este plato coincide con lo que se está buscando?
 *
 * Sin tildes a propósito: nadie teclea "ají" con tilde en una tablet a las nueve
 * de la noche, y "aji" no encontraba "Ají de gallina".
 */
export function coincide(plato: PlatoDeCarta, termino: string): boolean {
  if (!termino) return true;
  return normalizar(plato.name).includes(normalizar(termino));
}

/**
 * Cuántos platos disponibles tiene cada categoría.
 *
 * Se cuenta sobre la carta ENTERA, no sobre lo que se está viendo: el carril
 * lateral tiene que decir cuántos platos hay en Postres aunque ahora mismo estés
 * mirando Bebidas. Los agotados no cuentan, porque no se pueden vender.
 */
export function contarPorCategoria(platos: PlatoDeCarta[]): Map<string, number> {
  const cuenta = new Map<string, number>();
  for (const plato of platos) {
    if (!plato.is_available) continue;
    const clave = plato.category_id ?? "";
    cuenta.set(clave, (cuenta.get(clave) ?? 0) + 1);
  }
  return cuenta;
}

/**
 * Reparte los platos en secciones con cabecera.
 *
 * Una rejilla plana de sesenta platos obliga a leerlos todos para saber dónde
 * acaban las entradas: la cabecera hace de mojón y el ojo salta directo. El
 * orden es el de la carta —la posición de la categoría manda sobre la del plato,
 * porque `sort_order` es relativo a SU categoría y mezclarlos colaría los
 * postres entre los fondos.
 *
 * Con búsqueda activa las secciones se mantienen: saber que "criollo" aparece en
 * Fondos y en Bebidas es parte de la respuesta.
 *
 * Delante de todas va la sección ANCLADA con los platos destacados —ver
 * `seccionAnclada` para cuándo aparece y por qué se permite que un plato salga
 * dos veces.
 */
export function componerSecciones({
  platos,
  categorias,
  categoriaElegida,
  busqueda,
}: {
  platos: PlatoDeCarta[];
  categorias: CategoriaDeCarta[];
  /** `null` = la carta entera. */
  categoriaElegida: string | null;
  busqueda: string;
}): SeccionDeCarta[] {
  const termino = busqueda.trim();
  const visibles = platos.filter(
    (p) => p.is_available && coincide(p, termino) &&
      (categoriaElegida === null || p.category_id === categoriaElegida),
  );

  const porCategoria = new Map<string, PlatoDeCarta[]>();
  for (const plato of visibles) {
    const clave = plato.category_id ?? "";
    porCategoria.set(clave, [...(porCategoria.get(clave) ?? []), plato]);
  }

  const orden = [...categorias.map((c) => c.id), ""];
  const nombres = new Map(categorias.map((c) => [c.id, c.name]));
  const ocultas = new Set(categorias.filter((c) => c.is_active === false).map((c) => c.id));

  const secciones: SeccionDeCarta[] = [];
  for (const id of orden) {
    const suyos = porCategoria.get(id);
    if (!suyos || suyos.length === 0) continue;

    suyos.sort((a, b) => {
      const posicion = (a.sort_order ?? 0) - (b.sort_order ?? 0);
      return posicion !== 0 ? posicion : a.name.localeCompare(b.name, "es");
    });

    secciones.push({
      id: id || "sin-categoria",
      titulo: nombres.get(id) ?? "Sin categoría",
      oculta: ocultas.has(id),
      nota: termino
        ? `${suyos.length} ${suyos.length === 1 ? "coincide" : "coinciden"}`
        : `${suyos.length} ${suyos.length === 1 ? "plato" : "platos"}`,
      platos: suyos,
    });
  }

  const anclada = seccionAnclada({ platos, categoriaElegida, busqueda: termino });
  return anclada ? [anclada, ...secciones] : secciones;
}

/**
 * Los platos anclados arriba de la carta.
 *
 * Solo aparece en la vista completa: sin búsqueda y sin categoría elegida. Si
 * el cajero acaba de pulsar "Bebidas" quiere bebidas, y repetirle arriba dos que
 * ya están abajo es ruido; si está buscando, la sección anclada compite con lo
 * que busca. En la vista completa, en cambio, es exactamente el atajo que
 * justifica su existencia.
 *
 * SÍ, el plato anclado sale TAMBÉN dentro de su categoría, y eso es deliberado.
 * La fila de arriba es un atajo; las categorías siguen siendo el índice completo,
 * y quien busca el lomo en "Fondos" tiene que encontrarlo ahí. La duplicación
 * solo estorba cuando la fila de arriba se mueve —entonces hay que releerla cada
 * vez— y estos no se mueven: los fija una persona. El contador de unidades en el
 * carrito se calcula por `menuItemId`, así que las dos apariciones enseñan la
 * misma cifra; no hay nada que reconciliar.
 */
export function seccionAnclada({
  platos,
  categoriaElegida,
  busqueda,
}: {
  platos: PlatoDeCarta[];
  categoriaElegida: string | null;
  busqueda: string;
}): SeccionDeCarta | null {
  if (categoriaElegida !== null || busqueda.trim()) return null;

  const anclados = platos
    .filter((p) => p.is_featured && p.is_available)
    .sort((a, b) => {
      const posicion = (a.sort_order ?? 0) - (b.sort_order ?? 0);
      return posicion !== 0 ? posicion : a.name.localeCompare(b.name, "es");
    });

  if (anclados.length === 0) return null;

  return {
    id: "anclados",
    titulo: "Los de siempre",
    nota: `${anclados.length} ${anclados.length === 1 ? "plato" : "platos"}`,
    oculta: false,
    anclada: true,
    platos: anclados,
  };
}

/** Cuántas unidades de este plato hay ya en el carrito, sumando sus líneas. */
export function unidadesEnCarrito(
  lineas: { menuItemId: string; quantity: number }[],
): Map<string, number> {
  const cuenta = new Map<string, number>();
  for (const linea of lineas) {
    cuenta.set(linea.menuItemId, (cuenta.get(linea.menuItemId) ?? 0) + linea.quantity);
  }
  return cuenta;
}
