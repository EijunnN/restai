import { describe, expect, test } from "bun:test";
import type { CartItem } from "@restai/types";
import {
  describeVariant,
  isSingleChoice,
  isUnsatisfiable,
  maximumAllowed,
  optionsTotal,
  requiredMinimum,
  selectionToCartModifiers,
  summarizeVariants,
  toggleOption,
  unitsInCart,
  validateSelection,
  type ModifierGroup,
} from "./menu-options";

/**
 * Estas reglas deciden si el comensal puede pedir. Si el cliente valida menos
 * que el servidor, el pedido ENTERO se rechaza al confirmar y el comensal no
 * tiene forma de saber qué corregir.
 */

const grupo = (over: Partial<ModifierGroup> = {}): ModifierGroup => ({
  id: "g1",
  name: "Término",
  is_required: false,
  min_selections: 0,
  max_selections: 1,
  modifiers: [
    { id: "a", name: "Dorado", price: 0 },
    { id: "b", name: "Bien dorado", price: 0 },
    { id: "c", name: "Jugoso", price: 300 },
  ],
  ...over,
});

describe("requiredMinimum", () => {
  test("obligatorio sin mínimo declarado exige una", () => {
    expect(requiredMinimum(grupo({ is_required: true, min_selections: 0 }))).toBe(1);
  });

  test("obligatorio con mínimo mayor respeta el mínimo", () => {
    expect(requiredMinimum(grupo({ is_required: true, min_selections: 2 }))).toBe(2);
  });

  test("NO obligatorio pero con mínimo también exige", () => {
    // El hueco real: el cliente lo ignoraba y el servidor no. El pedido entero
    // se caía al confirmar, con un 400 genérico y lejos de esta pantalla.
    expect(requiredMinimum(grupo({ is_required: false, min_selections: 2 }))).toBe(2);
  });

  test("opcional puro no exige nada", () => {
    expect(requiredMinimum(grupo())).toBe(0);
  });
});

describe("maximumAllowed / isSingleChoice", () => {
  test("uno es selección única", () => {
    expect(isSingleChoice(grupo({ max_selections: 1 }))).toBe(true);
    expect(maximumAllowed(grupo({ max_selections: 1 }))).toBe(1);
  });

  test("cero significa sin tope, igual que en el servidor", () => {
    expect(maximumAllowed(grupo({ max_selections: 0 }))).toBeNull();
    expect(isSingleChoice(grupo({ max_selections: 0 }))).toBe(false);
  });

  test("varios es múltiple con tope", () => {
    expect(isSingleChoice(grupo({ max_selections: 3 }))).toBe(false);
    expect(maximumAllowed(grupo({ max_selections: 3 }))).toBe(3);
  });
});

describe("validateSelection", () => {
  test("sin elegir un grupo obligatorio, no deja pasar", () => {
    const g = grupo({ is_required: true });
    const issues = validateSelection([g], {});
    expect(issues).toHaveLength(1);
    expect(issues[0]!.groupId).toBe("g1");
    expect(issues[0]!.blocked).toBe(false);
  });

  test("elegido lo obligatorio, pasa", () => {
    const g = grupo({ is_required: true });
    expect(validateSelection([g], { g1: ["a"] })).toHaveLength(0);
  });

  test("un grupo NO obligatorio con mínimo también bloquea", () => {
    const g = grupo({ is_required: false, min_selections: 2, max_selections: 3 });
    expect(validateSelection([g], { g1: ["a"] })).toHaveLength(1);
    expect(validateSelection([g], { g1: ["a", "b"] })).toHaveLength(0);
  });

  test("un grupo obligatorio sin opciones se marca como imposible", () => {
    // Todas agotadas: la API las filtra y el grupo llega vacío. Antes el botón
    // quedaba bloqueado para siempre sin decir por qué.
    const g = grupo({ is_required: true, modifiers: [] });
    const issues = validateSelection([g], {});
    expect(issues).toHaveLength(1);
    expect(issues[0]!.blocked).toBe(true);
    expect(issues[0]!.message).toContain("Avisa al mozo");
  });

  test("un grupo opcional vacío no molesta", () => {
    expect(validateSelection([grupo({ modifiers: [] })], {})).toHaveLength(0);
  });
});

