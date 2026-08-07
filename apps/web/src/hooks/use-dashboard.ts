"use client";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/fetcher";

/**
 * Cifras del día que pinta el panel. Todo el dinero va en CÉNTIMOS.
 *
 * OJO con la diferencia entre `totalOrders` y `completedOrders`: son dos
 * números distintos a propósito y el panel tiene que explicarlo, porque un
 * dueño que ve "18 órdenes" y "S/ 420" arriba y luego 12 órdenes en el reporte
 * de ventas concluye que la aplicación miente.
 */
export interface DashboardStats {
  /** Órdenes del día salvo las anuladas: volumen de trabajo del local. */
  totalOrders: number;
  /** Órdenes completadas: las únicas que generan ingreso. */
  completedOrders: number;
  /** Ingresos del día (solo órdenes completadas), en céntimos. */
  revenueToday: number;
  /** Ingresos ÷ órdenes completadas, en céntimos. Lo calcula la API. */
  averageOrderValue: number;
  /** En cola, confirmadas, en preparación o listas. */
  activeOrders: number;
  occupiedTables: number;
  totalTables: number;
}

/** Forma cruda de GET /api/reports/dashboard. */
interface DashboardApiResponse {
  totalOrders?: number;
  completedOrders?: number;
  totalRevenue?: number;
  averageOrderValue?: number;
  activeOrders?: number;
  occupiedTables?: number;
  totalTables?: number;
}

export function useDashboardStats() {
  return useQuery<DashboardApiResponse, Error, DashboardStats>({
    queryKey: ["dashboard", "stats"],
    queryFn: () => apiFetch<DashboardApiResponse>("/api/reports/dashboard"),
    refetchInterval: 30000,
    // Se traducen los nombres de la API a los que usa la pantalla, con ceros
    // por defecto: un campo ausente no puede dejar "NaN" en un KPI.
    select: (data) => ({
      totalOrders: data.totalOrders ?? 0,
      completedOrders: data.completedOrders ?? 0,
      revenueToday: data.totalRevenue ?? 0,
      averageOrderValue: data.averageOrderValue ?? 0,
      activeOrders: data.activeOrders ?? 0,
      occupiedTables: data.occupiedTables ?? 0,
      totalTables: data.totalTables ?? 0,
    }),
  });
}

/**
 * Fila de "Órdenes recientes".
 *
 * `table_number` lo resuelve la API con un JOIN contra la visita de mesa
 * (GET /api/orders): el panel lo recibía y no lo pintaba, así que la lista no
 * servía para nada operativo.
 */
export interface RecentOrder {
  id: string;
  order_number: string;
  status: string;
  /** dine_in | takeout | delivery */
  type: string;
  total: number;
  table_number: number | null;
  customer_name: string | null;
  created_at: string;
  payment_status: "paid" | "partial" | "unpaid";
}

export function useRecentOrders(limit = 6) {
  return useQuery<RecentOrder[]>({
    queryKey: ["orders", "recent", limit],
    queryFn: () => apiFetch<RecentOrder[]>(`/api/orders?limit=${limit}`),
    refetchInterval: 15000,
  });
}

/**
 * Artículo de inventario por debajo de su mínimo (GET /api/inventory/alerts).
 *
 * Las columnas son `numeric` en Postgres, así que llegan como cadena: hay que
 * convertirlas con Number() antes de compararlas o de pintarlas.
 */
export interface LowStockItem {
  id: string;
  name: string;
  unit: string;
  current_stock: string;
  min_stock: string;
  cost_per_unit: string | null;
}

/**
 * Aviso de stock bajo para el panel.
 *
 * Se comparte la clave de caché con la pantalla de inventario para no pedir lo
 * mismo dos veces. `enabled` permite apagarlo cuando el rol no tiene
 * `inventory:read` y la llamada devolvería un 403 inútil.
 */
export function useLowStockAlerts(enabled = true) {
  return useQuery<LowStockItem[]>({
    queryKey: ["inventory", "alerts"],
    queryFn: () => apiFetch<LowStockItem[]>("/api/inventory/alerts"),
    enabled,
    refetchInterval: 120000,
  });
}
