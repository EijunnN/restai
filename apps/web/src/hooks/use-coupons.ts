"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/fetcher";

export function useCoupons(filters?: { status?: string; type?: string }) {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.type) params.set("type", filters.type);
  const qs = params.toString();
  return useQuery({
    queryKey: ["coupons", filters],
    queryFn: () => apiFetch(`/api/coupons${qs ? `?${qs}` : ""}`),
  });
}

export function useCreateCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) =>
      apiFetch("/api/coupons", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coupons"] }),
  });
}

// Bulk-generate a batch of coupons (POST /api/coupons/bulk). The server
// generates `count` coupons sharing the supplied prefix/type/discount config,
// groups them under a single batch_id, and returns the created batch. The
// resolved value is whatever the endpoint returns in `data` (e.g.
// { batch_id, count, coupons: [...] }) — the UI reads it defensively.
export function useBulkCreateCoupons() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) =>
      apiFetch("/api/coupons/bulk", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coupons"] }),
  });
}

export function useUpdateCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: any) =>
      apiFetch(`/api/coupons/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coupons"] }),
  });
}

export function useDeleteCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/coupons/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coupons"] }),
  });
}

export function useValidateCoupon() {
  return useMutation({
    mutationFn: (code: string) =>
      apiFetch("/api/coupons/validate", {
        method: "POST",
        body: JSON.stringify({ code }),
      }),
  });
}

export function useCouponAssignments(couponId: string) {
  return useQuery({
    queryKey: ["coupons", couponId, "assignments"],
    queryFn: () => apiFetch(`/api/coupons/${couponId}/assignments`),
    enabled: !!couponId,
  });
}

export function useAssignCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { couponId: string; customerIds: string[] }) =>
      apiFetch("/api/coupons/assign", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coupons"] }),
  });
}
