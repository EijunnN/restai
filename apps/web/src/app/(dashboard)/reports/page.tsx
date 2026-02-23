"use client";

import { useMemo, useState } from "react";
import { Button } from "@restai/ui/components/button";
import { DatePicker } from "@restai/ui/components/date-picker";
import { Label } from "@restai/ui/components/label";
import { Check, RefreshCw } from "lucide-react";
import {
  useSalesReport,
  useTopItems,
  type SalesReportDay,
  type PaymentMethodShare,
  type TopItemReport,
} from "@/hooks/use-reports";
import { ReportStats } from "./_components/report-stats";
import { SalesChart } from "./_components/sales-chart";
import { PaymentMethodsChart } from "./_components/payment-methods-chart";
import { TopItemsList } from "./_components/top-items-list";

const METHOD_LABELS: Record<string, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  yape: "Yape",
  plin: "Plin",
  transfer: "Transferencia",
  other: "Otro",
};

function getDefaultDates() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 7);
  return {
    start: start.toISOString().split("T")[0],
    end: end.toISOString().split("T")[0],
  };
}

function getTodayRange() {
  const today = new Date().toISOString().split("T")[0];
  return { start: today, end: today };
}

function getLastDaysRange(days: number) {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (days - 1));
  return {
    start: start.toISOString().split("T")[0],
    end: end.toISOString().split("T")[0],
  };
}

function getCurrentMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    start: start.toISOString().split("T")[0],
    end: now.toISOString().split("T")[0],
  };
}

export default function ReportsPage() {
  const defaults = useMemo(() => getDefaultDates(), []);
  const [startDate, setStartDate] = useState<string>(defaults.start);
  const [endDate, setEndDate] = useState<string>(defaults.end);
  const [draftStartDate, setDraftStartDate] = useState<string>(defaults.start);
  const [draftEndDate, setDraftEndDate] = useState<string>(defaults.end);

  const {
    data: salesData,
    isLoading: salesLoading,
    isFetching: salesFetching,
    error: salesError,
    refetch: refetchSales,
  } = useSalesReport(startDate, endDate);

  const {
    data: topItemsData,
    isLoading: topItemsLoading,
    isFetching: topItemsFetching,
    error: topItemsError,
    refetch: refetchTopItems,
  } = useTopItems(startDate, endDate, 10);

  const days: SalesReportDay[] = salesData?.days ?? [];
  const paymentMethods: PaymentMethodShare[] = (salesData?.paymentMethods ?? []).map((pm) => ({
    ...pm,
    name: METHOD_LABELS[pm.name] || pm.name,
  }));
  const topItems: TopItemReport[] = topItemsData ?? [];

  const totalRevenue = salesData?.totalRevenue || 0;
  const totalOrders = salesData?.totalOrders || 0;
  const totalTax = salesData?.totalTax || 0;
  const avgOrder = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

  const error = salesError || topItemsError;
  const isLoading = salesLoading || topItemsLoading;
  const isRefreshing = salesFetching || topItemsFetching;
  const hasPendingDateChanges =
    draftStartDate !== startDate || draftEndDate !== endDate;
  const invalidDateRange =
    !!draftStartDate && !!draftEndDate && draftStartDate > draftEndDate;

  const applyRange = (range: { start: string; end: string }) => {
    setDraftStartDate(range.start);
    setDraftEndDate(range.end);
    setStartDate(range.start);
    setEndDate(range.end);
  };

  const applyFilters = () => {
    if (invalidDateRange || !hasPendingDateChanges) return;
    setStartDate(draftStartDate);
    setEndDate(draftEndDate);
  };

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Reportes</h1>
        </div>
        <div className="p-4 rounded-lg border border-destructive/50 bg-destructive/5 flex items-center justify-between">
          <p className="text-sm text-destructive">Error al cargar reportes: {(error as Error).message}</p>
          <Button
            variant="outline"
            size="sm"
            disabled={isRefreshing}
            onClick={() => {
              refetchSales();
              refetchTopItems();
            }}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`} />
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Reportes</h1>
          <p className="text-muted-foreground">Analisis de ventas y productos</p>
        </div>
        <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4">
          <div className="space-y-2 min-w-[220px]">
            <Label className="text-xs text-muted-foreground block pl-0.5">Desde</Label>
            <DatePicker
              value={draftStartDate}
              onChange={(d) => setDraftStartDate(d ?? "")}
              className="w-[220px]"
            />
          </div>
          <div className="space-y-2 min-w-[220px]">
            <Label className="text-xs text-muted-foreground block pl-0.5">Hasta</Label>
            <DatePicker
              value={draftEndDate}
              onChange={(d) => setDraftEndDate(d ?? "")}
              className="w-[220px]"
            />
          </div>
          <Button
            size="sm"
            className="h-9 active:translate-y-px active:scale-[0.98]"
            disabled={!hasPendingDateChanges || invalidDateRange || isRefreshing}
            onClick={applyFilters}
          >
            <Check className="h-4 w-4" />
            Aplicar
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 active:translate-y-px active:scale-[0.98]"
            disabled={isRefreshing}
            onClick={() => {
              refetchSales();
              refetchTopItems();
            }}
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 active:translate-y-px active:scale-[0.98]"
          onClick={() => applyRange(getTodayRange())}
        >
          Hoy
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 active:translate-y-px active:scale-[0.98]"
          onClick={() => applyRange(getLastDaysRange(7))}
        >
          Ultimos 7 dias
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 active:translate-y-px active:scale-[0.98]"
          onClick={() => applyRange(getLastDaysRange(30))}
        >
          Ultimos 30 dias
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 active:translate-y-px active:scale-[0.98]"
          onClick={() => applyRange(getCurrentMonthRange())}
        >
          Este mes
        </Button>
        {isRefreshing && (
          <span className="text-xs text-muted-foreground inline-flex items-center gap-2">
            <span className="h-1.5 w-6 rounded-full bg-muted-foreground/40 animate-pulse" />
            Actualizando reportes...
          </span>
        )}
      </div>
      {invalidDateRange && (
        <p className="text-sm text-destructive">
          El rango de fechas no es valido: "Desde" debe ser menor o igual a "Hasta".
        </p>
      )}

      <ReportStats
        totalOrders={totalOrders}
        totalRevenue={totalRevenue}
        avgOrder={avgOrder}
        totalTax={totalTax}
        isLoading={isLoading}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <SalesChart days={days} isLoading={salesLoading} />
        <PaymentMethodsChart paymentMethods={paymentMethods} isLoading={salesLoading} />
      </div>

      <TopItemsList topItems={topItems} isLoading={topItemsLoading} />
    </div>
  );
}
