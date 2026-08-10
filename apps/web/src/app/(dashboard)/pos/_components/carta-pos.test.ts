import { describe, expect, test } from "bun:test";
import {
  coincide,
  componerSecciones,
  contarPorCategoria,
  normalizar,
  unidadesEnCarrito,
  type CategoriaDeCarta,
  type PlatoDeCarta,
} from "./carta-pos";

/**
 * La carta como la mira quien cobra.
 *
 * Lo que se rompe aquí no se ve: un plato que no aparece en su sección se canta
 * como "no lo tenemos", y una búsqueda que no perdona una tilde hace teclear
 * tres veces con el cliente delante.
 */

const CATEGORIAS: CategoriaDeCarta[] = [
  { id: "ent", name: "Entradas" },
  { id: "fon", name: "Fondos" },
  { id: "beb", name: "Bebidas" },
];

function plato(sobre: Partial<PlatoDeCarta> & { id: string; name: string }): PlatoDeCarta {
  return {
    price: 1000,
    image_url: null,
    is_available: true,
    category_id: "fon",
    sort_order: 0,
    modifier_group_count: 0,
    ...sobre,
  };
}

describe("buscar", () => {
  test("perdona las tildes en los dos sentidos", () => {
    // Nadie teclea "ají" con tilde en una tablet a las nueve de la noche.
    const aji = plato({ id: "1", name: "Ají de gallina" });
    expect(coincide(aji, "aji")).toBe(true);
    expect(coincide(aji, "ají")).toBe(true);

    const pollo = plato({ id: "2", name: "Pollo a la brasa" });
    expect(coincide(pollo, "brása")).toBe(true);
  });

  test("perdona las mayúsculas", () => {
    expect(coincide(plato({ id: "1", name: "Lomo Saltado" }), "LOMO")).toBe(true);
  });

  test("busca por dentro del nombre, no solo por el principio", () => {
    // "saltado" tiene que encontrar "Tallarín saltado criollo".
    expect(coincide(plato({ id: "1", name: "Tallarín saltado criollo" }), "saltado")).toBe(true);
  });

  test("sin término, todo coincide", () => {
    expect(coincide(plato({ id: "1", name: "Lo que sea" }), "")).toBe(true);
  });

  test("normalizar no destroza la eñe hasta hacerla irreconocible", () => {
    // Se le quita la tilde para poder buscar "nino", pero la letra sigue ahí.
    expect(normalizar("Niño")).toBe("nino");
  });
});

describe("contar por categoría", () => {
  test("cuenta sobre la carta entera, no sobre lo que se está viendo", () => {
    const cuenta = contarPorCategoria([
      plato({ id: "1", name: "A", category_id: "ent" }),
      plato({ id: "2", name: "B", category_id: "fon" }),
      plato({ id: "3", name: "C", category_id: "fon" }),
    ]);
    expect(cuenta.get("ent")).toBe(1);
    expect(cuenta.get("fon")).toBe(2);
  });

  test("un plato agotado no se puede vender, así que no cuenta", () => {
    const cuenta = contarPorCategoria([
      plato({ id: "1", name: "A", category_id: "fon" }),
      plato({ id: "2", name: "B", category_id: "fon", is_available: false }),
    ]);
    expect(cuenta.get("fon")).toBe(1);
  });
});

