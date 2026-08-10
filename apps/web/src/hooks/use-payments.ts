"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiFetchWithMeta } from "@/lib/fetcher";

/**
 * Cobros de la sede.
 *
 * Todo el dinero viaja y se guarda en CÉNTIMOS enteros: solo se divide entre 100
 * al pintarlo con `formatCurrency`. Un cobro anulado NO desaparece del listado
 * (sería borrar la traza contable): sigue viniendo con `voided: true` y deja de
 * sumar en los totales de "cobrado".
 */

export type PaymentMethod =
  | "cash"
  | "card"
  | "yape"
  | "plin"
  | "transfer"
  | "other";

/** Cubo lógico del listado: qué representa la fila para la caja. */
export type PaymentBucket = "all" | "collected" | "voided" | "pending";

/**
 * Fila cruda de `payments` tal y como la devuelven POST /api/payments y
 * POST /api/payments/:id/void. OJO: esos dos endpoints NO añaden `voided` ni
 * `cashier_name`, que solo existen en el listado; por eso son un tipo aparte y
 * no una versión "opcional" de `Payment`.
 */
export interface PaymentRow {
  id: string;
  order_id: string;
  organization_id: string;
  branch_id: string;
  method: PaymentMethod;
  /** Céntimos. */
  amount: number;
  reference: string | null;
  /** Céntimos. */
  tip: number;
  status: "pending" | "completed" | "failed" | "refunded";
  user_id: string | null;
  cash_session_id: string | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  created_at: string;
}

/** Fila del listado GET /api/payments: la cruda + lo que añade el JOIN. */
export interface Payment extends PaymentRow {
  order_number: string | null;
  cashier_name: string | null;
  /** Derivado por la API: `voided_at !== null`. */
  voided: boolean;
}

/** Totales del RANGO consultado, no de la página: no dependen del cubo elegido. */
export interface PaymentListTotals {
  collected: number;
  collectedCount: number;
  voided: number;
  voidedCount: number;
  pending: number;
  pendingCount: number;
}

export interface PaymentsQuery {
  method?: PaymentMethod;
  bucket?: PaymentBucket;
  /** Fecha civil peruana "YYYY-MM-DD" (usa lib/date, nunca toISOString()). */
  startDate?: string;
  endDate?: string;
}

export interface PaymentsResponse {
  data: Payment[];
  meta: { totals: PaymentListTotals };
}

function buildQueryString(query: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") qs.set(key, value);
  }
  const search = qs.toString();
  return search ? `?${search}` : "";
}

export function usePayments(query: PaymentsQuery = {}) {
  const search = buildQueryString({
    method: query.method,
    bucket: query.bucket,
    startDate: query.startDate,
    endDate: query.endDate,
  });

  return useQuery<PaymentsResponse>({
    queryKey: ["payments", "list", query],
    // `apiFetchWithMeta` porque los totales del rango viven en `meta`, fuera de
    // `data`: con `apiFetch` se perdían y la pantalla no podía contrastar lo
    // cobrado con lo anulado.
    queryFn: () => apiFetchWithMeta<PaymentsResponse>(`/api/payments${search}`),
  });
}

export interface PaymentSummary {
  byMethod: { method: PaymentMethod; total: number; tip: number; count: number }[];
  grandTotal: number;
  tipTotal: number;
  totalCount: number;
  cashTotal: number;
  voided: { total: number; count: number };
  pending: { total: number; count: number };
}

/**
 * Resumen del DÍA operativo de Lima (lo calcula la API, no admite rango).
 *
 * @param enabled Se apaga para quien no tenga `payments:read`, en vez de pedirlo
 *        y comerse un 403 en cada carga.
 */
export function usePaymentSummary(enabled = true) {
  return useQuery<PaymentSummary>({
    queryKey: ["payments", "summary"],
    queryFn: () => apiFetch<PaymentSummary>("/api/payments/summary"),
    enabled,
  });
}

