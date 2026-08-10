import { describe, expect, test } from "bun:test";
import { alternarNota, tieneNota, trocearNotas } from "./notas-rapidas";

/**
 * Los atajos de nota escriben en el mismo campo que el cajero.
 *
 * Si esto se equivoca, o la cocina recibe "sin sal · Sin sal", o un toque en un
 * atajo borra la frase que el cajero acababa de teclear a mano.
 */

describe("trocear", () => {
  test("separa por el punto medio y limpia los espacios", () => {
    expect(trocearNotas("Sin sal ·  Aparte ")).toEqual(["Sin sal", "Aparte"]);
  });

  test("un campo vacío no son notas", () => {
    expect(trocearNotas("")).toEqual([]);
    expect(trocearNotas("  ·  ")).toEqual([]);
  });
});

describe("saber si ya está", () => {
  test("no distingue mayúsculas: la tecleada a mano es la misma nota", () => {
    expect(tieneNota("sin sal", "Sin sal")).toBe(true);
    expect(tieneNota("SIN SAL · aparte", "Aparte")).toBe(true);
  });

  test("no confunde una nota con otra que la contiene", () => {
    expect(tieneNota("Sin sal y sin ají", "Sin sal")).toBe(false);
  });
});

describe("alternar", () => {
  test("añade al final, detrás de lo ya escrito", () => {
    expect(alternarNota("Término tres cuartos", "Aparte")).toBe("Término tres cuartos · Aparte");
  });

  test("desde vacío no deja separadores sueltos", () => {
    expect(alternarNota("", "Sin sal")).toBe("Sin sal");
  });

  test("quita la nota sin tocar el resto", () => {
    expect(alternarNota("Sin sal · Aparte · Bien cocido", "Aparte")).toBe(
      "Sin sal · Bien cocido",
    );
  });

  test("quitar la única nota deja el campo vacío, no un separador", () => {
    expect(alternarNota("Sin sal", "Sin sal")).toBe("");
  });

  test("quita también la que se tecleó a mano en minúsculas", () => {
    expect(alternarNota("poco picante · aparte", "Poco picante")).toBe("aparte");
  });

  test("añadir dos veces no duplica: la segunda la quita", () => {
    const una = alternarNota("", "Sin sal");
    expect(alternarNota(una, "Sin sal")).toBe("");
  });
});
