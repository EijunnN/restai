/**
 * Geometría del plano de sala.
 *
 * Todo lo que decide dónde se dibuja cada cosa vive aquí, separado de React,
 * porque es donde un error se ve pero no se explica: una silla mal colocada o
 * un arrastre que se sale del lienzo no lanzan ningún fallo, simplemente dejan
 * la sala torcida. Cubierto por `floor-plan.test.ts`.
 */

export type TableShape = "round" | "square" | "rect" | "bar";

/** Tamaño del tablero por forma, en píxeles del lienzo. */
export const SHAPE_SIZE: Record<TableShape, { w: number; h: number }> = {
  round: { w: 76, h: 76 },
  square: { w: 76, h: 76 },
  rect: { w: 112, h: 68 },
  bar: { w: 190, h: 46 },
};

/** Hueco alrededor del tablero donde caben las sillas. */
export const SEAT_PAD = 22;

/** Lado de una silla. */
const SEAT = 14;

/** Separación entre el tablero y la silla. */
const SEAT_GAP = 7;

/** Lienzo lógico de un espacio. Las mesas no pueden salirse de aquí. */
export const CANVAS = { width: 1200, height: 760 };

/** Paso de la rejilla al ajustar. 20 px ≈ 20 cm a la escala del plano. */
export const GRID_STEP = 20;

export interface SeatSpot {
  x: number;
  y: number;
  /** Radio del borde: las sillas de una mesa redonda son redondas. */
  round: boolean;
}

/**
 * Dónde va cada silla de una mesa.
 *
 * En las redondas se reparten por la circunferencia empezando arriba; en las
 * demás, mitad arriba y mitad abajo, que es como se sienta la gente en una mesa
 * rectangular. Las coordenadas son relativas al tablero, no al lienzo.
 */
export function seatPositions(
  shape: TableShape,
  seats: number,
  w: number,
  h: number,
): SeatSpot[] {
  const out: SeatSpot[] = [];
  if (seats <= 0) return out;

  if (shape === "round") {
    const radius = w / 2 + SEAT_GAP + SEAT / 2;
    for (let i = 0; i < seats; i++) {
      const angle = (i / seats) * Math.PI * 2 - Math.PI / 2;
      out.push({
        x: w / 2 + radius * Math.cos(angle) - SEAT / 2,
        y: h / 2 + radius * Math.sin(angle) - SEAT / 2,
        round: true,
      });
    }
    return out;
  }

  const top = Math.ceil(seats / 2);
  const bottom = seats - top;
  for (let i = 0; i < top; i++) {
    out.push({ x: (w * (i + 1)) / (top + 1) - SEAT / 2, y: -SEAT_GAP - SEAT, round: false });
  }
  for (let i = 0; i < bottom; i++) {
    out.push({ x: (w * (i + 1)) / (bottom + 1) - SEAT / 2, y: h + SEAT_GAP, round: false });
  }
  return out;
}

/**
 * Coloca una mesa arrastrada: ajusta a la rejilla y la mantiene dentro.
 *
 * El recorte va DESPUÉS del ajuste. Al revés, una mesa soltada en el borde se
 * recortaba al límite y el ajuste la volvía a empujar fuera, así que quedaba
 * medio tablero colgando del lienzo.
 */
export function placeTable(
  x: number,
  y: number,
  shape: TableShape,
  snap: boolean,
): { x: number; y: number } {
  const size = SHAPE_SIZE[shape] ?? SHAPE_SIZE.square;
  const step = snap ? GRID_STEP : 1;
  const sx = Math.round(x / step) * step;
  const sy = Math.round(y / step) * step;
  return {
    x: clamp(sx, 0, CANVAS.width - (size.w + SEAT_PAD * 2)),
    y: clamp(sy, 0, CANVAS.height - (size.h + SEAT_PAD * 2)),
  };
}

/** Igual que `placeTable`, para un elemento de mobiliario con su propio tamaño. */
export function placeFixture(
  x: number,
  y: number,
  width: number,
  height: number,
  snap: boolean,
): { x: number; y: number } {
  const step = snap ? GRID_STEP : 1;
  const sx = Math.round(x / step) * step;
  const sy = Math.round(y / step) * step;
  return {
    x: clamp(sx, 0, CANVAS.width - width),
    y: clamp(sy, 0, CANVAS.height - height),
  };
}

function clamp(v: number, min: number, max: number): number {
  // `max` puede quedar por debajo de `min` si el elemento es más ancho que el
  // lienzo; en ese caso mandan el mínimo y el elemento arranca pegado al borde.
  return Math.max(min, Math.min(Math.max(min, max), v));
}

/** Normaliza un giro a [0, 360). El editor gira de 15 en 15 y llega a 360 o -15. */
export function normalizeRotation(deg: number): number {
  return ((Math.round(deg) % 360) + 360) % 360;
}
