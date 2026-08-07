/**
 * Fechas civiles en horario de Perú (UTC-5, sin horario de verano).
 *
 * El navegador del usuario puede estar en cualquier zona horaria: un tablet
 * configurado en UTC, un dueño revisando desde el extranjero, o simplemente el
 * desfase de `toISOString()` (que devuelve UTC). Todos los filtros de fecha que
 * viajan a la API deben expresar el DÍA OPERATIVO DEL LOCAL, no el día del
 * dispositivo. La API los interpreta con `peruCivilDayStart`.
 */

const PERU_TIME_ZONE = "America/Lima";

/** Formatea un instante como fecha civil peruana "YYYY-MM-DD". */
export function toLimaDateString(date: Date = new Date()): string {
  // en-CA produce exactamente YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PERU_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** La fecha civil peruana de hoy. */
export function todayInLima(): string {
  return toLimaDateString(new Date());
}

/** Suma (o resta, con signo negativo) días a una fecha civil "YYYY-MM-DD". */
export function addDaysToDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  // Mediodía UTC evita que un cambio de día por DST o redondeo desplace la fecha.
  const base = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  base.setUTCDate(base.getUTCDate() + days);
  const yy = base.getUTCFullYear();
  const mm = String(base.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(base.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Rango de hoy (un solo día) en hora de Lima. */
export function limaTodayRange(): { start: string; end: string } {
  const today = todayInLima();
  return { start: today, end: today };
}

/** Últimos N días incluyendo hoy, en hora de Lima. */
export function limaLastDaysRange(days: number): { start: string; end: string } {
  const end = todayInLima();
  return { start: addDaysToDateString(end, -(days - 1)), end };
}

/** Del día 1 del mes actual hasta hoy, en hora de Lima. */
export function limaCurrentMonthRange(): { start: string; end: string } {
  const end = todayInLima();
  const start = `${end.slice(0, 7)}-01`;
  return { start, end };
}

/** Formatea "YYYY-MM-DD" como "07/08/2026" sin desfases de zona horaria. */
export function formatCivilDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  if (!y || !m || !d) return dateStr;
  return `${d}/${m}/${y}`;
}
