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

export function useLoyaltyAnalytics() {
  return useQuery({
    queryKey: ["loyalty", "analytics"],
    queryFn: () => apiFetch("/api/loyalty/analytics"),
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

export function useUpdateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: any) =>
      apiFetch(`/api/loyalty/customers/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["loyalty"] }),
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

export function useAdjustPoints() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, amount, reason }: { id: string; amount: number; reason: string }) =>
      apiFetch(`/api/loyalty/customers/${id}/adjust-points`, {
        method: "POST",
        body: JSON.stringify({ amount, reason }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["loyalty"] }),
  });
}

export function useMergeCustomers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, sourceCustomerId }: { id: string; sourceCustomerId: string }) =>
      apiFetch(`/api/loyalty/customers/${id}/merge`, {
        method: "POST",
        body: JSON.stringify({ sourceCustomerId }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["loyalty"] }),
  });
}

// ---------------------------------------------------------------------------
// Ley 29733 (Peru data-protection) — export & anonymize
// ---------------------------------------------------------------------------

/**
 * Exports a single customer's personal data (GET /export) and triggers a
 * client-side JSON download. Used to satisfy the data-portability /
 * right-to-access obligations under Ley 29733.
 */
export function useExportCustomer() {
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name?: string }) => {
      const data = await apiFetch(`/api/loyalty/customers/${id}/export`);
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const slug =
        (name || id)
          .toLowerCase()
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "") || id;
      const a = document.createElement("a");
      a.href = url;
      a.download = `cliente-${slug}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return data;
    },
  });
}

/**
 * Irreversibly anonymizes a customer (POST /anonymize): personal identifiers
 * are scrubbed and `anonymized_at` is stamped. Invalidates the customer cache.
 */
export function useAnonymizeCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/loyalty/customers/${id}/anonymize`, { method: "POST" }),
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
