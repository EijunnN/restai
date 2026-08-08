import { describe, expect, test } from "bun:test";
import {
  CANVAS,
  GRID_STEP,
  SEAT_PAD,
  SHAPE_SIZE,
  normalizeRotation,
  placeFixture,
  placeTable,
  seatPositions,
} from "./floor-plan";

/**
 * Un fallo aquí no lanza ningún error: deja la sala torcida. Una mesa medio
 * fuera del lienzo, sillas amontonadas o un giro que crece sin fin al pulsar
 * dos veces el mismo botón.
 */

describe("seatPositions", () => {
  test("una mesa redonda reparte las sillas por la circunferencia", () => {
    const { w, h } = SHAPE_SIZE.round;
    const spots = seatPositions("round", 4, w, h);
    expect(spots).toHaveLength(4);
    expect(spots.every((s) => s.round)).toBe(true);

    // Todas a la misma distancia del centro: si una se desvía, la mesa se ve
    // coja aunque el número de sillas sea correcto.
    const dists = spots.map((s) =>
      Math.hypot(s.x + 7 - w / 2, s.y + 7 - h / 2).toFixed(2),
    );
    expect(new Set(dists).size).toBe(1);
  });

  test("la primera silla de una redonda va arriba del todo", () => {
    const { w, h } = SHAPE_SIZE.round;
    const [first] = seatPositions("round", 4, w, h);
    expect(Math.round(first!.x + 7)).toBe(Math.round(w / 2));
    expect(first!.y + 7).toBeLessThan(h / 2);
  });

  test("una mesa rectangular reparte arriba y abajo", () => {
    const { w, h } = SHAPE_SIZE.rect;
    const spots = seatPositions("rect", 6, w, h);
    expect(spots).toHaveLength(6);
    expect(spots.filter((s) => s.y < 0)).toHaveLength(3);
    expect(spots.filter((s) => s.y > h)).toHaveLength(3);
    expect(spots.every((s) => !s.round)).toBe(true);
  });

  test("con sillas impares sobra una arriba, no debajo", () => {
    const { w, h } = SHAPE_SIZE.square;
    const spots = seatPositions("square", 5, w, h);
    expect(spots.filter((s) => s.y < 0)).toHaveLength(3);
    expect(spots.filter((s) => s.y > h)).toHaveLength(2);
  });

  test("una mesa sin sillas no rompe nada", () => {
    expect(seatPositions("round", 0, 76, 76)).toHaveLength(0);
    expect(seatPositions("square", -3, 76, 76)).toHaveLength(0);
  });
});

describe("placeTable", () => {
  test("con ajuste activo cae en múltiplos de la rejilla", () => {
    const p = placeTable(107, 93, "square", true);
    expect(p.x % GRID_STEP).toBe(0);
    expect(p.y % GRID_STEP).toBe(0);
  });

  test("sin ajuste respeta la posición exacta", () => {
    expect(placeTable(107, 93, "square", false)).toEqual({ x: 107, y: 93 });
  });

  test("una mesa no se sale por la derecha ni por abajo", () => {
    const p = placeTable(99999, 99999, "rect", false);
    const size = SHAPE_SIZE.rect;
    expect(p.x).toBe(CANVAS.width - (size.w + SEAT_PAD * 2));
    expect(p.y).toBe(CANVAS.height - (size.h + SEAT_PAD * 2));
  });

  test("una mesa no se sale por arriba ni por la izquierda", () => {
    expect(placeTable(-500, -500, "round", false)).toEqual({ x: 0, y: 0 });
  });

  test("el recorte va DESPUÉS del ajuste, no antes", () => {
    // Si se recortara primero y se ajustara después, el ajuste devolvería la
    // mesa fuera del lienzo y quedaría medio tablero colgando.
    const p = placeTable(99999, 99999, "square", true);
    const size = SHAPE_SIZE.square;
    expect(p.x).toBeLessThanOrEqual(CANVAS.width - (size.w + SEAT_PAD * 2));
    expect(p.y).toBeLessThanOrEqual(CANVAS.height - (size.h + SEAT_PAD * 2));
  });

  test("la barra, que es la más ancha, también cabe", () => {
    const p = placeTable(99999, 0, "bar", false);
    expect(p.x + SHAPE_SIZE.bar.w + SEAT_PAD * 2).toBeLessThanOrEqual(CANVAS.width);
  });
});

describe("placeFixture", () => {
  test("respeta su propio tamaño al recortar", () => {
    const p = placeFixture(99999, 99999, 200, 100, false);
    expect(p.x).toBe(CANVAS.width - 200);
    expect(p.y).toBe(CANVAS.height - 100);
  });

  test("un elemento más ancho que el lienzo se queda pegado al borde", () => {
    // No debe devolver una coordenada negativa: dejaría la barra fuera por la
    // izquierda para "compensar" que no cabe.
    const p = placeFixture(50, 50, CANVAS.width + 500, 60, false);
    expect(p.x).toBe(0);
  });
});

describe("normalizeRotation", () => {
  test("360 vuelve a 0", () => {
    expect(normalizeRotation(360)).toBe(0);
  });

  test("los negativos dan la vuelta", () => {
    expect(normalizeRotation(-15)).toBe(345);
    expect(normalizeRotation(-360)).toBe(0);
  });

  test("no crece sin fin al girar muchas veces", () => {
    let deg = 0;
    for (let i = 0; i < 100; i++) deg = normalizeRotation(deg + 15);
    expect(deg).toBeGreaterThanOrEqual(0);
    expect(deg).toBeLessThan(360);
  });

  test("un giro normal se queda igual", () => {
    expect(normalizeRotation(45)).toBe(45);
  });
});
