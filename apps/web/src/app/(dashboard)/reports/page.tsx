"use client";

import { useMemo, useState } from "react";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { Button } from "@restai/ui/components/button";
import { DatePicker } from "@restai/ui/components/date-picker";
import { Label } from "@restai/ui/components/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@restai/ui/components/tabs";
import { Check, Download, RefreshCw } from "lucide-react";
import {
  useSalesReport,
  useTopItems,
  type SalesReportDay,
  type PaymentMethodShare,
  type TopItemReport,
} from "@/hooks/use-reports";
import { useBranches } from "@/hooks/use-settings";
import { limaTodayRange, limaLastDaysRange, limaCurrentMonthRange } from "@/lib/date";
import { downloadCsv, csvMoney } from "@/lib/csv";
import { ReportStats } from "./_components/report-stats";
import { SalesChart } from "./_components/sales-chart";
import { PaymentMethodsChart } from "./_components/payment-methods-chart";
import { TopItemsList } from "./_components/top-items-list";
import { StaffSalesSection } from "./_components/staff-sales-section";
import { OrgSalesSection } from "./_components/org-sales-section";
import { methodLabel } from "./_components/method-labels";

// Todos los rangos se calculan en hora de Lima: el `toISOString()` anterior
// devolvía UTC, así que a partir de las 19:00 de Perú "Hoy" pedía el día
// siguiente y por la mañana el reporte del día anterior.
const getDefaultDates = () => limaLastDaysRange(8);
const getTodayRange = () => limaTodayRange();
const getLastDaysRange = (days: number) => limaLastDaysRange(days);
const getCurrentMonthRange = () => limaCurrentMonthRange();

type ReportTab = "sede" | "cadena";

