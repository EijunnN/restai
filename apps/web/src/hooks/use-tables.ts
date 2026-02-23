"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/fetcher";

// --- Spaces ---

export function useSpaces() {
  return useQuery({
    queryKey: ["spaces"],
    queryFn: () => apiFetch("/api/spaces"),
  });
}

export function useCreateSpace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; description?: string; floorNumber?: number; sortOrder?: number }) =>
      apiFetch("/api/spaces", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["spaces"] }),
  });
}

export function useUpdateSpace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; name?: string; description?: string; floorNumber?: number; sortOrder?: number; isActive?: boolean }) =>
      apiFetch(`/api/spaces/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["spaces"] }),
  });
}

export function useDeleteSpace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/spaces/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["spaces"] }),
  });
}

// --- Tables ---

export function useTables(spaceId?: string) {
  return useQuery({
    queryKey: ["tables", spaceId],
    queryFn: () => {
      const params = spaceId ? `?spaceId=${spaceId}` : "";
      return apiFetch(`/api/tables${params}`);
    },
  });
}

export function useCreateTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { number: number; capacity?: number; spaceId?: string }) =>
      apiFetch("/api/tables", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tables"] }),
  });
}

export function useUpdateTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; capacity?: number; spaceId?: string | null }) =>
      apiFetch(`/api/tables/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tables"] }),
  });
}

export function useDeleteTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/tables/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tables"] }),
  });
}

export function useUpdateTablePosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, x, y }: { id: string; x: number; y: number }) =>
      apiFetch(`/api/tables/${id}/position`, {
        method: "PATCH",
        body: JSON.stringify({ x, y }),
      }),
    onMutate: async ({ id, x, y }) => {
      await qc.cancelQueries({ queryKey: ["tables"] });
      const previous = qc.getQueryData(["tables"]);
      qc.setQueryData(["tables"], (old: any) => {
        if (!old?.tables) return old;
        return {
          ...old,
          tables: old.tables.map((t: any) =>
            t.id === id ? { ...t, position_x: x, position_y: y } : t
          ),
        };
      });
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        qc.setQueryData(["tables"], context.previous);
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["tables"] }),
  });
}

export function useUpdateTableStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiFetch(`/api/tables/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tables"] }),
  });
}

// --- Sessions ---

export function useSessions(status?: string) {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  const qs = params.toString();
  return useQuery({
    queryKey: ["sessions", status],
    queryFn: () => apiFetch(`/api/tables/sessions${qs ? `?${qs}` : ""}`),
    refetchInterval: 5000,
  });
}

// --- Pending Sessions ---

export function usePendingSessions() {
  return useQuery({
    queryKey: ["tables", "sessions", "pending"],
    queryFn: () => apiFetch("/api/tables/sessions/pending"),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnReconnect: true,
  });
}

export function useApproveSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/tables/sessions/${id}/approve`, { method: "PATCH" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tables"] });
      qc.invalidateQueries({ queryKey: ["sessions"] });
      qc.invalidateQueries({ queryKey: ["tables", "sessions", "pending"] });
    },
  });
}

export function useRejectSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/tables/sessions/${id}/reject`, { method: "PATCH" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tables"] });
      qc.invalidateQueries({ queryKey: ["sessions"] });
      qc.invalidateQueries({ queryKey: ["tables", "sessions", "pending"] });
    },
  });
}

export function useEndSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/tables/sessions/${id}/end`, { method: "PATCH" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tables"] });
      qc.invalidateQueries({ queryKey: ["sessions"] });
      qc.invalidateQueries({ queryKey: ["tables", "sessions", "pending"] });
    },
  });
}

// --- Table History ---

export function useTableHistory(tableId: string | null, from?: string, to?: string) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  return useQuery({
    queryKey: ["tables", tableId, "history", from, to],
    queryFn: () => apiFetch(`/api/tables/${tableId}/history${qs ? `?${qs}` : ""}`),
    enabled: !!tableId,
  });
}

// --- Table Assignments ---

export function useTableAssignments(tableId: string | null) {
  return useQuery({
    queryKey: ["tables", tableId, "assignments"],
    queryFn: () => apiFetch(`/api/tables/${tableId}/assignments`),
    enabled: !!tableId,
  });
}

export function useAssignWaiter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tableId, userId }: { tableId: string; userId: string }) =>
      apiFetch(`/api/tables/${tableId}/assignments`, {
        method: "POST",
        body: JSON.stringify({ userId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tables"] });
    },
  });
}

export function useRemoveAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tableId, userId }: { tableId: string; userId: string }) =>
      apiFetch(`/api/tables/${tableId}/assignments/${userId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tables"] });
    },
  });
}

export function useMyAssignedTables() {
  return useQuery({
    queryKey: ["tables", "my-assignments"],
    queryFn: () => apiFetch<{ table_id: string; table_number: number }[]>("/api/tables/my-assignments"),
  });
}
