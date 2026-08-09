import { describe, expect, test } from "bun:test";
import { SUELO_DE_RUIDO, vozDelComensal } from "./voice-presence";

/**
 * El umbral que separa "está hablando" de "hay un comedor alrededor".
 *
 * Si se pone demasiado bajo, la pantalla tiembla toda la noche con los cubiertos
 * y la música, y una señal siempre encendida deja de ser una señal. Si se pone
 * demasiado alto, el comensal habla y no pasa nada, que es el fallo que se venía
 * a arreglar.
 */

describe("vozDelComensal", () => {
  test("el ruido de fondo no mueve nada", () => {
    expect(vozDelComensal(0)).toBe(0);
    expect(vozDelComensal(SUELO_DE_RUIDO)).toBe(0);
    expect(vozDelComensal(SUELO_DE_RUIDO - 0.01)).toBe(0);
  });

  test("arranca desde cero y no de un salto", () => {
    // Recortar en vez de reescalar haría aparecer el velo de golpe al 8 %.
    const apenas = vozDelComensal(SUELO_DE_RUIDO + 0.001);
    expect(apenas).toBeGreaterThan(0);
    expect(apenas).toBeLessThan(0.01);
  });

  test("crece de forma continua con la voz", () => {
    const bajo = vozDelComensal(0.2);
    const medio = vozDelComensal(0.5);
    const alto = vozDelComensal(0.9);
    expect(bajo).toBeLessThan(medio);
    expect(medio).toBeLessThan(alto);
  });

  test("el máximo del micro es el máximo de la animación", () => {
    expect(vozDelComensal(1)).toBe(1);
    expect(vozDelComensal(3)).toBe(1);
  });

  test("un valor imposible se trata como silencio, no como un grito", () => {
    // Un NaN en `height` u `opacity` deja el elemento sin pintar. Y un medidor
    // roto que informara infinito dejaría el velo abierto del todo para siempre:
    // la pantalla parecería estar oyendo un grito continuo. Ante un valor que no
    // es un número, quieta.
    expect(vozDelComensal(Number.NaN)).toBe(0);
    expect(vozDelComensal(Number.POSITIVE_INFINITY)).toBe(0);
    expect(vozDelComensal(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});
