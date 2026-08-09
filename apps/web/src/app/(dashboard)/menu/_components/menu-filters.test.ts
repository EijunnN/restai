import { describe, expect, test } from "bun:test";
import {
  FILTROS,
  alternarSeleccion,
  alternarTodosVisibles,
  contarFiltros,
  contarFiltrosGrupo,
  cumpleFiltro,
  describirRegla,
  describirSeleccion,
  esObligatorio,
  estadoCabecera,
  filtrarGrupos,
  filtrarProductos,
  normalizarProducto,
  ordenarProductos,
  type Producto,
} from "./menu-filters";

/**
 * Si esto se equivoca, el administrador agota el plato que no era, o cree que
 * ha seleccionado tres cuando ha seleccionado nueve. La forma de los datos es
 * la que devuelve `GET /api/menu/items`: filas crudas en snake_case.
 */

const CEVICHES = "11111111-1111-1111-1111-111111111111";
const FONDOS = "22222222-2222-2222-2222-222222222222";

function producto(sobre: Partial<Producto> = {}): Producto {
  return {
    id: "p1",
    name: "Plato",
    description: "",
    categoryId: CEVICHES,
    price: 1000,
    imageUrl: "https://x/f.jpg",
    prepMin: 10,
    isAvailable: true,
    modifierGroups: 1,
    allergens: [],
    dietaryTags: [],
    spiceLevel: null,
    sortOrder: 0,
    ...sobre,
  };
}

describe("normalizarProducto", () => {
  test("lee la fila cruda de la API en snake_case", () => {
    const p = normalizarProducto({
      id: "abc",
      name: "Ceviche clásico",
      description: "Pescado del día",
      category_id: CEVICHES,
      price: 4200,
      image_url: "https://cdn/ceviche.jpg",
      preparation_time_min: 12,
      is_available: true,
      modifier_group_count: 2,
      allergens: ["fish"],
      dietary_tags: ["gluten_free"],
      spice_level: 1,
      sort_order: 3,
    });

    expect(p.categoryId).toBe(CEVICHES);
    expect(p.imageUrl).toBe("https://cdn/ceviche.jpg");
    expect(p.prepMin).toBe(12);
    expect(p.modifierGroups).toBe(2);
    expect(p.allergens).toEqual(["fish"]);
    expect(p.spiceLevel).toBe(1);
  });

  test("también lee el camelCase que devuelven las escrituras", () => {
    const p = normalizarProducto({
      id: "abc",
      name: "Lomo",
      categoryId: FONDOS,
      imageUrl: "https://cdn/lomo.jpg",
      preparationTimeMin: 18,
      isAvailable: false,
    });

    expect(p.categoryId).toBe(FONDOS);
    expect(p.imageUrl).toBe("https://cdn/lomo.jpg");
    expect(p.prepMin).toBe(18);
    expect(p.isAvailable).toBe(false);
  });

  test("un plato agotado NO se cae al valor por defecto", () => {
    // El fallo clásico de `||`: `false` es falsy y el plato agotado se pintaba
    // disponible. Un comensal pidiendo lo que no hay.
    expect(normalizarProducto({ id: "x", is_available: false }).isAvailable).toBe(false);
    expect(normalizarProducto({ id: "x" }).isAvailable).toBe(true);
  });

  test("sin tiempo de preparación es nulo, no cero", () => {
    // Cero minutos es una promesa ("sale al instante"); nulo es "nadie lo dijo".
    expect(normalizarProducto({ id: "x" }).prepMin).toBeNull();
    expect(normalizarProducto({ id: "x", preparation_time_min: null }).prepMin).toBeNull();
    expect(normalizarProducto({ id: "x", preparation_time_min: 0 }).prepMin).toBe(0);
  });

  test("un plato de 0 minutos no cuenta como «sin tiempo»", () => {
    expect(cumpleFiltro(producto({ prepMin: 0 }), "sin-prep")).toBe(false);
    expect(cumpleFiltro(producto({ prepMin: null }), "sin-prep")).toBe(true);
  });

  test("las listas ausentes quedan vacías, nunca indefinidas", () => {
    const p = normalizarProducto({ id: "x" });
    expect(p.allergens).toEqual([]);
    expect(p.dietaryTags).toEqual([]);
  });
});

