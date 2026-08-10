/**
 * Lógica de la pantalla de carta: normalizar, filtrar, contar y seleccionar.
 *
 * Está separada de los componentes porque es donde se equivoca uno: el conteo
 * de un filtro, el estado indeterminado de la casilla de cabecera, o el orden
 * en que se aplican categoría, búsqueda y filtro. Aquí se puede probar sin
 * montar la pantalla entera.
 */

import {
  requiredMinimum,
  maximumAllowed,
  type ModifierGroup,
} from "@/lib/menu-options";

/**
 * Un producto ya normalizado.
 *
 * La API devuelve las filas crudas en snake_case pero los payloads de escritura
 * son camelCase, así que hasta ahora cada componente leía `item.isAvailable ??
 * item.is_available` por su cuenta. Bastaba olvidarlo una vez para que un plato
 * agotado se pintara disponible. Se normaliza UNA vez, al entrar.
 */
export interface Producto {
  id: string;
  name: string;
  description: string;
  categoryId: string;
  /** En céntimos, siempre. */
  price: number;
  imageUrl: string | null;
  /** Minutos de preparación, o nulo si nadie lo declaró. */
  prepMin: number | null;
  isAvailable: boolean;
  /** Cuántos grupos de modificadores tiene vinculados. */
  modifierGroups: number;
  allergens: string[];
  dietaryTags: string[];
  spiceLevel: number | null;
  sortOrder: number;
  /**
   * Anclado arriba de la carta del PUNTO DE VENTA (migración 0021).
   *
   * No tiene nada que ver con la carta del comensal: es un atajo para quien
   * cobra, con los seis platos que se cantan cada noche.
   */
  isFeatured: boolean;
}

/** Número o nulo. Descarta `""`, `NaN` y `undefined` sin convertirlos en cero. */
function numeroONulo(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function listaDeTextos(valor: unknown): string[] {
  return Array.isArray(valor) ? valor.filter((v): v is string => typeof v === "string") : [];
}

export function normalizarProducto(crudo: any): Producto {
  return {
    id: crudo.id,
    name: crudo.name ?? "",
    description: crudo.description ?? "",
    categoryId: crudo.category_id ?? crudo.categoryId ?? "",
    price: Number(crudo.price ?? 0),
    imageUrl: crudo.image_url ?? crudo.imageUrl ?? null,
    prepMin: numeroONulo(crudo.preparation_time_min ?? crudo.preparationTimeMin),
    // El `??` importa: `is_available: false` no puede caer al valor por defecto.
    isAvailable: crudo.is_available ?? crudo.isAvailable ?? true,
    modifierGroups: Number(crudo.modifier_group_count ?? crudo.modifierGroupCount ?? 0),
    allergens: listaDeTextos(crudo.allergens),
    dietaryTags: listaDeTextos(crudo.dietary_tags ?? crudo.dietaryTags),
    spiceLevel: numeroONulo(crudo.spice_level ?? crudo.spiceLevel),
    sortOrder: Number(crudo.sort_order ?? crudo.sortOrder ?? 0),
    isFeatured: crudo.is_featured ?? crudo.isFeatured ?? false,
  };
}

// ---------------------------------------------------------------------------
// Filtros rápidos
// ---------------------------------------------------------------------------

export type ClaveFiltro =
  | "todos"
  | "disponibles"
  | "agotados"
  | "sin-foto"
  | "sin-prep"
  | "sin-modificadores";

export interface DefinicionFiltro {
  clave: ClaveFiltro;
  label: string;
  /** Color del punto, cuando el filtro representa un estado y no una carencia. */
  punto?: "verde" | "ambar";
}

/**
 * Los cuatro últimos no son caprichos de diseño: son las carencias que hacen
 * que un plato se venda peor. Un plato sin foto se pide menos, uno sin tiempo
 * de preparación descuadra la cocina, y uno sin modificadores no deja subir el
 * ticket. Sin este filtro hay que ir mirándolos de uno en uno.
 */
export const FILTROS: readonly DefinicionFiltro[] = [
  { clave: "todos", label: "Todos" },
  { clave: "disponibles", label: "Disponibles", punto: "verde" },
  { clave: "agotados", label: "Agotados", punto: "ambar" },
  { clave: "sin-foto", label: "Sin foto" },
  { clave: "sin-prep", label: "Sin tiempo de prep" },
  { clave: "sin-modificadores", label: "Sin modificadores" },
];

export function cumpleFiltro(p: Producto, clave: ClaveFiltro): boolean {
  switch (clave) {
    case "todos":
      return true;
    case "disponibles":
      return p.isAvailable;
    case "agotados":
      return !p.isAvailable;
    case "sin-foto":
      return !p.imageUrl;
    case "sin-prep":
      return p.prepMin === null;
    case "sin-modificadores":
      return p.modifierGroups === 0;
  }
}

/**
 * Cuenta cada filtro sobre el conjunto que se le pase.
 *
 * Se cuenta sobre la SEDE entera, no sobre lo visible: si contara lo visible,
 * al pinchar "Agotados" los demás recuentos se irían a cero y el usuario ya no
 * podría saber cuántos hay de lo otro.
 */
export function contarFiltros(items: Producto[]): Record<ClaveFiltro, number> {
  const conteo = {
    todos: 0,
    disponibles: 0,
    agotados: 0,
    "sin-foto": 0,
    "sin-prep": 0,
    "sin-modificadores": 0,
  } as Record<ClaveFiltro, number>;

  for (const p of items) {
    for (const { clave } of FILTROS) {
      if (cumpleFiltro(p, clave)) conteo[clave] += 1;
    }
  }
  return conteo;
}

export interface CriteriosFiltro {
  items: Producto[];
  /** `"all"` no filtra por categoría. */
  categoryId: string;
  search: string;
  filtro: ClaveFiltro;
}

/**
 * La búsqueda NO escapa de la categoría seleccionada: si estás en "Postres" y
 * buscas "ceviche", no aparece. Es deliberado y coincide con el rótulo de la
 * cabecera; escapar sería más útil solo si el rótulo lo dijera.
 */
export function filtrarProductos({
  items,
  categoryId,
  search,
  filtro,
}: CriteriosFiltro): Producto[] {
  const q = search.trim().toLowerCase();

  return items.filter((p) => {
    if (categoryId !== "all" && p.categoryId !== categoryId) return false;
    if (!cumpleFiltro(p, filtro)) return false;
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
    );
  });
}

