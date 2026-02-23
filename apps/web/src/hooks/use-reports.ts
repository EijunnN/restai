"use client";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/fetcher";

export interface SalesReportDay {
  date: string;
  orders: number;
  revenue: number;
}

export interface PaymentMethodShare {
  name: string;
  value: number;
}

export interface SalesReportData {
  totalOrders: number;
  totalRevenue: number;
  totalTax: number;
  totalDiscount: number;
  days: SalesReportDay[];
  paymentMethods: PaymentMethodShare[];
}

export interface TopItemReport {
  name: string;
  totalQuantity: number;
  totalRevenue: number;
}

export function useSalesReport(startDate?: string, endDate?: string) {
  const params = new URLSearchParams();
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  const qs = params.toString();

  return useQuery<SalesReportData>({
    queryKey: ["reports", "sales", startDate, endDate],
    queryFn: () => apiFetch<SalesReportData>(`/api/reports/sales${qs ? `?${qs}` : ""}`),
    enabled: !!startDate && !!endDate,
  });
}

export function useTopItems(startDate?: string, endDate?: string, limit?: number) {
  const params = new URLSearchParams();
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  if (limit) params.set("limit", String(limit));
  const qs = params.toString();

  return useQuery<TopItemReport[]>({
    queryKey: ["reports", "top-items", startDate, endDate, limit],
    queryFn: () =>
      apiFetch<TopItemReport[]>(`/api/reports/top-items${qs ? `?${qs}` : ""}`),
    enabled: !!startDate && !!endDate,
  });
}
