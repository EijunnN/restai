"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/fetcher";

/**
 * Avisos de mesa: "llamar al mozo" y "pedir la cuenta".
 *
 * Antes esto era solo un evento en tiempo real: si nadie tenía la pantalla
 * abierta en ese instante, el aviso no había existido nunca y el comensal se
 * quedaba con la mano levantada. Ahora persisten, así que hay bandeja de
 * pendientes, tiempo de espera visible y sobreviven a un refresco o a un cambio
 * de turno.
 */

export type ServiceRequestType = "call_waiter" | "request_bill";
export type ServiceRequestStatus = "pending" | "acknowledged" | "resolved" | "cancelled";

export interface ServiceRequest {
  id: string;
  type: ServiceRequestType;
  status: ServiceRequestStatus;
  note: string | null;
  table_id: string | null;
  table_number: number | null;
  table_session_id: string | null;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  resolved_at: string | null;
  created_at: string;
  elapsed_seconds: number;
}

export const SERVICE_REQUEST_LABELS: Record<ServiceRequestType, string> = {
  call_waiter: "Llama al mozo",
  request_bill: "Pide la cuenta",
};

export function useServiceRequests(params?: {
  status?: ServiceRequestStatus;
  tableId?: string;
  /**
   * Un solo tipo de aviso. El punto de venta solo quiere saber qué mesas han
   * pedido la cuenta: traerse también los "llama al mozo" para descartarlos en
   * el cliente es pedir de más veinte veces por minuto en una sala llena.
   */
  type?: ServiceRequestType;
  /**
   * Permite apagar la consulta para roles sin `tables:read` (cocina). Sin esto,
   * la campana la disparaba en TODAS las pantallas cada 20 s y la tablet de la
   * cocina acumulaba un 403 cada veinte segundos durante todo el servicio.
   */
  enabled?: boolean;
}) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.tableId) qs.set("tableId", params.tableId);
  if (params?.type) qs.set("type", params.type);
  const query = qs.toString();

  return useQuery<ServiceRequest[]>({
    queryKey: ["service-requests", params],
    queryFn: () => apiFetch<ServiceRequest[]>(`/api/service-requests${query ? `?${query}` : ""}`),
    enabled: params?.enabled ?? true,
    // Red de seguridad por si se pierde un evento de tiempo real: un aviso sin
    // atender es lo más caro que puede quedarse invisible en una sala llena.
    refetchInterval: 20_000,
  });
}

export function useAcknowledgeServiceRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<ServiceRequest>(`/api/service-requests/${id}/ack`, { method: "POST" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["service-requests"] });
    },
  });
}

export function useResolveServiceRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<ServiceRequest>(`/api/service-requests/${id}/resolve`, { method: "POST" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["service-requests"] });
    },
  });
}

/** "hace 2 min", "hace 45 s" — el dato que decide a qué mesa ir primero. */
export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `hace ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `hace ${hours} h ${minutes % 60} min`;
}
