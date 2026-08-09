"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiFetchWithMeta } from "@/lib/fetcher";

interface OrderFilters {
  status?: string;
  /** `open` = el servicio en curso; `closed` = el historial. */
  scope?: "open" | "closed";
  /** Búsqueda REAL, en toda la sede. Antes solo filtraba la página abierta. */
  q?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface Summary {
  /** Lo que suman las órdenes con los filtros puestos, en céntimos. */
  total_amount: number;
  /** El servidor recortó la lista. Hay que DECIRLO, no callarlo. */
  truncated: boolean;
}

interface OrdersResponse {
  orders: any[];
  pagination: Pagination;
  summary: Summary;
}

/** Respuesta cruda de GET /api/orders: la paginación viaja al nivel raíz. */
interface OrdersEnvelope {
  data: any[] | null;
  pagination?: Pagination;
  summary?: Summary;
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
    summary: json.summary ?? { total_amount: 0, truncated: false },
  };
}

export function useOrders(filters?: OrderFilters) {
  const params = new URLSearchParams();
  if (filters?.status && filters.status !== "all") params.set("status", filters.status);
  if (filters?.scope) params.set("scope", filters.scope);
  if (filters?.q) params.set("q", filters.q);
  if (filters?.from) params.set("from", filters.from);
  if (filters?.to) params.set("to", filters.to);
  if (filters?.page) params.set("page", String(filters.page));
  if (filters?.limit) params.set("limit", String(filters.limit));
  const qs = params.toString();

  return useQuery<OrdersResponse>({
    queryKey: ["orders", filters],
    queryFn: () => fetchOrdersWithPagination(`/api/orders${qs ? `?${qs}` : ""}`),
    /*
      El servicio en curso se refresca solo; el historial no se mueve.
      Resondear una consulta de hace tres semanas cada cinco segundos es
      trabajo para el servidor y batería para nadie.
    */
    refetchInterval: filters?.scope === "closed" ? false : 5000,
    /*
      Sin filtros no se pregunta nada.

      Quien llama usa `undefined` para decir "ahora mismo no me hace falta" —la
      pantalla de órdenes lo hace con el recuento de abiertas mientras ya está
      mirando las abiertas—. Sin esto, `useOrders()` pediría la sede entera sin
      paginar cada cinco segundos.
    */
    enabled: filters !== undefined,
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
