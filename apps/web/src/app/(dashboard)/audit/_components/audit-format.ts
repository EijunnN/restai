/**
 * Traduce el "antes / después" de una traza de auditoría a lenguaje de negocio.
 *
 * Quien abre esta pantalla es el dueño o el gerente, no un programador: un
 * volcado `{"forgiven_amount":2596}` no le dice que se perdonaron S/ 25.96. Las
 * reglas que se aplican aquí:
 *
 * - Solo se muestran los campos que REALMENTE cambiaron. Repetir veinte líneas
 *   idénticas esconde la única que importa.
 * - Cada campo se formatea según lo que significa, no según su tipo en la base:
 *   los importes viven en céntimos y salen como soles, las tasas viven en
 *   puntos básicos y salen como porcentaje.
 *
 * Este módulo es lógica pura y está cubierto por `audit-format.test.ts`; la
 * presentación vive en `change-list.tsx`.
 */

import { formatDate } from "@/lib/utils";

// ── Diccionarios ────────────────────────────────────────────────────────────

/** Campo -> cómo se llama en la pantalla. Lo que no esté aquí se humaniza solo. */
export const FIELD_LABELS: Record<string, string> = {
  // Dinero y totales
  amount: "Importe",
  subtotal: "Subtotal",
  total: "Total",
  tax: "IGV",
  discount: "Descuento",
  delivery_fee: "Costo de envío",
  tip: "Propina",
  billed: "Facturado",
  paid: "Cobrado",
  order_total: "Total de la orden",
  order_total_paid: "Cobrado de la orden",
  order_remaining: "Pendiente de la orden",
  forgiven_amount: "Importe perdonado",
  voided_total: "Total anulado",
  live_collected: "Cobrado real",
  // Caja
  opening_float: "Fondo de apertura",
  counted_cash: "Efectivo contado",
  expected_cash: "Efectivo esperado",
  difference: "Descuadre",
  cash_sales: "Ventas en efectivo",
  non_cash_sales: "Ventas sin efectivo",
  cash_tips: "Propinas en efectivo",
  opening_notes: "Nota de apertura",
  closing_notes: "Nota de cierre",
  opened_at: "Abierta el",
  business_date: "Día de operación",
  cash_session_id: "Caja",
  payment_count: "Cobros incluidos",
  // Orden
  order: "Orden",
  order_id: "Orden",
  orders: "Órdenes",
  status: "Estado",
  order_status: "Estado de la orden",
  item: "Plato",
  items_released: "Platos liberados",
  released_items: "Platos liberados",
  completed_orders: "Órdenes completadas",
  order_needs_review: "Requiere revisión",
  customer_name: "Cliente",
  number: "Número",
  ticket: "Ticket",
  // Cobros
  method: "Medio de pago",
  reference: "Referencia",
  charged_by: "Cobrado por",
  voided_by: "Anulado por",
  voided_at: "Anulado el",
  void_reason: "Motivo de la anulación",
  reason: "Motivo",
  motivo: "Motivo",
  motivo_codigo: "Código del motivo",
  motivo_via: "Origen del motivo",
  // Comprobantes / SUNAT
  invoice_id: "Comprobante",
  series: "Serie",
  sunat_code: "Código SUNAT",
  sunat_description: "Respuesta de SUNAT",
  sunat_status: "Estado en SUNAT",
  nota_credito: "Nota de crédito",
  nota_id: "Nota de crédito",
  ruc: "RUC",
  legal_name: "Razón social",
  tax_rate: "Tasa de IGV",
  currency: "Moneda",
  // Organización / sede
  name: "Nombre",
  address: "Dirección",
  phone: "Teléfono",
  logo_url: "Logotipo",
  timezone: "Zona horaria",
  settings: "Configuración",
  // Carta
  is_available: "Disponible",
  repriced: "Precio actualizado",
  // Fidelización y campañas
  points_reversed: "Puntos devueltos",
  reversed: "Revertido",
  segment: "Segmento",
  audience: "Público",
  recipients: "Destinatarios",
  sources: "Orígenes",
  // Reparto
  via: "Canal",
  type: "Tipo",
  delivery_incluido: "Incluye reparto",
  exito: "Resultado",
};

