"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/fetcher";

export function useStaffList() {
  return useQuery({
    queryKey: ["staff"],
    queryFn: () => apiFetch("/api/staff"),
  });
}

export function useCreateStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      email: string;
      password: string;
      name: string;
      role: string;
      branchIds: string[];
    }) => apiFetch("/api/staff", {
      method: "POST",
      body: JSON.stringify(data),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff"] }),
  });
}

export function useUpdateStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; name?: string; role?: string; isActive?: boolean; branchIds?: string[] }) =>
      apiFetch(`/api/staff/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff"] }),
  });
}

export function useShifts() {
  return useQuery({
    queryKey: ["staff", "shifts"],
    queryFn: () => apiFetch("/api/staff/shifts"),
  });
}

export function useCreateShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data?: { notes?: string }) =>
      apiFetch("/api/staff/shifts", {
        method: "POST",
        body: JSON.stringify(data || {}),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff", "shifts"] }),
  });
}

export function useEndShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (shiftId: string) =>
      apiFetch(`/api/staff/shifts/${shiftId}`, {
        method: "PATCH",
        body: JSON.stringify({}),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff", "shifts"] }),
  });
}
