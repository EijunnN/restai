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

  test("hacia abajo aterriza donde se soltó, sin pasarse", () => {
    // `hasta` se mide sobre la lista ORIGINAL: 2 = "entre b y c". Al sacar `a`
    // todo sube un puesto, y sin corregirlo acababa en ["b","c","a","d"] — una
    // posición más abajo de donde el dedo lo dejó.
    expect(moverElemento(lista, 0, 2)).toEqual(["b", "a", "c", "d"]);
  });

  test("hacia abajo dos puestos", () => {
    expect(moverElemento(lista, 0, 3)).toEqual(["b", "c", "a", "d"]);
  });

  test("hacia arriba", () => {
    expect(moverElemento(lista, 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  test("al mismo sitio no cambia nada", () => {
    expect(moverElemento(lista, 2, 2)).toBe(lista);
  });

  test("soltar justo debajo de sí mismo tampoco cambia nada", () => {
    // El índice de inserción inmediatamente posterior es el propio sitio: sin
    // esto, un temblor de la mano generaba una escritura al servidor.
    expect(moverElemento(lista, 2, 3)).toBe(lista);
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

// ---------------------------------------------------------------------------

/**
 * El arrastre COMPLETO: del píxel donde se suelta al orden que se guarda.
 *
 * Las dos piezas —`indiceSoltar` y `moverElemento`— estaban probadas por
 * separado y las dos pasaban, pero nadie probaba la composición, que es lo
 * único que el usuario toca. Y ahí estaba el fallo: `indiceSoltar` devuelve una
 * posición medida sobre la lista CON el elemento dentro, y `moverElemento` lo
 * sacaba antes de insertar, así que bajando siempre caía un puesto de más.
 *
 * Subiendo funcionaba. Por eso el síntoma era "va a ratos" y no "no va".
 */
describe("arrastrar de verdad: del píxel al orden guardado", () => {
  // Cuatro filas de 100px: centros en 100, 200, 300 y 400.
  const CENTROS = [100, 200, 300, 400];
  const LISTA = ["A", "B", "C", "D"];

  /** Lo que hace el gancho: mira dónde cayó el dedo y recoloca. */
  function soltarEn(id: string, y: number): string {
    const destino = indiceSoltar(y, CENTROS);
    return moverElemento(LISTA, LISTA.indexOf(id), destino).join("");
  }

  test("bajar una fila un puesto la deja UN puesto abajo", () => {
    // El dedo pasa el centro de B (200) y se queda antes del de C.
    expect(soltarEn("A", 210)).toBe("BACD");
  });

  test("bajar dos puestos deja dos puestos abajo", () => {
    expect(soltarEn("A", 310)).toBe("BCAD");
  });

  test("bajar hasta el final la deja la última", () => {
    expect(soltarEn("A", 450)).toBe("BCDA");
  });

  test("subir una fila un puesto la deja UN puesto arriba", () => {
    expect(soltarEn("D", 290)).toBe("ABDC");
  });

  test("subir dos puestos deja dos puestos arriba", () => {
    expect(soltarEn("D", 190)).toBe("ADBC");
  });

  test("subir hasta arriba la deja la primera", () => {
    expect(soltarEn("D", 50)).toBe("DABC");
  });

  test("soltar sin cruzar ningún centro no mueve nada", () => {
    // Ni un pelo por encima ni por debajo de su propia banda.
    expect(soltarEn("B", 210)).toBe("ABCD");
    expect(soltarEn("B", 190)).toBe("ABCD");
  });

  test("una fila del medio se mueve bien en los dos sentidos", () => {
    expect(soltarEn("B", 310)).toBe("ACBD");
    expect(soltarEn("C", 190)).toBe("ACBD");
  });
});

/**
 * Un arrastre no es un salto: es una sucesión de posiciones del dedo.
 *
 * Aquí estaba el segundo fallo. El gancho recomponía la lista sobre el resultado
 * del movimiento anterior, así que en cuanto la fila saltaba una vez, su índice
 * dejaba de coincidir con el hueco que miden los centros: al volver hacia arriba
 * el cálculo decía "quédate donde estás" y la fila se quedaba clavada abajo.
 *
 * Recomponer siempre desde el orden inicial lo hace además idempotente: el mismo
 * píxel devuelve siempre el mismo orden, se llegue por donde se llegue.
 */
describe("un arrastre completo, movimiento a movimiento", () => {
  const CENTROS = [100, 200, 300, 400];
  const INICIAL = ["A", "B", "C", "D"];

  /** Recorre el dedo por varias alturas y devuelve el orden tras cada una. */
  function recorrido(id: string, alturas: number[]): string[] {
    const desde = INICIAL.indexOf(id);
    return alturas.map((y) =>
      moverElemento(INICIAL, desde, indiceSoltar(y, CENTROS)).join(""),
    );
  }

  test("bajar del todo y volver a subir devuelve la fila a su sitio", () => {
    expect(recorrido("A", [110, 210, 310, 410, 310, 210, 110])).toEqual([
      "ABCD", // sin cruzar nada
      "BACD", // pasa a B
      "BCAD", // pasa a C
      "BCDA", // hasta el final
      "BCAD", // y de vuelta…
      "BACD",
      "ABCD", // exactamente donde empezó
    ]);
  });

  test("el mismo píxel da siempre el mismo orden, se llegue por donde se llegue", () => {
    const bajando = recorrido("A", [210, 310, 210]);
    expect(bajando[0]).toBe(bajando[2]);
  });

  test("subir del todo y volver a bajar también", () => {
    expect(recorrido("D", [390, 290, 190, 90, 190, 290, 390])).toEqual([
      "ABCD",
      "ABDC",
      "ADBC",
      "DABC",
      "ADBC",
      "ABDC",
      "ABCD",
    ]);
  });
});
