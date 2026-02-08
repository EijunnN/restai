"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/fetcher";

export function usePayments() {
  return useQuery({
    queryKey: ["payments"],
    queryFn: () => apiFetch("/api/payments"),
  });
}

export function useCreatePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) =>
      apiFetch("/api/payments", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}

export function usePaymentSummary() {
  return useQuery({
    queryKey: ["payments", "summary"],
    queryFn: () => apiFetch("/api/payments/summary"),
  });
}

export function useUnpaidOrders() {
  return useQuery({
    queryKey: ["payments", "unpaid-orders"],
    queryFn: () => apiFetch("/api/payments/unpaid-orders"),
  });
}

export function useInvoices() {
  return useQuery({
    queryKey: ["invoices"],
    queryFn: () => apiFetch("/api/invoices"),
  });
}

export function useCreateInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) =>
      apiFetch("/api/invoices", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoices"] }),
  });
}
