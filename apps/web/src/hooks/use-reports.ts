"use client";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/fetcher";

export function useSalesReport(startDate?: string, endDate?: string) {
  const params = new URLSearchParams();
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  const qs = params.toString();

  return useQuery({
    queryKey: ["reports", "sales", startDate, endDate],
    queryFn: () => apiFetch(`/api/reports/sales${qs ? `?${qs}` : ""}`),
    enabled: !!startDate && !!endDate,
  });
}

export function useTopItems(startDate?: string, endDate?: string, limit?: number) {
  const params = new URLSearchParams();
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  if (limit) params.set("limit", String(limit));
  const qs = params.toString();

  return useQuery({
    queryKey: ["reports", "top-items", startDate, endDate, limit],
    queryFn: () => apiFetch(`/api/reports/top-items${qs ? `?${qs}` : ""}`),
    enabled: !!startDate && !!endDate,
  });
}