describe("secciones", () => {
  const CARTA = [
    plato({ id: "b1", name: "Chicha morada", category_id: "beb", sort_order: 1 }),
    plato({ id: "b2", name: "Inca Kola", category_id: "beb", sort_order: 0 }),
    plato({ id: "e1", name: "Causa limeña", category_id: "ent", sort_order: 0 }),
    plato({ id: "f1", name: "Lomo saltado", category_id: "fon", sort_order: 0 }),
    plato({ id: "f2", name: "Ají de gallina", category_id: "fon", sort_order: 1 }),
  ];

  test("las secciones salen en el orden de la carta, no alfabético", () => {
    const secciones = componerSecciones({
      platos: CARTA,
      categorias: CATEGORIAS,
      categoriaElegida: null,
      busqueda: "",
    });
    expect(secciones.map((s) => s.titulo)).toEqual(["Entradas", "Fondos", "Bebidas"]);
  });

  test("dentro de la sección manda la posición del plato", () => {
    const secciones = componerSecciones({
      platos: CARTA,
      categorias: CATEGORIAS,
      categoriaElegida: null,
      busqueda: "",
    });
    const bebidas = secciones.find((s) => s.titulo === "Bebidas")!;
    expect(bebidas.platos.map((p) => p.name)).toEqual(["Inca Kola", "Chicha morada"]);
  });

  test("elegir una categoría deja solo esa sección", () => {
    const secciones = componerSecciones({
      platos: CARTA,
      categorias: CATEGORIAS,
      categoriaElegida: "fon",
      busqueda: "",
    });
    expect(secciones).toHaveLength(1);
    expect(secciones[0]!.titulo).toBe("Fondos");
    expect(secciones[0]!.nota).toBe("2 platos");
  });

  test("buscando se mantienen las secciones: saber dónde está el plato es parte de la respuesta", () => {
    const secciones = componerSecciones({
      platos: CARTA,
      categorias: CATEGORIAS,
      categoriaElegida: null,
      busqueda: "a",
    });
    // Las que no tienen ninguna coincidencia desaparecen, no se quedan vacías.
    for (const s of secciones) expect(s.platos.length).toBeGreaterThan(0);
    expect(secciones.every((s) => /coincide/.test(s.nota))).toBe(true);
  });

  test("la nota concuerda en singular", () => {
    const secciones = componerSecciones({
      platos: CARTA,
      categorias: CATEGORIAS,
      categoriaElegida: null,
      busqueda: "causa",
    });
    expect(secciones).toHaveLength(1);
    expect(secciones[0]!.nota).toBe("1 coincide");
  });

  test("los agotados no se pintan: no se pueden vender", () => {
    const secciones = componerSecciones({
      platos: [plato({ id: "x", name: "Ceviche", category_id: "fon", is_available: false })],
      categorias: CATEGORIAS,
      categoriaElegida: null,
      busqueda: "",
    });
    expect(secciones).toEqual([]);
  });

  test("un plato sin categoría no desaparece, cae al final", () => {
    // Es el plato que alguien creó con prisa. Que no se venda por no verse sería
    // peor que enseñarlo en un cajón de sastre.
    const secciones = componerSecciones({
      platos: [plato({ id: "x", name: "Suelto", category_id: undefined })],
      categorias: CATEGORIAS,
      categoriaElegida: null,
      busqueda: "",
    });
    expect(secciones).toHaveLength(1);
    expect(secciones[0]!.titulo).toBe("Sin categoría");
  });
});

describe("unidades en el carrito", () => {
  test("suma las líneas del mismo plato aunque tengan opciones distintas", () => {
    const cuenta = unidadesEnCarrito([
      { menuItemId: "a", quantity: 2 },
      { menuItemId: "a", quantity: 1 },
      { menuItemId: "b", quantity: 3 },
    ]);
    expect(cuenta.get("a")).toBe(3);
    expect(cuenta.get("b")).toBe(3);
  });
});

// ---------------------------------------------------------------------------

import { ordenarPorAntiguedad } from "./sent-lines";

describe("comandas ya enviadas", () => {
  test("se leen de la más antigua a la más reciente", () => {
    // El endpoint no promete orden. Si la primera no es la más antigua, la
    // cabecera anuncia "desde 23:46" en una mesa que pidió a las 19:26 y parece
    // recién sentada.
    const ordenadas = ordenarPorAntiguedad([
      { clave: "b", instante: 300 },
      { clave: "a", instante: 100 },
      { clave: "c", instante: 200 },
    ]);
    expect(ordenadas.map((c) => c.clave)).toEqual(["a", "c", "b"]);
  });

  test("una fecha ilegible cae al final y no se cuela como la más antigua", () => {
    const ordenadas = ordenarPorAntiguedad([
      { clave: "rota", instante: Number.POSITIVE_INFINITY },
      { clave: "buena", instante: 100 },
    ]);
    expect(ordenadas[0]!.clave).toBe("buena");
  });

  test("no altera la lista original", () => {
    const original = [{ clave: "b", instante: 2 }, { clave: "a", instante: 1 }];
    ordenarPorAntiguedad(original);
    expect(original.map((c) => c.clave)).toEqual(["b", "a"]);
  });
});
