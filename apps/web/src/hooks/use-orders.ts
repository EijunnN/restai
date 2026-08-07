"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiFetchWithMeta } from "@/lib/fetcher";

interface OrderFilters {
  status?: string;
  page?: number;
  limit?: number;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface OrdersResponse {
  orders: any[];
  pagination: Pagination;
}

/** Respuesta cruda de GET /api/orders: la paginación viaja al nivel raíz. */
interface OrdersEnvelope {
  data: any[] | null;
  pagination?: Pagination;
}

/**
 * Listado paginado de órdenes.
 *
 * Va por `apiFetchWithMeta` y NO por un `fetch` propio: este listado se
 * resondea cada 5 segundos y el token de acceso caduca a los 15 minutos, así
 * que con el fetch a pelo —sin la rama de renovación del 401— la pantalla se
 * quedaba clavada en "No autenticado" en cuanto la barra pasaba un rato sin
 * que nadie tocara nada. `apiFetchWithMeta` renueva el token (deduplicando
 * llamadas concurrentes), reintenta, y además devuelve la envoltura completa,
 * que es de donde sale la paginación.
 */
async function fetchOrdersWithPagination(path: string): Promise<OrdersResponse> {
  const json = await apiFetchWithMeta<OrdersEnvelope>(path);
  return {
    orders: json.data ?? [],
    pagination: json.pagination ?? { page: 1, limit: 20, total: 0, totalPages: 1 },
  };
}

export function useOrders(filters?: OrderFilters) {
  const params = new URLSearchParams();
  if (filters?.status && filters.status !== "all") params.set("status", filters.status);
  if (filters?.page) params.set("page", String(filters.page));
  if (filters?.limit) params.set("limit", String(filters.limit));
  const qs = params.toString();

  return useQuery<OrdersResponse>({
    queryKey: ["orders", filters],
    queryFn: () => fetchOrdersWithPagination(`/api/orders${qs ? `?${qs}` : ""}`),
    refetchInterval: 5000,
  });
}

export function useOrder(id: string) {
  return useQuery({
    queryKey: ["orders", id],
    queryFn: () => apiFetch(`/api/orders/${id}`),
    enabled: !!id,
  });
}

export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) =>
      apiFetch("/api/orders", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      // Un pedido con mesa OCUPA esa mesa y abre su visita en el servidor. Sin
      // invalidar aquí, el plano del salón y el selector de mesa del POS seguían
      // mostrándola libre hasta el siguiente refresco, y el mozo la ofrecía dos
      // veces.
      qc.invalidateQueries({ queryKey: ["tables"] });
      qc.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}

export function useUpdateOrderStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiFetch(`/api/orders/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["kitchen"] });
    },
  });
}

export function useUpdateOrderItemStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      orderId,
      itemId,
      status,
    }: {
      orderId: string;
      itemId: string;
      status: string;
    }) =>
      apiFetch(`/api/orders/${orderId}/items/${itemId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["orders"] }),
  });
}
