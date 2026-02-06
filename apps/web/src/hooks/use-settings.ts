"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/fetcher";

export function useOrgSettings() {
  return useQuery({
    queryKey: ["settings", "org"],
    queryFn: () => apiFetch("/api/settings/org"),
  });
}

export function useBranchSettings() {
  return useQuery({
    queryKey: ["settings", "branch"],
    queryFn: () => apiFetch("/api/settings/branch"),
  });
}

export function useUpdateOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => apiFetch("/api/settings/org", {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings", "org"] }),
  });
}

export function useUpdateBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => apiFetch("/api/settings/branch", {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings", "branch"] }),
  });
}

export function useBranches() {
  return useQuery({
    queryKey: ["branches"],
    queryFn: () => apiFetch<{ id: string; name: string; slug: string; address: string | null }[]>("/api/branches"),
  });
}

export function useCreateBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; slug: string; address?: string; phone?: string; timezone?: string; currency?: string; taxRate?: number }) =>
      apiFetch("/api/branches", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["branches"] }),
  });
}

export function useUpdateBranchById() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; name?: string; slug?: string; address?: string; phone?: string }) =>
      apiFetch(`/api/branches/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["branches"] }),
  });
}
