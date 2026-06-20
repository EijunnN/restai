"use client";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/fetcher";

// Shape the dashboard page consumes.
export interface DashboardStats {
  ordersToday: number;
  revenueToday: number;
  averageOrderValue: number;
  activeOrders: number;
  tablesOccupied: string; // "occupied/total"
}

// Raw shape returned by GET /api/reports/dashboard.
interface DashboardApiResponse {
  totalOrders?: number;
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
    // Map the API response to the field names the page expects so the
    // dashboard no longer renders all-zeros.
    select: (data) => ({
      ordersToday: data.totalOrders ?? 0,
      revenueToday: data.totalRevenue ?? 0,
      averageOrderValue: data.averageOrderValue ?? 0,
      activeOrders: data.activeOrders ?? 0,
      tablesOccupied: `${data.occupiedTables ?? 0}/${data.totalTables ?? 0}`,
    }),
  });
}

export function useRecentOrders() {
  return useQuery({
    queryKey: ["orders", "recent"],
    queryFn: () => apiFetch("/api/orders?limit=5&sort=recent"),
    refetchInterval: 15000,
  });
}
