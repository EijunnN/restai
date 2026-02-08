"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/fetcher";

export function useLoyaltyStats() {
  return useQuery({
    queryKey: ["loyalty", "stats"],
    queryFn: () => apiFetch("/api/loyalty/stats"),
  });
}

export function useLoyaltyCustomers(search?: string, page = 1) {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  params.set("page", String(page));
  const qs = params.toString();
  return useQuery({
    queryKey: ["loyalty", "customers", search, page],
    queryFn: () => apiFetch(`/api/loyalty/customers?${qs}`),
  });
}

export function useLoyaltyCustomer(id: string) {
  return useQuery({
    queryKey: ["loyalty", "customers", id],
    queryFn: () => apiFetch(`/api/loyalty/customers/${id}`),
    enabled: !!id,
  });
}

export function useCustomerTransactions(id: string) {
  return useQuery({
    queryKey: ["loyalty", "customers", id, "transactions"],
    queryFn: () => apiFetch(`/api/loyalty/customers/${id}/transactions`),
    enabled: !!id,
  });
}

export function useLoyaltyPrograms() {
  return useQuery({
    queryKey: ["loyalty", "programs"],
    queryFn: () => apiFetch("/api/loyalty/programs"),
  });
}

export function useLoyaltyRewards() {
  return useQuery({
    queryKey: ["loyalty", "rewards"],
    queryFn: () => apiFetch("/api/loyalty/rewards"),
  });
}

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => apiFetch("/api/loyalty/customers", {
      method: "POST",
      body: JSON.stringify(data),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["loyalty", "customers"] }),
  });
}

export function useDeleteCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/loyalty/customers/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["loyalty"] }),
  });
}

export function useCreateProgram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => apiFetch("/api/loyalty/programs", {
      method: "POST",
      body: JSON.stringify(data),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["loyalty"] }),
  });
}

export function useCreateReward() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => apiFetch("/api/loyalty/rewards", {
      method: "POST",
      body: JSON.stringify(data),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["loyalty"] }),
  });
}

export function useUpdateReward() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: any) =>
      apiFetch(`/api/loyalty/rewards/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["loyalty"] }),
  });
}

export function useDeleteReward() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/loyalty/rewards/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["loyalty"] }),
  });
}

export function useRedeemReward() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rewardId, customerLoyaltyId }: { rewardId: string; customerLoyaltyId: string }) =>
      apiFetch(`/api/loyalty/rewards/${rewardId}/redeem`, {
        method: "POST",
        body: JSON.stringify({ customerLoyaltyId }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["loyalty"] }),
  });
}

export function useUpdateProgram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: any) =>
      apiFetch(`/api/loyalty/programs/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["loyalty"] }),
  });
}

export function useDeleteProgram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/loyalty/programs/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["loyalty"] }),
  });
}

export function useCreateTier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) =>
      apiFetch("/api/loyalty/tiers", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["loyalty", "programs"] }),
  });
}

export function useUpdateTier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: any) =>
      apiFetch(`/api/loyalty/tiers/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["loyalty", "programs"] }),
  });
}

export function useDeleteTier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/loyalty/tiers/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["loyalty", "programs"] }),
  });
}