describe("filtros rápidos", () => {
  const items = [
    producto({ id: "a", name: "Ceviche", isAvailable: true }),
    producto({ id: "b", name: "Tiradito", isAvailable: false }),
    producto({ id: "c", name: "Causa", imageUrl: null }),
    producto({ id: "d", name: "Chicharrón", prepMin: null }),
    producto({ id: "e", name: "Suspiro", modifierGroups: 0 }),
  ];

  test("cada filtro atrapa lo suyo", () => {
    expect(filtrarProductos({ items, categoryId: "all", search: "", filtro: "agotados" }).map((p) => p.id)).toEqual(["b"]);
    expect(filtrarProductos({ items, categoryId: "all", search: "", filtro: "sin-foto" }).map((p) => p.id)).toEqual(["c"]);
    expect(filtrarProductos({ items, categoryId: "all", search: "", filtro: "sin-prep" }).map((p) => p.id)).toEqual(["d"]);
    expect(filtrarProductos({ items, categoryId: "all", search: "", filtro: "sin-modificadores" }).map((p) => p.id)).toEqual(["e"]);
  });

  test("los recuentos se cruzan: un plato puede caer en varios", () => {
    const conteo = contarFiltros([
      producto({ id: "a", isAvailable: false, imageUrl: null, prepMin: null, modifierGroups: 0 }),
    ]);
    expect(conteo.todos).toBe(1);
    expect(conteo.agotados).toBe(1);
    expect(conteo["sin-foto"]).toBe(1);
    expect(conteo["sin-prep"]).toBe(1);
    expect(conteo["sin-modificadores"]).toBe(1);
    expect(conteo.disponibles).toBe(0);
  });

  test("hay un recuento por cada filtro declarado", () => {
    // Añadir un filtro a FILTROS sin contarlo dejaría un chip con «0» eterno.
    const conteo = contarFiltros(items);
    for (const f of FILTROS) expect(conteo[f.clave]).toBeGreaterThanOrEqual(0);
    expect(Object.keys(conteo)).toHaveLength(FILTROS.length);
  });

  test("categoría, filtro y búsqueda se aplican los tres a la vez", () => {
    const mezcla = [
      producto({ id: "a", name: "Ceviche mixto", categoryId: CEVICHES, isAvailable: false }),
      producto({ id: "b", name: "Ceviche clásico", categoryId: CEVICHES, isAvailable: true }),
      producto({ id: "c", name: "Ceviche de fondo", categoryId: FONDOS, isAvailable: false }),
    ];
    const r = filtrarProductos({
      items: mezcla,
      categoryId: CEVICHES,
      search: "ceviche",
      filtro: "agotados",
    });
    expect(r.map((p) => p.id)).toEqual(["a"]);
  });

  test("la búsqueda mira también la descripción", () => {
    const items2 = [producto({ id: "a", name: "Causa", description: "Papa amarilla y palta" })];
    expect(filtrarProductos({ items: items2, categoryId: "all", search: "palta", filtro: "todos" })).toHaveLength(1);
  });

  test("la búsqueda no distingue mayúsculas ni espacios sueltos", () => {
    const items2 = [producto({ id: "a", name: "Ají de gallina" })];
    expect(filtrarProductos({ items: items2, categoryId: "all", search: "  AJÍ  ", filtro: "todos" })).toHaveLength(1);
  });
});

describe("orden de la vista", () => {
  const items = [
    producto({ id: "a", name: "Zapallo", price: 1000, prepMin: 5, sortOrder: 2 }),
    producto({ id: "b", name: "Anticucho", price: 3000, prepMin: null, sortOrder: 1 }),
    producto({ id: "c", name: "Ceviche", price: 2000, prepMin: 20, sortOrder: 3 }),
  ];

  test("por defecto manda la posición en la carta", () => {
    expect(ordenarProductos(items, "carta").map((p) => p.id)).toEqual(["b", "a", "c"]);
  });

  test("por precio, de mayor a menor y al revés", () => {
    expect(ordenarProductos(items, "precio-desc").map((p) => p.id)).toEqual(["b", "c", "a"]);
    expect(ordenarProductos(items, "precio-asc").map((p) => p.id)).toEqual(["a", "c", "b"]);
  });

  test("los que no declaran tiempo van al final, no al principio", () => {
    // Tratar el nulo como cero los colocaría entre los más rápidos, que es lo
    // contrario de lo único que se sabe de ellos: que no se sabe.
    expect(ordenarProductos(items, "prep-desc").map((p) => p.id)).toEqual(["c", "a", "b"]);
  });

  test("el nombre desempata, así que el orden es estable", () => {
    const empate = [
      producto({ id: "x", name: "Bebida", price: 500, sortOrder: 0 }),
      producto({ id: "y", name: "Agua", price: 500, sortOrder: 0 }),
    ];
    expect(ordenarProductos(empate, "carta").map((p) => p.id)).toEqual(["y", "x"]);
    expect(ordenarProductos(empate, "precio-desc").map((p) => p.id)).toEqual(["y", "x"]);
  });

  test("no muta la lista que recibe", () => {
    const original = items.map((p) => p.id);
    ordenarProductos(items, "nombre");
    expect(items.map((p) => p.id)).toEqual(original);
  });

  test("ordena con criterio español: la ñ va después de la n", () => {
    const acentos = [
      producto({ id: "1", name: "Ñoquis" }),
      producto({ id: "2", name: "Naranja" }),
      producto({ id: "3", name: "Ají" }),
    ];
    expect(ordenarProductos(acentos, "nombre").map((p) => p.name)).toEqual([
      "Ají",
      "Naranja",
      "Ñoquis",
    ]);
  });
});