/** Campos guardados en CÉNTIMOS. Se muestran como soles. */
const MONEY_FIELDS = new Set([
  "amount",
  "subtotal",
  "total",
  "tax",
  "discount",
  "delivery_fee",
  "tip",
  "billed",
  "paid",
  "order_total",
  "order_total_paid",
  "order_remaining",
  "forgiven_amount",
  "voided_total",
  "live_collected",
  "opening_float",
  "counted_cash",
  "expected_cash",
  "difference",
  "cash_sales",
  "non_cash_sales",
  "cash_tips",
  "unit_price",
  "price",
]);

/** Campos con fecha/hora. */
const DATE_FIELDS = new Set([
  "opened_at",
  "closed_at",
  "voided_at",
  "created_at",
  "updated_at",
  "business_date",
]);

/** Identificadores internos: no aportan nada al gerente y ensucian la lista. */
const OPAQUE_ID_FIELDS = new Set(["cash_session_id", "invoice_id", "nota_id", "order_id"]);

/** Valores de enumeración -> etiqueta. La clave es `campo:valor` o solo `valor`. */
const VALUE_LABELS: Record<string, string> = {
  // Estados de orden
  pending: "Pendiente",
  confirmed: "Confirmada",
  preparing: "En preparación",
  ready: "Lista",
  served: "Servida",
  completed: "Completada",
  cancelled: "Cancelada",
  // Estados de caja / sesión
  open: "Abierta",
  closed: "Cerrada",
  active: "Activa",
  // Medios de pago
  "method:cash": "Efectivo",
  "method:card": "Tarjeta",
  "method:yape": "Yape",
  "method:plin": "Plin",
  "method:transfer": "Transferencia",
  "method:other": "Otro",
  // SUNAT
  "sunat_status:accepted": "Aceptado",
  "sunat_status:rejected": "Rechazado",
  "sunat_status:error": "Con error",
  "sunat_status:pending": "Pendiente de envío",
  // Tipos de pedido
  "type:dine_in": "En el local",
  "type:takeout": "Para llevar",
  "type:delivery": "Reparto",
};

// ── Formateo ────────────────────────────────────────────────────────────────

function soles(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}S/ ${(Math.abs(cents) / 100).toFixed(2)}`;
}

/** "forgiven_amount" -> "Forgiven amount". Último recurso si no hay etiqueta. */
function humanizeKey(key: string): string {
  const clean = key.replace(/_/g, " ").trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

export function labelFor(key: string): string {
  return FIELD_LABELS[key] ?? humanizeKey(key);
}

/**
 * Da formato a un valor suelto según lo que representa su campo.
 *
 * Devuelve siempre texto: la lista de cambios compara y alinea dos columnas, no
 * incrusta componentes.
 */
export function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "sin definir";

  if (typeof value === "boolean") return value ? "Sí" : "No";

  if (typeof value === "number") {
    if (MONEY_FIELDS.has(key)) return soles(value);
    // El IGV se guarda en puntos básicos (1800 = 18 %) para no perder decimales.
    if (key === "tax_rate") return `${String(value / 100)} %`;
    return String(value);
  }

  if (typeof value === "string") {
    if (DATE_FIELDS.has(key)) {
      // `business_date` llega como "2026-08-07": sin hora y sin sorpresas de huso.
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.split("-").reverse().join("/");
      const d = new Date(value);
      if (!Number.isNaN(d.getTime())) return formatDate(value);
    }
    // Un UUID suelto no le dice nada a nadie; se acorta para poder citarlo en un
    // ticket de soporte sin ocupar la fila entera.
    if (OPAQUE_ID_FIELDS.has(key) && /^[0-9a-f-]{36}$/i.test(value)) {
      return `#${value.slice(0, 8)}`;
    }
    return VALUE_LABELS[`${key}:${value}`] ?? VALUE_LABELS[value] ?? value;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return "ninguno";
    if (value.every((v) => typeof v !== "object" || v === null)) {
      return value.map((v) => formatValue(key, v)).join(", ");
    }
    return `${value.length} ${value.length === 1 ? "elemento" : "elementos"}`;
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    // Objetos que ya traen su propia descripción legible.
    for (const nameKey of ["name", "number", "title", "label"]) {
      if (typeof obj[nameKey] === "string") return obj[nameKey] as string;
    }
    return "(varios datos)";
  }

  return String(value);
}