export default function ReportsPage() {
  const defaults = useMemo(() => getDefaultDates(), []);
  const [startDate, setStartDate] = useState<string>(defaults.start);
  const [endDate, setEndDate] = useState<string>(defaults.end);
  const [draftStartDate, setDraftStartDate] = useState<string>(defaults.start);
  const [draftEndDate, setDraftEndDate] = useState<string>(defaults.end);
  const [tab, setTab] = useState<ReportTab>("sede");

  // La pestaña consolidada solo tiene sentido para quien tiene acceso a más de
  // una sede: el resto vería una tabla de una sola fila idéntica a la anterior.
  const { data: branches } = useBranches();
  const isMultiBranch = (branches?.length ?? 0) > 1;
  const activeTab: ReportTab = isMultiBranch ? tab : "sede";

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

  // "Actualizar" tiene que actualizar LO QUE SE ESTÁ VIENDO. Antes solo refrescaba
  // ventas y productos, así que en la pestaña de la cadena —y en la tabla de
  // ventas por empleado, que se pide aparte— el botón no hacía nada y el usuario
  // concluía que los datos estaban congelados. Invalidando el prefijo `reports`
  // se refresca cualquier consulta de esta pantalla, presente o futura.
  const queryClient = useQueryClient();
  const isRefreshing = useIsFetching({ queryKey: ["reports"] }) > 0;
  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["reports"] });
  };

  const days: SalesReportDay[] = salesData?.days ?? [];
  const paymentMethods: PaymentMethodShare[] = (salesData?.paymentMethods ?? []).map((pm) => ({
    ...pm,
    name: methodLabel(pm.name),
  }));
  const topItems: TopItemReport[] = topItemsData ?? [];

  const totalRevenue = salesData?.totalRevenue || 0;
  const totalOrders = salesData?.totalOrders || 0;
  const totalTax = salesData?.totalTax || 0;
  const avgOrder = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

  const branchError = salesError || topItemsError;
  const isLoading = salesLoading || topItemsLoading;
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

  const exportDailySales = () => {
    downloadCsv(
      `ventas_${startDate}_${endDate}`,
      [
        { header: "Fecha", value: (d: SalesReportDay) => d.date },
        { header: "Órdenes", value: (d: SalesReportDay) => d.orders },
        { header: "Ingresos (S/)", value: (d: SalesReportDay) => csvMoney(d.revenue) },
      ],
      days,
    );
  };

  const exportTopItems = () => {
    downloadCsv(
      `productos_${startDate}_${endDate}`,
      [
        { header: "Producto", value: (i: TopItemReport) => i.name },
        { header: "Cantidad", value: (i: TopItemReport) => i.totalQuantity },
        { header: "Ingresos (S/)", value: (i: TopItemReport) => csvMoney(i.totalRevenue) },
      ],
      topItems,
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Reportes</h1>
          <p className="text-muted-foreground">Análisis de ventas, productos y equipo</p>
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
            className="h-10 active:translate-y-px active:scale-[0.98]"
            disabled={!hasPendingDateChanges || invalidDateRange || isRefreshing}
            onClick={applyFilters}
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            Aplicar
          </Button>
          <Button
            variant="outline"
            className="h-10 active:translate-y-px active:scale-[0.98]"
            aria-label="Actualizar los reportes"
            disabled={isRefreshing}
            onClick={refreshAll}
          >
            <RefreshCw
              className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            Actualizar
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-10 active:translate-y-px active:scale-[0.98]"
          onClick={() => applyRange(getTodayRange())}
        >
          Hoy
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-10 active:translate-y-px active:scale-[0.98]"
          onClick={() => applyRange(getLastDaysRange(7))}
        >
          Últimos 7 días
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-10 active:translate-y-px active:scale-[0.98]"
          onClick={() => applyRange(getLastDaysRange(30))}
        >
          Últimos 30 días
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-10 active:translate-y-px active:scale-[0.98]"
          onClick={() => applyRange(getCurrentMonthRange())}
        >
          Este mes
        </Button>
        {isRefreshing && (
          <span className="text-xs text-muted-foreground inline-flex items-center gap-2">
            <span className="h-1.5 w-6 rounded-full bg-muted-foreground/40 animate-pulse" />
            Actualizando reportes…
          </span>
        )}
      </div>

      {invalidDateRange && (
        <p role="alert" className="text-sm text-destructive">
          El rango de fechas no es válido: «Desde» debe ser menor o igual a «Hasta».
        </p>
      )}

      <Tabs value={activeTab} onValueChange={(v) => setTab(v as ReportTab)}>
        {isMultiBranch && (
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="sede" className="h-10">
              Esta sede
            </TabsTrigger>
            <TabsTrigger value="cadena" className="h-10">
              Todas las sedes
            </TabsTrigger>
          </TabsList>
        )}

        <TabsContent value="sede" className="space-y-6 mt-4">
          {branchError ? (
            <div
              role="alert"
              className="p-4 rounded-lg border border-destructive/50 bg-destructive/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <p className="text-sm text-destructive">
                No se pudieron cargar los reportes: {(branchError as Error).message}
              </p>
              <Button
                variant="outline"
                className="h-10"
                disabled={isRefreshing}
                onClick={() => {
                  refetchSales();
                  refetchTopItems();
                }}
              >
                <RefreshCw
                  className={`h-4 w-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`}
                  aria-hidden="true"
                />
                Reintentar
              </Button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 active:translate-y-px active:scale-[0.98]"
                  disabled={days.length === 0}
                  onClick={exportDailySales}
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  Exportar ventas (CSV)
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 active:translate-y-px active:scale-[0.98]"
                  disabled={topItems.length === 0}
                  onClick={exportTopItems}
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  Exportar productos (CSV)
                </Button>
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
                <PaymentMethodsChart
                  paymentMethods={paymentMethods}
                  isLoading={salesLoading}
                />
              </div>

              <TopItemsList topItems={topItems} isLoading={topItemsLoading} />

              <StaffSalesSection startDate={startDate} endDate={endDate} />
            </>
          )}
        </TabsContent>

        {isMultiBranch && (
          <TabsContent value="cadena" className="space-y-6 mt-4">
            <OrgSalesSection
              startDate={startDate}
              endDate={endDate}
              enabled={activeTab === "cadena"}
            />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