// ---------------------------------------------------------------------------
// Orden de la vista
// ---------------------------------------------------------------------------

export type ClaveOrden = "carta" | "nombre" | "precio-desc" | "precio-asc" | "prep-desc";

export const ORDENES: readonly { clave: ClaveOrden; label: string }[] = [
  { clave: "carta", label: "Posición en la carta" },
  { clave: "nombre", label: "Nombre (A-Z)" },
  { clave: "precio-desc", label: "Precio: mayor primero" },
  { clave: "precio-asc", label: "Precio: menor primero" },
  { clave: "prep-desc", label: "Tarda más en salir" },
];

/**
 * Ordena la VISTA, no la carta.
 *
 * Es una distinción que hay que sostener: `sort_order` decide en qué orden ve
 * los platos el comensal y no se toca aquí. Esto es para trabajar —"enséñame
 * los caros primero", "cuáles tardan más"— y vuelve a "Posición en la carta"
 * en cuanto se recarga.
 *
 * Los platos sin tiempo de preparación quedan al final al ordenar por tiempo:
 * tratar el nulo como cero los pondría entre los más rápidos, que es justo lo
 * contrario de lo que se sabe de ellos (no se sabe nada).
 */
export function ordenarProductos(items: Producto[], criterio: ClaveOrden): Producto[] {
  const copia = [...items];
  const porNombre = (a: Producto, b: Producto) => a.name.localeCompare(b.name, "es");

  switch (criterio) {
    case "carta":
      return copia.sort((a, b) => a.sortOrder - b.sortOrder || porNombre(a, b));
    case "nombre":
      return copia.sort(porNombre);
    case "precio-desc":
      return copia.sort((a, b) => b.price - a.price || porNombre(a, b));
    case "precio-asc":
      return copia.sort((a, b) => a.price - b.price || porNombre(a, b));
    case "prep-desc":
      return copia.sort((a, b) => {
        if (a.prepMin === null && b.prepMin === null) return porNombre(a, b);
        if (a.prepMin === null) return 1;
        if (b.prepMin === null) return -1;
        return b.prepMin - a.prepMin || porNombre(a, b);
      });
  }
}

// ---------------------------------------------------------------------------
// Selección múltiple
// ---------------------------------------------------------------------------

export function alternarSeleccion(seleccion: string[], id: string): string[] {
  return seleccion.includes(id)
    ? seleccion.filter((x) => x !== id)
    : [...seleccion, id];
}

export type EstadoCabecera = "vacio" | "parcial" | "todo";

/**
 * Estado de la casilla de la cabecera respecto de lo VISIBLE.
 *
 * Sin lista visible el estado es "vacío", no "todo": marcar la cabecera de una
 * tabla sin filas no puede leerse como "todo seleccionado".
 */
