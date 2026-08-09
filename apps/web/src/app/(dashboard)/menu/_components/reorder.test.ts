import { describe, expect, test } from "bun:test";
import {
  hayCambio,
  indiceSoltar,
  motivoNoArrastrable,
  moverElemento,
  posicionesDesdeOrden,
} from "./reorder";

/**
 * Si esto se equivoca, el administrador arrastra un plato y la carta que ve el
 * comensal queda en un orden que nadie eligió.
 */

describe("moverElemento", () => {
  const lista = ["a", "b", "c", "d"];

  test("hacia abajo", () => {
    expect(moverElemento(lista, 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  test("hacia arriba", () => {
    expect(moverElemento(lista, 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  test("al mismo sitio no cambia nada", () => {
    expect(moverElemento(lista, 2, 2)).toBe(lista);
  });

  test("soltar más allá del final lo deja el último, no rompe la lista", () => {
    expect(moverElemento(lista, 0, 99)).toEqual(["b", "c", "d", "a"]);
  });

  test("soltar por encima del principio lo deja el primero", () => {
    expect(moverElemento(lista, 2, -5)).toEqual(["c", "a", "b", "d"]);
  });

  test("un índice de origen imposible no altera la lista", () => {
    expect(moverElemento(lista, 9, 0)).toBe(lista);
    expect(moverElemento(lista, -1, 0)).toBe(lista);
  });

  test("no muta la lista original", () => {
    moverElemento(lista, 0, 3);
    expect(lista).toEqual(["a", "b", "c", "d"]);
  });

  test("no pierde ni duplica elementos, se mueva a donde se mueva", () => {
    const largo = ["a", "b", "c", "d", "e", "f"];
    for (let desde = 0; desde < largo.length; desde++) {
      for (let hasta = 0; hasta <= largo.length; hasta++) {
        const r = moverElemento(largo, desde, hasta);
        expect(r).toHaveLength(largo.length);
        expect(new Set(r).size).toBe(largo.length);
      }
    }
  });
});

describe("indiceSoltar", () => {
  // Cuatro filas de 56 px empezando en 100: centros en 128, 184, 240, 296.
  const centros = [128, 184, 240, 296];

  test("por encima de todo es la primera posición", () => {
    expect(indiceSoltar(105, centros)).toBe(0);
  });

  test("por debajo de todo es la última", () => {
    expect(indiceSoltar(400, centros)).toBe(4);
  });

  test("hace falta pasar el CENTRO, no rozar el borde", () => {
    // 127 aún no ha llegado al centro de la primera fila.
    expect(indiceSoltar(127, centros)).toBe(0);
    expect(indiceSoltar(129, centros)).toBe(1);
  });

  test("en una lista vacía siempre es la posición cero", () => {
    expect(indiceSoltar(500, [])).toBe(0);
  });
});

describe("hayCambio", () => {
  test("mismo orden, sin cambio", () => {
    expect(hayCambio(["a", "b"], ["a", "b"])).toBe(false);
  });

  test("orden distinto, hay cambio", () => {
    expect(hayCambio(["a", "b"], ["b", "a"])).toBe(true);
  });

  test("distinto tamaño, hay cambio", () => {
    expect(hayCambio(["a"], ["a", "b"])).toBe(true);
  });
});

describe("motivoNoArrastrable", () => {
  const puedo = {
    ordenadoPorCarta: true,
    categoriaConcreta: true,
    hayFiltro: false,
    hayBusqueda: false,
  };

  test("con todo en su sitio, se puede", () => {
    expect(motivoNoArrastrable(puedo)).toBeNull();
  });

  test("ordenado por precio no se puede: no es el orden de la carta", () => {
    expect(motivoNoArrastrable({ ...puedo, ordenadoPorCarta: false })).toContain(
      "Posición en la carta",
    );
  });

  test("con «Todas» no se puede: la posición es dentro de su categoría", () => {
    expect(motivoNoArrastrable({ ...puedo, categoriaConcreta: false })).toContain(
      "categoría",
    );
  });

  test("con la lista filtrada no se puede: recolocaría los que no ves", () => {
    expect(motivoNoArrastrable({ ...puedo, hayFiltro: true })).toContain("filtro");
    expect(motivoNoArrastrable({ ...puedo, hayBusqueda: true })).toContain("filtro");
  });

  test("el orden manda sobre lo demás en el mensaje", () => {
    // Si falla más de una condición, se nombra la que hay que arreglar primero.
    const m = motivoNoArrastrable({
      ordenadoPorCarta: false,
      categoriaConcreta: false,
      hayFiltro: true,
      hayBusqueda: true,
    });
    expect(m).toContain("Posición en la carta");
  });
});

describe("posicionesDesdeOrden", () => {
  test("asigna 0,1,2… a la lista entera", () => {
    expect(posicionesDesdeOrden(["x", "y", "z"])).toEqual([
      { id: "x", sortOrder: 0 },
      { id: "y", sortOrder: 1 },
      { id: "z", sortOrder: 2 },
    ]);
  });

  test("una lista vacía no produce escrituras", () => {
    expect(posicionesDesdeOrden([])).toEqual([]);
  });
});