describe("selección múltiple", () => {
  test("alternar añade y quita", () => {
    expect(alternarSeleccion([], "a")).toEqual(["a"]);
    expect(alternarSeleccion(["a", "b"], "a")).toEqual(["b"]);
  });

  test("la cabecera distingue vacío, parcial y todo", () => {
    expect(estadoCabecera(["a", "b"], [])).toBe("vacio");
    expect(estadoCabecera(["a", "b"], ["a"])).toBe("parcial");
    expect(estadoCabecera(["a", "b"], ["a", "b"])).toBe("todo");
  });

  test("sin filas visibles la cabecera está vacía, no completa", () => {
    expect(estadoCabecera([], [])).toBe("vacio");
    expect(estadoCabecera([], ["a"])).toBe("vacio");
  });

  test("con selección parcial, la cabecera completa en vez de vaciar", () => {
    expect(alternarTodosVisibles(["a", "b", "c"], ["a"])).toEqual(["a", "b", "c"]);
  });

  test("con todo seleccionado, la cabecera vacía", () => {
    expect(alternarTodosVisibles(["a", "b"], ["a", "b"])).toEqual([]);
  });

  test("la cabecera solo toca lo visible", () => {
    // «z» está seleccionado pero se salió del filtro: no puede desaparecer sin
    // que el usuario lo haya tocado, o borraría a ciegas parte de su selección.
    expect(alternarTodosVisibles(["a"], ["a", "z"])).toEqual(["z"]);
    expect(alternarTodosVisibles(["a"], ["z"]).sort()).toEqual(["a", "z"]);
  });

  test("describirSeleccion enumera hasta tres y luego resume", () => {
    expect(describirSeleccion([])).toBe("");
    expect(describirSeleccion(["Ceviche", "Tiradito"])).toBe("Ceviche · Tiradito");
    expect(describirSeleccion(["A", "B", "C", "D", "E"])).toBe("A · B · C y 2 más");
  });
});

describe("reglas de los grupos de modificadores", () => {
  const grupo = (sobre: any) => ({ id: "g", name: "G", modifiers: [], ...sobre });

  test("obligatorio de una sola opción es «Elige 1»", () => {
    expect(describirRegla(grupo({ is_required: true, min_selections: 1, max_selections: 1 }))).toBe("Elige 1");
  });

  test("opcional con tope es «Hasta N»", () => {
    expect(describirRegla(grupo({ is_required: false, min_selections: 0, max_selections: 3 }))).toBe("Hasta 3");
  });

  test("sin tope se dice, no se finge un número", () => {
    // `max_selections: 0` significa «sin tope» en el servidor. Pintar «Hasta 0»
    // sería justo lo contrario de lo que hace.
    expect(describirRegla(grupo({ is_required: false, min_selections: 0, max_selections: 0 }))).toBe("Las que quiera");
    expect(describirRegla(grupo({ is_required: true, min_selections: 2, max_selections: 0 }))).toBe("Al menos 2");
  });

  test("un rango se dice como rango", () => {
    expect(describirRegla(grupo({ is_required: true, min_selections: 2, max_selections: 4 }))).toBe("Entre 2 y 4");
  });

  test("min>0 sin la marca de obligatorio TAMBIÉN obliga", () => {
    // Es el matiz que el servidor aplica y el cliente se saltaba: el grupo no
    // está marcado obligatorio pero exige una opción igualmente.
    const g = grupo({ is_required: false, min_selections: 1, max_selections: 1 });
    expect(esObligatorio(g)).toBe(true);
    expect(describirRegla(g)).toBe("Elige 1");
  });
});

describe("filtros de grupos", () => {
  const grupos = [
    { id: "a", name: "Término de la carne", is_required: true, min_selections: 1, max_selections: 1, modifiers: [{ id: "m1", name: "Jugoso", price: 0 }], used_in_items: 12 },
    { id: "b", name: "Extras", is_required: false, min_selections: 0, max_selections: 3, modifiers: [{ id: "m2", name: "Palta", price: 800 }], used_in_items: 22 },
    { id: "c", name: "Sin gluten", is_required: false, min_selections: 0, max_selections: 1, modifiers: [], used_in_items: 0 },
  ];

  test("separa obligatorios de opcionales", () => {
    expect(filtrarGrupos(grupos, "", "obligatorios").map((g) => g.id)).toEqual(["a"]);
    expect(filtrarGrupos(grupos, "", "opcionales").map((g) => g.id)).toEqual(["b", "c"]);
  });

  test("«sin usar» encuentra el grupo que no está vinculado a nada", () => {
    expect(filtrarGrupos(grupos, "", "sin-usar").map((g) => g.id)).toEqual(["c"]);
  });

  test("buscar una OPCIÓN encuentra su grupo", () => {
    // Uno recuerda «palta», no «Extras». Si solo mirara el nombre del grupo, el
    // buscador fallaría justo en el caso para el que se usa.
    expect(filtrarGrupos(grupos, "palta", "todos").map((g) => g.id)).toEqual(["b"]);
  });

  test("un grupo sin used_in_items cuenta como sin usar, no revienta", () => {
    const conteo = contarFiltrosGrupo([{ id: "z", name: "Z", modifiers: [] }]);
    expect(conteo["sin-usar"]).toBe(1);
    expect(conteo.todos).toBe(1);
  });
});