export function estadoCabecera(
  visibles: string[],
  seleccion: string[],
): EstadoCabecera {
  if (visibles.length === 0) return "vacio";
  const elegidos = visibles.filter((id) => seleccion.includes(id)).length;
  if (elegidos === 0) return "vacio";
  return elegidos === visibles.length ? "todo" : "parcial";
}

/**
 * Alternar la cabecera. Con selección parcial, completa en vez de vaciar: quien
 * ya eligió tres de nueve y pulsa la cabecera quiere los nueve.
 *
 * Solo toca lo visible. Un producto seleccionado que se salió del filtro sigue
 * seleccionado y sigue contando: por eso el panel dice cuántos hay en total.
 */
export function alternarTodosVisibles(
  visibles: string[],
  seleccion: string[],
): string[] {
  const estado = estadoCabecera(visibles, seleccion);
  if (estado === "todo") {
    return seleccion.filter((id) => !visibles.includes(id));
  }
  const set = new Set(seleccion);
  for (const id of visibles) set.add(id);
  return [...set];
}

/** "Ceviche clásico · Ceviche mixto · Arroz con mariscos" — y "y 4 más". */
export function describirSeleccion(nombres: string[], tope = 3): string {
  if (nombres.length === 0) return "";
  if (nombres.length <= tope) return nombres.join(" · ");
  const resto = nombres.length - tope;
  return `${nombres.slice(0, tope).join(" · ")} y ${resto} más`;
}

// ---------------------------------------------------------------------------
// Grupos de modificadores
// ---------------------------------------------------------------------------

/**
 * La regla del grupo en una frase: "Elige 1", "Elige 2 o más", "Hasta 3"…
 *
 * Traduce min/max/obligatorio, que es exactamente lo que nadie recuerda al
 * mirar tres números en una ficha. Usa la misma fórmula que valida el servidor
 * (`requiredMinimum`), no una aproximación.
 */
export function describirRegla(grupo: ModifierGroup): string {
  const min = requiredMinimum(grupo);
  const max = maximumAllowed(grupo);

  if (min === 0) {
    if (max === null) return "Las que quiera";
    return max === 1 ? "Como mucho 1" : `Hasta ${max}`;
  }
  if (max === null) return min === 1 ? "Al menos 1" : `Al menos ${min}`;
  if (min === max) return `Elige ${min}`;
  return `Entre ${min} y ${max}`;
}

/** ¿El grupo obliga a elegir? Es lo que separa "Obligatorio" de "Opcional". */
export function esObligatorio(grupo: ModifierGroup): boolean {
  return requiredMinimum(grupo) > 0;
}

export type ClaveFiltroGrupo = "todos" | "obligatorios" | "opcionales" | "sin-usar";

export interface GrupoConUso extends ModifierGroup {
  /** Cuántos productos lo tienen vinculado. Lo calcula la API. */
  used_in_items?: number;
}

export function cumpleFiltroGrupo(g: GrupoConUso, clave: ClaveFiltroGrupo): boolean {
  switch (clave) {
    case "todos":
      return true;
    case "obligatorios":
      return esObligatorio(g);
    case "opcionales":
      return !esObligatorio(g);
    case "sin-usar":
      return (g.used_in_items ?? 0) === 0;
  }
}

export function contarFiltrosGrupo(
  grupos: GrupoConUso[],
): Record<ClaveFiltroGrupo, number> {
  const claves: ClaveFiltroGrupo[] = ["todos", "obligatorios", "opcionales", "sin-usar"];
  const conteo = { todos: 0, obligatorios: 0, opcionales: 0, "sin-usar": 0 };
  for (const g of grupos) {
    for (const clave of claves) {
      if (cumpleFiltroGrupo(g, clave)) conteo[clave] += 1;
    }
  }
  return conteo;
}

/**
 * Filtra grupos por texto: busca en el nombre del grupo Y en el de sus opciones.
 *
 * Buscar "palta" tiene que encontrar el grupo "Extras", que es donde vive. Si
 * solo mirara el nombre del grupo, el buscador sería inútil justo para lo que
 * uno recuerda: la opción, no el cajón donde está.
 */
export function filtrarGrupos(
  grupos: GrupoConUso[],
  search: string,
  filtro: ClaveFiltroGrupo,
): GrupoConUso[] {
  const q = search.trim().toLowerCase();
  return grupos.filter((g) => {
    if (!cumpleFiltroGrupo(g, filtro)) return false;
    if (!q) return true;
    if (g.name.toLowerCase().includes(q)) return true;
    return (g.modifiers ?? []).some((m) => m.name.toLowerCase().includes(q));
  });
}