// ── Aplanado ────────────────────────────────────────────────────────────────

type Flat = Record<string, unknown>;

const SELF_DESCRIBING = ["name", "number", "title", "label"];

/**
 * Aplana un objeto anidado a rutas legibles ("Configuración › IGV").
 *
 * La profundidad se limita a propósito: la traza guarda instantáneas, no árboles
 * infinitos, y una lista de cincuenta filas indentadas sería tan ilegible como
 * el JSON que vino a sustituir.
 */
function flatten(input: unknown, prefix = "", depth = 0): Flat {
  const out: Flat = {};
  if (input === null || typeof input !== "object" || Array.isArray(input)) return out;

  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    // Ruido interno del recortador de payloads (ver `trim` en lib/audit.ts).
    if (key === "_truncated" || key === "preview") continue;

    const path = prefix ? `${prefix} ${key}` : key;
    const isPlainObject = value !== null && typeof value === "object" && !Array.isArray(value);
    const hasOwnLabel =
      isPlainObject &&
      SELF_DESCRIBING.some(
        (k) => typeof (value as Record<string, unknown>)[k] === "string",
      );

    if (isPlainObject && depth < 2 && !hasOwnLabel) {
      Object.assign(out, flatten(value, path, depth + 1));
    } else {
      out[path] = value;
    }
  }
  return out;
}

/** Reconstruye la etiqueta visible de una ruta aplanada. */
function labelForPath(path: string): string {
  return path.split(" ").map(labelFor).join(" › ");
}

/** El nombre del último tramo, que es el que decide el formato del valor. */
function leafKey(path: string): string {
  const parts = path.split(" ");
  return parts[parts.length - 1]!;
}

// ── Cálculo de cambios ──────────────────────────────────────────────────────

export interface ChangeRow {
  path: string;
  label: string;
  before: string;
  after: string;
  changed: boolean;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // Ausente, nulo y cadena vacía significan lo mismo para quien lee: "no había
  // nada". Distinguirlos generaría cambios fantasma en cada traza.
  if (a === null || a === undefined) return b === null || b === undefined || b === "";
  if (b === null || b === undefined) return a === "";
  if (typeof a === "object" || typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/** Filas listas para pintar, con los cambios reales primero. */
export function buildChanges(before: unknown, after: unknown): ChangeRow[] {
  const flatBefore = flatten(before);
  const flatAfter = flatten(after);
  const paths = Array.from(new Set([...Object.keys(flatBefore), ...Object.keys(flatAfter)]));

  return paths
    .map((path) => {
      const key = leafKey(path);
      const b = flatBefore[path];
      const a = flatAfter[path];

      // Las instantáneas de auditoría son PARCIALES: cada endpoint guarda los
      // campos que le interesan, y "después" rara vez repite todo lo de "antes".
      // Un campo que estaba y ya no viene no se borró, sencillamente no se
      // informó; pintarlo como "S/ 18.00 → sin definir" afirmaría un vaciado que
      // nunca ocurrió. Un campo que solo aparece en "después" sí es un dato
      // nuevo y se muestra como tal.
      const informadoDespues = Object.hasOwn(flatAfter, path);

      return {
        path,
        label: labelForPath(path),
        before: formatValue(key, b),
        after: formatValue(key, a),
        changed: informadoDespues && !sameValue(b, a),
      };
    })
    .sort((x, y) => Number(y.changed) - Number(x.changed) || x.label.localeCompare(y.label, "es"));
}

/** ¿El payload venía recortado por tamaño? */
export function wasTruncated(value: unknown): boolean {
  return Boolean(
    value && typeof value === "object" && (value as Record<string, unknown>)._truncated,
  );
}
