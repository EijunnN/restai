"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/fetcher";

export function useKitchenOrders() {
  return useQuery({
    queryKey: ["kitchen", "orders"],
    queryFn: () => apiFetch("/api/kitchen/orders"),
    refetchInterval: 30000,
  });
}

export function useUpdateKitchenItemStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiFetch(`/api/kitchen/items/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kitchen"] }),
  });
}
