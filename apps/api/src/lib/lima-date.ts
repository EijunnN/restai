/**
 * Fechas del día operativo peruano.
 *
 * Perú es UTC-5 todo el año, sin horario de verano, así que el desfase es una
 * constante y no hace falta librería. Lo que sí hace falta es no equivocarse de
 * frontera: un "2026-06-22" interpretado como medianoche UTC empieza el día
 * anterior a las 19:00 de Lima, y un rango de fechas construido así se come el
 * servicio de la noche entera o cuenta el de otro día.
 *
 * Vivía duplicado en `routes/coupons.ts`. Se saca aquí porque en cuanto una
 * segunda pantalla filtra por fechas, la copia y la original divergen.
 */

/** Perú no cambia la hora en todo el año. */
export const DESFASE_PERU = "-05:00";

const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Convierte lo que llega por HTTP en un instante.
 *
 * - `"2026-06-22"` con `frontera: "inicio"` → 00:00:00.000 de Lima.
 * - `"2026-06-22"` con `frontera: "fin"` → 23:59:59.999 de Lima, es decir, el
 *   día COMPLETO. Un rango que termina "el 22" tiene que incluir el 22.
 * - Un ISO con hora se respeta tal cual.
 *
 * Devuelve `null` si no se entiende, para que quien llame decida: ignorar el
 * filtro es casi siempre mejor que aplicar una fecha inventada.
 */
export function fechaDeLima(
  valor: string | null | undefined,
  frontera: "inicio" | "fin",
): Date | null {
  if (!valor) return null;

  if (SOLO_FECHA.test(valor)) {
    const iso =
      frontera === "inicio"
        ? `${valor}T00:00:00.000${DESFASE_PERU}`
        : `${valor}T23:59:59.999${DESFASE_PERU}`;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}
