/**
 * Peru timezone utilities.
 * Peru is always UTC-5 (no DST).
 */

const PERU_OFFSET_MS = -5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const CIVIL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Returns the start of the Peru day (UTC-5) that CONTAINS the given instant,
 * expressed as a UTC Date object.
 *
 * OJO: el argumento es un INSTANTE, no una fecha civil. `new Date("2026-08-07")`
 * se parsea como medianoche UTC, que en Lima todavía es el 6 de agosto a las
 * 19:00 — pasarlo aquí devuelve el día anterior. Para una fecha civil peruana
 * ("YYYY-MM-DD" tal como la escribe el usuario) usa `peruCivilDayStart`.
 */
export function peruStartOfDay(date: Date = new Date()): Date {
  const peruTime = new Date(date.getTime() + PERU_OFFSET_MS);
  return new Date(
    Date.UTC(peruTime.getUTCFullYear(), peruTime.getUTCMonth(), peruTime.getUTCDate()) - PERU_OFFSET_MS,
  );
}

/**
 * Returns the end of the Peru day containing the given instant,
 * expressed as a UTC Date object (start of next day, exclusive).
 */
export function peruEndOfDay(date: Date = new Date()): Date {
  return new Date(peruStartOfDay(date).getTime() + DAY_MS);
}

/**
 * Convierte una fecha civil peruana ("YYYY-MM-DD") en el instante UTC de su
 * medianoche en Lima.
 *
 *   peruCivilDayStart("2026-08-07") -> 2026-08-07T05:00:00Z  (= 07/08 00:00 Lima)
 *
 * Este es el helper correcto para los filtros de rango de los reportes: el
 * usuario elige "07/08" en un DatePicker y espera el día 7 peruano, no la
 * ventana que resulte de interpretar esa cadena como UTC.
 */
export function peruCivilDayStart(dateStr: string): Date {
  const m = CIVIL_DATE_RE.exec(dateStr);
  if (!m) {
    // Fallback tolerante: si no es una fecha civil, se trata como instante.
    return peruStartOfDay(new Date(dateStr));
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  return new Date(Date.UTC(year, month - 1, day) - PERU_OFFSET_MS);
}

/**
 * Fin (exclusivo) de una fecha civil peruana: medianoche del día siguiente en Lima.
 *
 *   peruCivilDayEnd("2026-08-07") -> 2026-08-08T05:00:00Z
 */
export function peruCivilDayEnd(dateStr: string): Date {
  return new Date(peruCivilDayStart(dateStr).getTime() + DAY_MS);
}

/**
 * La fecha civil peruana ("YYYY-MM-DD") correspondiente a un instante.
 * Útil para sellar registros diarios (arqueo de caja, resúmenes) con el día
 * operativo del local y no con el día UTC.
 */
export function peruCivilDate(date: Date = new Date()): string {
  const peruTime = new Date(date.getTime() + PERU_OFFSET_MS);
  const y = peruTime.getUTCFullYear();
  const m = String(peruTime.getUTCMonth() + 1).padStart(2, "0");
  const d = String(peruTime.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
