"use client";
import { useQuery } from "@tanstack/react-query";
import { apiFetch, apiFetchWithMeta } from "@/lib/fetcher";

export interface AuditLog {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  created_at: string;
  user_id: string | null;
  /** Snapshot: sigue siendo legible aunque el empleado ya no exista. */
  user_email: string | null;
  user_role: string | null;
  /** Del JOIN: null si el usuario fue borrado. Información de cortesía. */
  user_name: string | null;
  branch_id: string | null;
  branch_name: string | null;
}

export interface AuditFilters {
  actions: string[];
  entityTypes: string[];
  users: { id: string; email: string | null; name: string | null }[];
}

export interface AuditQuery {
  page?: number;
  limit?: number;
  action?: string;
  entityType?: string;
  userId?: string;
  startDate?: string;
  endDate?: string;
}

export function useAuditLogs(query: AuditQuery) {
  const qs = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => {
    if (v !== undefined && v !== "" && v !== null) qs.set(k, String(v));
  });
  const search = qs.toString();

  return useQuery<{
    data: AuditLog[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }>({
    queryKey: ["audit", "logs", query],
    queryFn: () => apiFetchWithMeta(`/api/audit${search ? `?${search}` : ""}`),
  });
}

/** Valores realmente presentes en la traza, para poblar los desplegables. */
export function useAuditFilters() {
  return useQuery<AuditFilters>({
    queryKey: ["audit", "filters"],
    queryFn: () => apiFetch<AuditFilters>("/api/audit/filters"),
    staleTime: 5 * 60 * 1000,
  });
}
