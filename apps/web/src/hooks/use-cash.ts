"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiFetchWithMeta } from "@/lib/fetcher";

/**
 * Arqueo de caja.
 *
 * Sin esto no se podía cuadrar el dinero al cierre del turno ni atribuir un
 * faltante: `payments` no guardaba quién cobró y no existía el concepto de caja.
 */

export interface CashMethodTotal {
  method: string;
  total: number;
  tips: number;
  count: number;
}

export interface CashTotals {
  by_method: CashMethodTotal[];
  cash_sales: number;
  non_cash_sales: number;
  total_sales: number;
  tips_total: number;
  cash_tips: number;
  payment_count: number;
  order_count: number;
  voided_total: number;
  voided_count: number;
  expected_cash: number;
  expected_cash_with_tips: number;
}

export interface CashSession {
  id: string;
  branch_id: string;
  business_date: string;
  opening_float: number;
  counted_cash: number | null;
  expected_cash: number | null;
  difference: number | null;
  status: "open" | "closed";
  opening_notes: string | null;
  closing_notes: string | null;
  opened_at: string;
  closed_at: string | null;
  opened_by_name?: string | null;
  closed_by_name?: string | null;
  totals?: CashTotals;
}

/**
 * La caja abierta de la sede, o `null` si el turno aún no empezó.
 *
 * @param enabled Permite apagarla para roles sin `cash:read`. El MOZO no lo
 *        tiene, y el punto de venta es una pantalla que comparten cajero y
 *        mozo: sin este interruptor, la tablet del mozo acumulaba un 403 cada
 *        treinta segundos durante todo el servicio.
 */
export function useCurrentCashSession(enabled = true) {
  return useQuery<CashSession | null>({
    queryKey: ["cash", "current"],
    queryFn: () => apiFetch<CashSession | null>("/api/cash/current"),
    enabled,
    // Los totales cambian con cada cobro: se refrescan solos mientras la
    // pantalla está abierta, sin que el cajero tenga que pulsar nada.
    refetchInterval: 30_000,
  });
}

export interface CashSessionsPage {
  data: CashSession[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

/**
 * Historial de arqueos.
 *
 * `GET /api/cash` responde `{ success, data: CashSession[], pagination }`: el
 * array va en `data` y la paginación al lado. Con `apiFetch` —que se queda solo
 * con `data` y descarta el resto— hay que usar `apiFetchWithMeta`, o la
 * paginación se pierde. Este hook declaraba además una forma inventada
 * (`{ sessions, total, page, limit }`), así que `history.sessions` era SIEMPRE
 * undefined: la tabla mostraba "todavía no hay arqueos" con la caja llena de
 * ellos y el botón de exportar quedaba muerto. Un fallo silencioso en la
 * pantalla del dinero.
 */
export function useCashSessions(params: {
  from?: string;
  to?: string;
  status?: "open" | "closed";
  page?: number;
  limit?: number;
}) {
  const qs = new URLSearchParams();
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.status) qs.set("status", params.status);
  if (params.page) qs.set("page", String(params.page));
  if (params.limit) qs.set("limit", String(params.limit));
  const query = qs.toString();

  return useQuery<CashSessionsPage>({
    queryKey: ["cash", "list", params],
    queryFn: () => apiFetchWithMeta<CashSessionsPage>(`/api/cash${query ? `?${query}` : ""}`),
  });
}

export function useCashSession(id: string | null) {
  return useQuery<CashSession>({
    queryKey: ["cash", "detail", id],
    queryFn: () => apiFetch<CashSession>(`/api/cash/${id}`),
    enabled: !!id,
  });
}

export function useOpenCashSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { openingFloat: number; openingNotes?: string }) =>
      apiFetch<CashSession>("/api/cash/open", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["cash"] });
    },
  });
}

export function useCloseCashSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { countedCash: number; closingNotes?: string }) =>
      apiFetch<CashSession>("/api/cash/close", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["cash"] });
      // El cierre afecta al resumen de pagos del día.
      void qc.invalidateQueries({ queryKey: ["payments"] });
    },
  });
}
