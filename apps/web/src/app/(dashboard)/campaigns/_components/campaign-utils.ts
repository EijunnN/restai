import { formatCivilDate, toLimaDateString, todayInLima } from "@/lib/date";
import type { CampaignStatus, SegmentFilter } from "@/hooks/use-campaigns";

// ---------------------------------------------------------------------------
// Estados
// ---------------------------------------------------------------------------

export const statusLabels: Record<CampaignStatus, { label: string; color: string }> = {
  draft: {
    label: "Borrador",
    color: "bg-gray-100 text-gray-800 dark:bg-gray-700/40 dark:text-gray-300",
  },
  active: {
    label: "Activa",
    color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  },
  paused: {
    label: "Pausada",
    color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  },
  ended: {
    label: "Finalizada",
    color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  },
};

export function statusInfoFor(status: string) {
  return statusLabels[status as CampaignStatus] ?? statusLabels.draft;
}

// ---------------------------------------------------------------------------
// Días y meses
// ---------------------------------------------------------------------------

/** 0 = domingo ... 6 = sábado (igual que Date.getDay() y que la API). */
export const daysOfWeek: { value: number; label: string; full: string }[] = [
  { value: 1, label: "Lun", full: "lunes" },
  { value: 2, label: "Mar", full: "martes" },
  { value: 3, label: "Mié", full: "miércoles" },
  { value: 4, label: "Jue", full: "jueves" },
  { value: 5, label: "Vie", full: "viernes" },
  { value: 6, label: "Sáb", full: "sábado" },
  { value: 0, label: "Dom", full: "domingo" },
];

export const monthNames = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/** Mes civil peruano en curso (1-12). */
export function currentLimaMonth(): number {
  return Number(todayInLima().slice(5, 7));
}

export function describeDays(days: unknown): string {
  const arr: number[] = Array.isArray(days) ? days.map((d) => Number(d)) : [];
  if (arr.length === 0 || arr.length === 7) return "Todos los días";
  return daysOfWeek
    .filter((d) => arr.includes(d.value))
    .map((d) => d.label)
    .join(", ");
}

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------

// Perú es UTC-5 todo el año (no hay horario de verano).
const LIMA_OFFSET = "-05:00";

/**
 * "YYYY-MM-DD" -> instante ISO (en Z) del INICIO de ese día en Lima.
 *
 * La API valida con `z.string().datetime()`, que solo acepta la forma con "Z":
 * mandar la fecha civil pelada ("2026-08-07") devuelve 400.
 */
