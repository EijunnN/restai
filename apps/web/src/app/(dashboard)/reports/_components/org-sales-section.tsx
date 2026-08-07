"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@restai/ui/components/card";
import { Button } from "@restai/ui/components/button";
import { Download, RefreshCw } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { downloadCsv, csvMoney } from "@/lib/csv";
import { formatCivilDate } from "@/lib/date";
import { useOrgSales, type OrgBranchSalesRow } from "@/hooks/use-reports";
import { SortableTable, type SortColumn } from "./sortable-table";
import { methodLabel } from "./method-labels";

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className ?? ""}`} />;
}

interface OrgSalesSectionProps {
  startDate: string;
  endDate: string;
  /** Solo se pide el consolidado cuando la pestaña está visible. */
  enabled: boolean;
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-bold tabular-nums">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );
}

/**
 * Consolidado multi-sede.
 *
 * Sin esto, el dueño de una cadena entraba una vez por sede y sumaba en Excel.
 * Las sedes que vendieron cero salen igualmente en la tabla: si desaparecieran,
 * la lectura sería "faltan datos" en vez de "esa sede no vendió nada".
 */
export function OrgSalesSection({ startDate, endDate, enabled }: OrgSalesSectionProps) {
  const { data, isLoading, isFetching, error, refetch } = useOrgSales(
    startDate,
    endDate,
    enabled,
  );

  const branches = data?.branches ?? [];
  const totals = data?.totals;
  const paymentMethods = data?.paymentMethods ?? [];
  const periodLabel = `${formatCivilDate(startDate)} – ${formatCivilDate(endDate)}`;

  const exportBranches = () => {
    const rows: (OrgBranchSalesRow & { isTotal?: boolean })[] = [...branches];
    if (totals) {
      rows.push({
        branchId: "__total__",
        branchName: "TOTAL",
        branchSlug: "",
        isActive: true,
        totalOrders: totals.totalOrders,
        totalRevenue: totals.totalRevenue,
        totalTax: totals.totalTax,
        totalDiscount: totals.totalDiscount,
        averageOrderValue: totals.averageOrderValue,
        isTotal: true,
      });
    }
    downloadCsv(
      `consolidado_sedes_${startDate}_${endDate}`,
      [
        { header: "Sede", value: (r: OrgBranchSalesRow & { isTotal?: boolean }) => r.branchName },
        {
          header: "Estado",
          value: (r: OrgBranchSalesRow & { isTotal?: boolean }) =>
            r.isTotal ? "" : r.isActive ? "Activa" : "Inactiva",
        },
        { header: "Órdenes", value: (r: OrgBranchSalesRow) => r.totalOrders },
        { header: "Ingresos (S/)", value: (r: OrgBranchSalesRow) => csvMoney(r.totalRevenue) },
        { header: "IGV (S/)", value: (r: OrgBranchSalesRow) => csvMoney(r.totalTax) },
        { header: "Descuentos (S/)", value: (r: OrgBranchSalesRow) => csvMoney(r.totalDiscount) },
        {
          header: "Ticket promedio (S/)",
          value: (r: OrgBranchSalesRow) => csvMoney(r.averageOrderValue),
        },
      ],
      rows,
    );
  };

  const columns: SortColumn<OrgBranchSalesRow>[] = [
    {
      key: "name",
      header: "Sede",
      value: (r) => r.branchName,
      defaultDirection: "asc",
      cell: (r) => (
        <div>
          <p className="font-medium">{r.branchName}</p>
          {!r.isActive && (
            <p className="text-xs text-muted-foreground">Sede desactivada</p>
          )}
        </div>
      ),
    },
    { key: "orders", header: "Órdenes", value: (r) => r.totalOrders, align: "right" },
    {
      key: "revenue",
      header: "Ingresos",
      value: (r) => r.totalRevenue,
      align: "right",
      cell: (r) => <span className="font-medium">{formatCurrency(r.totalRevenue)}</span>,
    },
    {
      key: "tax",
      header: "IGV",
      value: (r) => r.totalTax,
      align: "right",
      cell: (r) => formatCurrency(r.totalTax),
    },
    {
      key: "discount",
      header: "Descuentos",
      value: (r) => r.totalDiscount,
      align: "right",
      cell: (r) => formatCurrency(r.totalDiscount),
    },
    {
      key: "avg",
      header: "Ticket promedio",
      value: (r) => r.averageOrderValue,
      align: "right",
      cell: (r) => formatCurrency(r.averageOrderValue),
    },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <CardTitle>Consolidado de todas las sedes</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Ventas completadas del {periodLabel}, sede por sede y con el total de la cadena.
          </p>
        </div>
        {isFetching && !isLoading && (
          <span className="text-xs text-muted-foreground inline-flex items-center gap-2">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Actualizando…
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {error ? (
          <div
            role="alert"
            className="p-4 rounded-lg border border-destructive/50 bg-destructive/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <p className="text-sm text-destructive">
              No se pudo cargar el consolidado: {(error as Error).message}
            </p>
            <Button variant="outline" className="h-10" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" />
              Reintentar
            </Button>
          </div>
        ) : isLoading ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-[68px]" />
              ))}
            </div>
            <Skeleton className="h-48 w-full" />
          </div>
        ) : branches.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No tienes sedes asignadas, así que no hay nada que consolidar.
          </p>
        ) : (
          <>
            {totals && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Figure
                  label="Sedes"
                  value={String(totals.branches)}
                  hint="Incluidas las que no vendieron"
                />
                <Figure label="Órdenes completadas" value={String(totals.totalOrders)} />
                <Figure label="Ingresos de la cadena" value={formatCurrency(totals.totalRevenue)} />
                <Figure
                  label="Ticket promedio"
                  value={formatCurrency(totals.averageOrderValue)}
                  hint="Ingresos ÷ órdenes de toda la cadena"
                />
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">Detalle por sede</h3>
              <Button
                type="button"
                variant="outline"
                className="h-10"
                onClick={exportBranches}
              >
                <Download className="h-4 w-4 mr-2" aria-hidden="true" />
                Exportar consolidado (CSV)
              </Button>
            </div>

            <SortableTable
              columns={columns}
              rows={branches}
              rowKey={(r) => r.branchId}
              initialSort={{ key: "revenue", direction: "desc" }}
              caption="Ventas por sede en el periodo seleccionado"
              emptyMessage="No hay sedes que mostrar."
              footer={
                totals && (
                  <tr className="font-semibold">
                    <td className="py-2 px-2">Total de la cadena</td>
                    <td className="py-2 px-2 text-right tabular-nums">{totals.totalOrders}</td>
                    <td className="py-2 px-2 text-right tabular-nums">
                      {formatCurrency(totals.totalRevenue)}
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums">
                      {formatCurrency(totals.totalTax)}
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums">
                      {formatCurrency(totals.totalDiscount)}
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums">
                      {formatCurrency(totals.averageOrderValue)}
                    </td>
                  </tr>
                )
              }
            />

            <section className="space-y-3">
              <h3 className="font-semibold">Métodos de cobro de la cadena</h3>
              {paymentMethods.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No se registraron cobros en este periodo.
                </p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {paymentMethods.map((pm) => (
                    <li
                      key={pm.name}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <span className="text-sm">{methodLabel(pm.name)}</span>
                      <span className="text-sm font-medium tabular-nums">
                        {formatCurrency(pm.amount)}{" "}
                        <span className="text-muted-foreground font-normal">({pm.value}%)</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}