export interface CreatePaymentInput {
  orderId: string;
  /** Uno de `PaymentMethod`; se declara ancho porque otras pantallas guardan el
   *  método en un `useState<string>` y la API ya lo valida contra su enum. */
  method: string;
  /** Céntimos. La API lo recorta al saldo pendiente: nunca cobra de más. */
  amount: number;
  reference?: string;
  /** Céntimos. */
  tip?: number;
}

/** Lo que devuelve POST /api/payments, ya con el saldo recalculado. */
export interface CreatePaymentResult extends PaymentRow {
  order_number: string | null;
  order_total: number;
  total_paid: number;
  remaining: number;
  fully_paid: boolean;
  order_completed: boolean;
}

export function useCreatePayment() {
  const qc = useQueryClient();
  return useMutation<CreatePaymentResult, Error, CreatePaymentInput>({
    mutationFn: (data) =>
      apiFetch<CreatePaymentResult>("/api/payments", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["cash"] });
      // Un cobro cambia el saldo pendiente de la mesa, que es lo que decide si
      // se puede liberar. Sin esto el plano seguía mostrando deuda ya cobrada y
      // el mozo recibía un 409 al liberar una mesa que en realidad estaba al día.
      qc.invalidateQueries({ queryKey: ["tables"] });
    },
  });
}

/** Cuenta dividida: cobra solo los ítems seleccionados (POST /api/payments/items). */
export function useCreateItemPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      orderId: string;
      itemIds: string[];
      method: string;
      reference?: string;
      tip?: number;
    }) =>
      apiFetch("/api/payments/items", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["cash"] });
    },
  });
}

/** Orden con saldo pendiente (GET /api/payments/unpaid-orders). Todo en céntimos. */
export interface UnpaidOrder {
  id: string;
  order_number: string;
  customer_name: string | null;
  total: number;
  status: string;
  created_at: string;
  /** Solo cuenta cobros completados y NO anulados. */
  total_paid: number;
  remaining: number;
  table_number: number | null;
}

export function useUnpaidOrders() {
  return useQuery<UnpaidOrder[]>({
    queryKey: ["payments", "unpaid-orders"],
    queryFn: () => apiFetch<UnpaidOrder[]>("/api/payments/unpaid-orders"),
  });
}

/** Comprobante ligado a un cobro anulado: obliga a emitir nota de crédito. */
export interface VoidedPaymentInvoice {
  id: string;
  type: "boleta" | "factura" | "nota_credito" | "nota_debito";
  series: string;
  number: number;
  sunat_status: string;
}

export interface VoidPaymentResult extends PaymentRow {
  order_number: string | null;
  order_total: number;
  order_status: string;
  items_released: number;
  total_paid: number;
  remaining: number;
  /**
   * La orden estaba cerrada y ahora tiene saldo: nadie revierte automáticamente
   * el stock ni los puntos ya comunicados al cliente, hace falta un humano.
   */
  order_needs_review: boolean;
  /** Anular el cobro NO anula el comprobante: SUNAT exige nota de crédito. */
  invoice_needs_credit_note: boolean;
  invoice: VoidedPaymentInvoice | null;
}

/**
 * Anula un cobro (POST /api/payments/:id/void, permiso `payments:void`).
 *
 * El cobro nunca se borra: queda con quién, cuándo y por qué. El motivo es
 * obligatorio (mínimo 5 caracteres) porque sin él la traza no sirve en una
 * inspección.
 */
export function useVoidPayment() {
  const qc = useQueryClient();
  return useMutation<VoidPaymentResult, Error, { id: string; reason: string }>({
    mutationFn: ({ id, reason }) =>
      apiFetch<VoidPaymentResult>(`/api/payments/${id}/void`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      // El arqueo del turno y el listado de comprobantes cambian con la anulación.
      qc.invalidateQueries({ queryKey: ["cash"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      // Anular un cobro resucita la deuda de la mesa: el plano debe reflejarlo.
      qc.invalidateQueries({ queryKey: ["tables"] });
    },
  });
}
