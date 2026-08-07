"use client";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/fetcher";

export interface SalesReportDay {
  date: string;
  orders: number;
  revenue: number;
}

export interface PaymentMethodShare {
  name: string;
  /** Importe cobrado por ese método, en céntimos. */
  amount: number;
  /** Porcentaje entero sobre el total cobrado. */
  value: number;
}

export interface SalesReportData {
  totalOrders: number;
  totalRevenue: number;
  totalTax: number;
  totalDiscount: number;
  days: SalesReportDay[];
  paymentMethods: PaymentMethodShare[];
}

export interface TopItemReport {
  name: string;
  totalQuantity: number;
  totalRevenue: number;
}

function rangeQuery(startDate?: string, endDate?: string, extra?: Record<string, string>) {
  const params = new URLSearchParams();
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  for (const [key, value] of Object.entries(extra ?? {})) params.set(key, value);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useSalesReport(startDate?: string, endDate?: string) {
  return useQuery<SalesReportData>({
    queryKey: ["reports", "sales", startDate, endDate],
    queryFn: () => apiFetch<SalesReportData>(`/api/reports/sales${rangeQuery(startDate, endDate)}`),
    enabled: !!startDate && !!endDate,
  });
}

export function useTopItems(startDate?: string, endDate?: string, limit?: number) {
  const extra = limit ? { limit: String(limit) } : undefined;

  return useQuery<TopItemReport[]>({
    queryKey: ["reports", "top-items", startDate, endDate, limit],
    queryFn: () =>
      apiFetch<TopItemReport[]>(`/api/reports/top-items${rangeQuery(startDate, endDate, extra)}`),
    enabled: !!startDate && !!endDate,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Ventas por empleado (GET /api/reports/staff-sales)
// ─────────────────────────────────────────────────────────────────────────────

export interface StaffWaiterRow {
  /** null = pedido levantado por el propio comensal desde el QR. */
  userId: string | null;
  name: string;
  role: string | null;
  totalOrders: number;
  totalRevenue: number;
  averageOrderValue: number;
}

export interface StaffCashierMethod {
  method: string;
  count: number;
  amount: number;
}

export interface StaffCashierRow {
  userId: string | null;
  name: string;
  role: string | null;
  paymentsCount: number;
  totalCollected: number;
  totalTips: number;
  byMethod: StaffCashierMethod[];
}

export interface StaffVoidRow {
  userId: string | null;
  name: string;
  role: string | null;
  count: number;
  amount: number;
}

export interface StaffSalesData {
  startDate: string;
  endDate: string;
  waiters: StaffWaiterRow[];
  cashiers: StaffCashierRow[];
  voids: StaffVoidRow[];
  totals: {
    totalOrders: number;
    totalRevenue: number;
    totalCollected: number;
    totalTips: number;
    voidedAmount: number;
  };
}

/** Ventas por mozo y cobros por cajero de la sede activa. */
export function useStaffSales(startDate?: string, endDate?: string, enabled = true) {
  return useQuery<StaffSalesData>({
    queryKey: ["reports", "staff-sales", startDate, endDate],
    queryFn: () =>
      apiFetch<StaffSalesData>(`/api/reports/staff-sales${rangeQuery(startDate, endDate)}`),
    enabled: enabled && !!startDate && !!endDate,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Consolidado multi-sede (GET /api/reports/org/sales)
// ─────────────────────────────────────────────────────────────────────────────

export interface OrgBranchSalesRow {
  branchId: string;
  branchName: string;
  branchSlug: string;
  isActive: boolean;
  totalOrders: number;
  totalRevenue: number;
  totalTax: number;
  totalDiscount: number;
  averageOrderValue: number;
}

export interface OrgSalesData {
  startDate: string;
  endDate: string;
  branches: OrgBranchSalesRow[];
  totals: {
    branches: number;
    totalOrders: number;
    totalRevenue: number;
    totalTax: number;
    totalDiscount: number;
    averageOrderValue: number;
  };
  paymentMethods: PaymentMethodShare[];
}

/**
 * Consolidado de todas las sedes accesibles.
 *
 * Va SIN la cabecera `x-branch-id` a propósito: la pregunta es "¿cómo va la
 * cadena?", no "¿cómo va esta sede?". Si se mandara, el backend la ignora para
 * el agrupado, pero mejor no mentir sobre la intención de la llamada.
 */
export function useOrgSales(startDate?: string, endDate?: string, enabled = true) {
  return useQuery<OrgSalesData>({
    queryKey: ["reports", "org-sales", startDate, endDate],
    queryFn: () =>
      apiFetch<OrgSalesData>(`/api/reports/org/sales${rangeQuery(startDate, endDate)}`, {
        includeBranchHeader: false,
      }),
    enabled: enabled && !!startDate && !!endDate,
  });
}
