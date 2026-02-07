"use client";

import { useMemo, useState } from "react";
import { Button } from "@restai/ui/components/button";
import { DatePicker } from "@restai/ui/components/date-picker";
import { Label } from "@restai/ui/components/label";
import { RefreshCw } from "lucide-react";
import { useSalesReport, useTopItems } from "@/hooks/use-reports";
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

export default function ReportsPage() {
  const defaults = useMemo(() => getDefaultDates(), []);
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);

  const {
    data: salesData,
    isLoading: salesLoading,
    error: salesError,
    refetch: refetchSales,
  } = useSalesReport(startDate, endDate);

  const {
    data: topItemsData,
    isLoading: topItemsLoading,
    error: topItemsError,
    refetch: refetchTopItems,
  } = useTopItems(startDate, endDate, 10);

  const days: any[] = salesData?.days || [];
  const paymentMethods: any[] = (salesData?.paymentMethods || []).map((pm: any) => ({
    ...pm,
    name: METHOD_LABELS[pm.name] || pm.name,
  }));
  const topItems: any[] = topItemsData || [];

  const totalRevenue = salesData?.totalRevenue || 0;
  const totalOrders = salesData?.totalOrders || 0;
  const totalTax = salesData?.totalTax || 0;
  const avgOrder = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

  const error = salesError || topItemsError;

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Reportes</h1>
        </div>
        <div className="p-4 rounded-lg border border-destructive/50 bg-destructive/5 flex items-center justify-between">
          <p className="text-sm text-destructive">Error al cargar reportes: {(error as Error).message}</p>
          <Button variant="outline" size="sm" onClick={() => { refetchSales(); refetchTopItems(); }}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  const isLoading = salesLoading || topItemsLoading;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Reportes</h1>
          <p className="text-muted-foreground">Analisis de ventas y productos</p>
        </div>
        <div className="flex items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Desde</Label>
            <DatePicker
              value={startDate}
              onChange={(d) => setStartDate(d ?? "")}
              className="w-[180px]"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Hasta</Label>
            <DatePicker
              value={endDate}
              onChange={(d) => setEndDate(d ?? "")}
              className="w-[180px]"
            />
          </div>
        </div>
      </div>

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
