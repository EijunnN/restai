"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/fetcher";

export function useInventoryItems() {
  return useQuery({
    queryKey: ["inventory", "items"],
    queryFn: () => apiFetch("/api/inventory/items"),
  });
}

export function useCreateInventoryItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) =>
      apiFetch("/api/inventory/items", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inventory"] }),
  });
}

export function useCreateMovement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) =>
      apiFetch("/api/inventory/movements", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inventory"] }),
  });
}

export function useInventoryMovements(itemId?: string) {
  return useQuery({
    queryKey: ["inventory", "movements", itemId],
    queryFn: () =>
      apiFetch(`/api/inventory/movements${itemId ? `?itemId=${itemId}` : ""}`),
  });
}

export function useInventoryAlerts() {
  return useQuery({
    queryKey: ["inventory", "alerts"],
    queryFn: () => apiFetch("/api/inventory/alerts"),
  });
}

export function useRecipe(menuItemId: string) {
  return useQuery({
    queryKey: ["inventory", "recipes", menuItemId],
    queryFn: () => apiFetch(`/api/inventory/recipes/${menuItemId}`),
    enabled: !!menuItemId,
  });
}

export function useCreateRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) =>
      apiFetch("/api/inventory/recipes", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inventory"] }),
  });
}