export function limaDayStartIso(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00.000${LIMA_OFFSET}`).toISOString();
}

/**
 * "YYYY-MM-DD" -> instante ISO (en Z) del FINAL de ese día en Lima.
 *
 * La campaña se compara con `ends_at >= ahora`: si se guardara la medianoche de
 * inicio, una promoción "hasta el 7" moriría a las 00:00 del día 7, es decir un
 * día antes de lo que el dueño entendió al elegir la fecha.
 */
export function limaDayEndIso(dateStr: string): string {
  return new Date(`${dateStr}T23:59:59.999${LIMA_OFFSET}`).toISOString();
}

/** Instante ISO de la API -> fecha civil peruana "YYYY-MM-DD" para el DatePicker. */
export function isoToLimaDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return toLimaDateString(d);
}

/** Instante ISO de la API -> "07/08/2026" en horario de Lima. */
export function formatDateLabel(value: string | null | undefined): string {
  const civil = isoToLimaDate(value);
  return civil ? formatCivilDate(civil) : "";
}

// ---------------------------------------------------------------------------
// Segmentos
// ---------------------------------------------------------------------------

/**
 * Limpia un segmento antes de usarlo como clave de consulta o de enviarlo:
 * `includeNeverVisited` solo significa algo acompañando a `lastVisitBeforeDays`,
 * y arrastrarlo suelto obligaría a previsualizar de nuevo sin haber cambiado
 * nada real.
 */
export function normalizeSegment(filter: SegmentFilter): SegmentFilter {
  const out: SegmentFilter = {};
  if (filter.tierId) out.tierId = filter.tierId;
  if (filter.minPoints !== undefined) out.minPoints = filter.minPoints;
  if (filter.maxPoints !== undefined) out.maxPoints = filter.maxPoints;
  if (filter.lastVisitBeforeDays !== undefined) {
    out.lastVisitBeforeDays = filter.lastVisitBeforeDays;
    out.includeNeverVisited = filter.includeNeverVisited === true;
  }
  if (filter.birthdayMonth !== undefined) out.birthdayMonth = filter.birthdayMonth;
  return out;
}

export function isEmptySegment(filter: SegmentFilter): boolean {
  return Object.keys(normalizeSegment(filter)).length === 0;
}

export function sameSegment(a: SegmentFilter, b: SegmentFilter): boolean {
  const na = normalizeSegment(a);
  const nb = normalizeSegment(b);
  const keys = new Set([...Object.keys(na), ...Object.keys(nb)]);
  for (const k of keys) {
    if ((na as any)[k] !== (nb as any)[k]) return false;
  }
  return true;
}

/** Resume el segmento en una frase legible para el dueño. */
export function describeSegment(
  filter: SegmentFilter,
  tierName?: string | null,
): string {
  const f = normalizeSegment(filter);
  const parts: string[] = [];

  if (f.tierId === "none") parts.push("sin nivel asignado");
  else if (f.tierId) parts.push(`del nivel ${tierName ?? "seleccionado"}`);

  if (f.minPoints !== undefined && f.maxPoints !== undefined) {
    parts.push(`con entre ${f.minPoints} y ${f.maxPoints} puntos`);
  } else if (f.minPoints !== undefined) {
    parts.push(`con ${f.minPoints} puntos o más`);
  } else if (f.maxPoints !== undefined) {
    parts.push(`con ${f.maxPoints} puntos o menos`);
  }

  if (f.lastVisitBeforeDays !== undefined) {
    parts.push(
      f.includeNeverVisited
        ? `que no vienen hace ${f.lastVisitBeforeDays} días (o que nunca pidieron)`
        : `que no vienen hace ${f.lastVisitBeforeDays} días`,
    );
  }

  if (f.birthdayMonth !== undefined) {
    parts.push(`que cumplen años en ${monthNames[f.birthdayMonth - 1]}`);
  }

  if (parts.length === 0) return "Todos los clientes de la organización.";
  return `Clientes ${parts.join(", ")}.`;
}

// ---------------------------------------------------------------------------
// Constructor de segmento (estado del formulario)
// ---------------------------------------------------------------------------

/**
 * Estado del constructor de segmento. Todo se guarda como texto para que el
 * usuario pueda borrar un campo sin que el filtro salte a 0 en mitad de la
 * escritura; la traducción a `SegmentFilter` ocurre en `segmentFormToFilter`.
 */
export interface SegmentForm {
  /** "" = todos los niveles, "none" = sin nivel, o el uuid de un nivel. */
  tierId: string;
  minPoints: string;
  maxPoints: string;
  lastVisitBeforeDays: string;
  includeNeverVisited: boolean;
  /** "" = cualquier mes, o "1".."12". */
  birthdayMonth: string;
}

export const emptySegmentForm: SegmentForm = {
  tierId: "",
  minPoints: "",
  maxPoints: "",
  lastVisitBeforeDays: "",
  includeNeverVisited: false,
  birthdayMonth: "",
};

function parsePositiveInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

export function segmentFormToFilter(form: SegmentForm): SegmentFilter {
  const filter: SegmentFilter = {};
  if (form.tierId) filter.tierId = form.tierId;

  const min = parsePositiveInt(form.minPoints);
  if (min !== null) filter.minPoints = min;

  const max = parsePositiveInt(form.maxPoints);
  if (max !== null) filter.maxPoints = max;

  const days = parsePositiveInt(form.lastVisitBeforeDays);
  if (days !== null && days >= 1) {
    filter.lastVisitBeforeDays = days;
    filter.includeNeverVisited = form.includeNeverVisited;
  }

  const month = parsePositiveInt(form.birthdayMonth);
  if (month !== null && month >= 1 && month <= 12) filter.birthdayMonth = month;

  return normalizeSegment(filter);
}

/** Mensaje de error del segmento, o null si es utilizable. */
export function validateSegmentForm(form: SegmentForm): string | null {
  const fields: [string, string][] = [
    [form.minPoints, "Los puntos mínimos"],
    [form.maxPoints, "Los puntos máximos"],
    [form.lastVisitBeforeDays, "Los días sin venir"],
  ];
  for (const [raw, label] of fields) {
    if (raw.trim() === "") continue;
    if (parsePositiveInt(raw) === null) {
      return `${label} deben ser un número entero mayor o igual a 0.`;
    }
  }

  const days = parsePositiveInt(form.lastVisitBeforeDays);
  if (form.lastVisitBeforeDays.trim() !== "" && (days === null || days < 1 || days > 3650)) {
    return "Los días sin venir deben estar entre 1 y 3650.";
  }

  const min = parsePositiveInt(form.minPoints);
  const max = parsePositiveInt(form.maxPoints);
  if (min !== null && max !== null && min > max) {
    return "Los puntos mínimos no pueden ser mayores que los máximos.";
  }

  return null;
}

/** Segmentos de un clic: los que más ingresos recuperan, sin escribir nada. */
export const segmentPresets: { id: string; label: string; build: () => SegmentForm }[] = [
  { id: "all", label: "Todos los clientes", build: () => ({ ...emptySegmentForm }) },
  {
    id: "inactive30",
    label: "No vienen hace 30 días",
    build: () => ({ ...emptySegmentForm, lastVisitBeforeDays: "30" }),
  },
  {
    id: "inactive90",
    label: "No vienen hace 90 días",
    build: () => ({ ...emptySegmentForm, lastVisitBeforeDays: "90" }),
  },
  {
    id: "birthday",
    label: "Cumplen años este mes",
    build: () => ({ ...emptySegmentForm, birthdayMonth: String(currentLimaMonth()) }),
  },
  {
    id: "points500",
    label: "Con 500 puntos o más",
    build: () => ({ ...emptySegmentForm, minPoints: "500" }),
  },
];

/** Fecha de última visita para la muestra de audiencia. */
export function lastVisitLabel(value: string | null): string {
  if (!value) return "Nunca pidió";
  const civil = isoToLimaDate(value);
  return civil ? `Última visita: ${formatCivilDate(civil)}` : "Última visita: —";
}