describe("toggleOption", () => {
  test("en selección única, elegir otra sustituye", () => {
    const g = grupo({ max_selections: 1 });
    const r = toggleOption(g, { g1: ["a"] }, "b");
    expect(r.selection.g1).toEqual(["b"]);
  });

  test("un radio OBLIGATORIO no se puede vaciar re-tocando", () => {
    // Un radio real no se vacía. Antes sí, y el grupo quedaba inválido sin que
    // el comensal entendiera que él lo había desmarcado.
    const g = grupo({ is_required: true, max_selections: 1 });
    const r = toggleOption(g, { g1: ["a"] }, "a");
    expect(r.selection.g1).toEqual(["a"]);
  });

  test("un radio OPCIONAL sí se puede vaciar", () => {
    const g = grupo({ is_required: false, max_selections: 1 });
    const r = toggleOption(g, { g1: ["a"] }, "a");
    expect(r.selection.g1).toEqual([]);
  });

  test("en múltiple, acumula y quita", () => {
    const g = grupo({ max_selections: 3 });
    let s = toggleOption(g, {}, "a").selection;
    s = toggleOption(g, s, "b").selection;
    expect(s.g1).toEqual(["a", "b"]);
    s = toggleOption(g, s, "a").selection;
    expect(s.g1).toEqual(["b"]);
  });

  test("al llegar al tope avisa en vez de ignorar el toque", () => {
    const g = grupo({ max_selections: 2 });
    const r = toggleOption(g, { g1: ["a", "b"] }, "c");
    expect(r.atLimit).toBe(true);
    expect(r.selection.g1).toEqual(["a", "b"]);
  });

  test("sin tope se puede seguir añadiendo", () => {
    const g = grupo({ max_selections: 0 });
    const r = toggleOption(g, { g1: ["a", "b"] }, "c");
    expect(r.atLimit).toBe(false);
    expect(r.selection.g1).toEqual(["a", "b", "c"]);
  });
});

describe("optionsTotal", () => {
  test("suma en céntimos las opciones elegidas", () => {
    expect(optionsTotal([grupo()], { g1: ["c"] })).toBe(300);
    expect(optionsTotal([grupo()], { g1: ["a", "c"] })).toBe(300);
    expect(optionsTotal([grupo()], {})).toBe(0);
  });

  test("una opción que ya no existe no rompe la suma", () => {
    expect(optionsTotal([grupo()], { g1: ["fantasma"] })).toBe(0);
  });
});

describe("selectionToCartModifiers", () => {
  test("aplana con nombre y precio para poder pintar la línea", () => {
    const r = selectionToCartModifiers([grupo()], { g1: ["c"] });
    expect(r).toEqual([{ modifierId: "c", name: "Jugoso", price: 300 }]);
  });
});

// ── Lo que ya hay en el pedido ──────────────────────────────────────────────

const linea = (over: Partial<CartItem> = {}): CartItem => ({
  lineId: "l1",
  menuItemId: "m1",
  name: "Causa",
  unitPrice: 3400,
  quantity: 1,
  modifiers: [],
  ...over,
});

describe("unitsInCart", () => {
  test("suma TODAS las variantes del plato, no solo la línea sin opciones", () => {
    // El punto ciego: la tarjeta mostraba 0 en un plato pedido con extras.
    const items = [
      linea({ lineId: "l1", quantity: 1 }),
      linea({
        lineId: "l2",
        quantity: 2,
        modifiers: [{ modifierId: "x", name: "palta extra", price: 400 }],
      }),
      linea({ lineId: "l3", menuItemId: "otro", quantity: 5 }),
    ];
    expect(unitsInCart(items, "m1")).toBe(3);
  });

  test("un plato que no está en el carrito da cero", () => {
    expect(unitsInCart([], "m1")).toBe(0);
  });
});

describe("describeVariant / summarizeVariants", () => {
  test("sin opciones se llama clásica, no queda en blanco", () => {
    expect(describeVariant(linea())).toBe("clásica");
  });

  test("con opciones las enumera", () => {
    expect(
      describeVariant(
        linea({
          modifiers: [
            { modifierId: "x", name: "palta extra", price: 400 },
            { modifierId: "y", name: "ají aparte", price: 0 },
          ],
        }),
      ),
    ).toBe("palta extra · ají aparte");
  });

  test("el resumen distingue las variantes de un mismo plato", () => {
    const items = [
      linea({ lineId: "l1", quantity: 1 }),
      linea({
        lineId: "l2",
        quantity: 1,
        modifiers: [{ modifierId: "x", name: "palta extra", price: 400 }],
      }),
    ];
    expect(summarizeVariants(items, "m1")).toBe("1 clásica · 1 palta extra");
  });
});
