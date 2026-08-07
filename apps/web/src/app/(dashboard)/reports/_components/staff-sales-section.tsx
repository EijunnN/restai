"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@restai/ui/components/card";
import { Button } from "@restai/ui/components/button";
import { Download, RefreshCw } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { roleLabel } from "@/lib/permissions";
import { downloadCsv, csvMoney } from "@/lib/csv";
import { formatCivilDate } from "@/lib/date";
import {
  useStaffSales,
  type StaffCashierRow,
  type StaffVoidRow,
  type StaffWaiterRow,
} from "@/hooks/use-reports";
import { SortableTable, type SortColumn } from "./sortable-table";
import { methodLabel } from "./method-labels";

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className ?? ""}`} />;
}

interface StaffSalesSectionProps {
  startDate: string;
  endDate: string;
}

/**
 * Rol de una fila de personal.
 *
 * `roleLabel` solo conoce los roles del staff y devuelve "Personal" para
 * cualquier otra cosa. Las filas sin usuario (el autoservicio por QR llega con
 * role "customer", y los cobros antiguos sin autoría con role null) acababan
 * etiquetadas como "Personal", que es justo lo contrario de lo que son.
 */
function waiterRoleLabel(row: StaffWaiterRow): string {
  if (!row.userId) return "Comensal";
  return row.role ? roleLabel(row.role) : "—";
}

function staffRoleLabel(userId: string | null, role: string | null): string {
  if (!userId || !role) return "—";
  return roleLabel(role);
}

/** Resumen de una cifra del periodo. */
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
 * Ventas por empleado.
 *
 * Es la primera pregunta de cualquier dueño ("¿quién vende más?, ¿quién cobró
 * el turno?, ¿quién anula cobros?") y hasta ahora no había forma de
 * responderla sin abrir la base de datos.
 */
export function StaffSalesSection({ startDate, endDate }: StaffSalesSectionProps) {
  const { data, isLoading, isFetching, error, refetch } = useStaffSales(startDate, endDate);

  const waiters = data?.waiters ?? [];
  const cashiers = data?.cashiers ?? [];
  const voids = data?.voids ?? [];
  const totals = data?.totals;

  const periodLabel = `${formatCivilDate(startDate)} – ${formatCivilDate(endDate)}`;
  const fileSuffix = `${startDate}_${endDate}`;

  const exportWaiters = () => {
    downloadCsv(
      `ventas_por_mozo_${fileSuffix}`,
      [
        { header: "Mozo", value: (r: StaffWaiterRow) => r.name },
        { header: "Rol", value: (r: StaffWaiterRow) => waiterRoleLabel(r) },
        { header: "Órdenes", value: (r: StaffWaiterRow) => r.totalOrders },
        { header: "Ingresos (S/)", value: (r: StaffWaiterRow) => csvMoney(r.totalRevenue) },
        {
          header: "Ticket promedio (S/)",
          value: (r: StaffWaiterRow) => csvMoney(r.averageOrderValue),
        },
      ],
      waiters,
    );
  };

  const exportCashiers = () => {
    downloadCsv(
      `cobros_por_cajero_${fileSuffix}`,
      [
        { header: "Cajero", value: (r: StaffCashierRow) => r.name },
        { header: "Rol", value: (r: StaffCashierRow) => staffRoleLabel(r.userId, r.role) },
        { header: "Cobros", value: (r: StaffCashierRow) => r.paymentsCount },
        { header: "Total cobrado (S/)", value: (r: StaffCashierRow) => csvMoney(r.totalCollected) },
        { header: "Propinas (S/)", value: (r: StaffCashierRow) => csvMoney(r.totalTips) },
        {
          header: "Desglose por método",
          value: (r: StaffCashierRow) =>
            r.byMethod
              .map((m) => `${methodLabel(m.method)}: ${csvMoney(m.amount)} (${m.count})`)
              .join(" | "),
        },
      ],
      cashiers,
    );
  };

  const exportVoids = () => {
    downloadCsv(
      `anulaciones_${fileSuffix}`,
      [
        { header: "Usuario", value: (r: StaffVoidRow) => r.name },
        { header: "Rol", value: (r: StaffVoidRow) => staffRoleLabel(r.userId, r.role) },
        { header: "Anulaciones", value: (r: StaffVoidRow) => r.count },
        { header: "Importe anulado (S/)", value: (r: StaffVoidRow) => csvMoney(r.amount) },
      ],
      voids,
    );
  };

  const waiterColumns: SortColumn<StaffWaiterRow>[] = [
    {
      key: "name",
      header: "Mozo",
      value: (r) => r.name,
      defaultDirection: "asc",
      cell: (r) => (
        <div>
          <p className="font-medium">{r.name}</p>
          {r.userId === null && (
            <p className="text-xs text-muted-foreground">Pedidos hechos por el propio comensal</p>
          )}
        </div>
      ),
    },
    {
      key: "role",
      header: "Rol",
      value: (r) => waiterRoleLabel(r),
      defaultDirection: "asc",
      cell: (r) => waiterRoleLabel(r),
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
      key: "avg",
      header: "Ticket promedio",
      value: (r) => r.averageOrderValue,
      align: "right",
      cell: (r) => formatCurrency(r.averageOrderValue),
    },
  ];

  const cashierColumns: SortColumn<StaffCashierRow>[] = [
    {
      key: "name",
      header: "Cajero",
      value: (r) => r.name,
      defaultDirection: "asc",
      cell: (r) => <span className="font-medium">{r.name}</span>,
    },
    {
      key: "role",
      header: "Rol",
      value: (r) => staffRoleLabel(r.userId, r.role),
      defaultDirection: "asc",
      cell: (r) => staffRoleLabel(r.userId, r.role),
    },
    { key: "count", header: "Cobros", value: (r) => r.paymentsCount, align: "right" },
    {
      key: "collected",
      header: "Total cobrado",
      value: (r) => r.totalCollected,
      align: "right",
      cell: (r) => <span className="font-medium">{formatCurrency(r.totalCollected)}</span>,
    },
    {
      key: "tips",
      header: "Propinas",
      value: (r) => r.totalTips,
      align: "right",
      cell: (r) => formatCurrency(r.totalTips),
    },
    {
      key: "methods",
      header: "Por método",
      value: (r) => r.byMethod.length,
      sortable: false,
      cell: (r) => (
        <ul className="space-y-0.5">
          {r.byMethod.map((m) => (
            <li key={m.method} className="text-xs text-muted-foreground whitespace-nowrap">
              {methodLabel(m.method)}: {formatCurrency(m.amount)} ({m.count})
            </li>
          ))}
        </ul>
      ),
    },
  ];

  const voidColumns: SortColumn<StaffVoidRow>[] = [
    {
      key: "name",
      header: "Usuario",
      value: (r) => r.name,
      defaultDirection: "asc",
      cell: (r) => <span className="font-medium">{r.name}</span>,
    },
    {
      key: "role",
      header: "Rol",
      value: (r) => staffRoleLabel(r.userId, r.role),
      defaultDirection: "asc",
      cell: (r) => staffRoleLabel(r.userId, r.role),
    },
    { key: "count", header: "Anulaciones", value: (r) => r.count, align: "right" },
    {
      key: "amount",
      header: "Importe anulado",
      value: (r) => r.amount,
      align: "right",
      cell: (r) => <span className="font-medium">{formatCurrency(r.amount)}</span>,
    },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <CardTitle>Ventas por empleado</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Quién levantó cada pedido y quién registró cada cobro, del {periodLabel}.
          </p>
        </div>
        {isFetching && !isLoading && (
          <span className="text-xs text-muted-foreground inline-flex items-center gap-2">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Actualizando…
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-8">
        {error ? (
          <div
            role="alert"
            className="p-4 rounded-lg border border-destructive/50 bg-destructive/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <p className="text-sm text-destructive">
              No se pudieron cargar las ventas por empleado: {(error as Error).message}
            </p>
            <Button variant="outline" className="h-10" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" />
              Reintentar
            </Button>
          </div>
        ) : isLoading ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-[68px]" />
              ))}
            </div>
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <>
            {totals && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Figure
                  label="Órdenes completadas"
                  value={String(totals.totalOrders)}
                  hint="Repartidas entre quienes las tomaron"
                />
                <Figure label="Ingresos" value={formatCurrency(totals.totalRevenue)} />
                <Figure
                  label="Cobrado en caja"
                  value={formatCurrency(totals.totalCollected)}
                  hint="Sin contar cobros anulados"
                />
                <Figure label="Propinas" value={formatCurrency(totals.totalTips)} />
                <Figure
                  label="Anulado"
                  value={formatCurrency(totals.voidedAmount)}
                  hint="Cobros revertidos en el periodo"
                />
              </div>
            )}

            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">Ventas por mozo</h3>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10"
                  disabled={waiters.length === 0}
                  onClick={exportWaiters}
                >
                  <Download className="h-4 w-4 mr-2" aria-hidden="true" />
                  Exportar (CSV)
                </Button>
              </div>
              <SortableTable
                columns={waiterColumns}
                rows={waiters}
                rowKey={(r) => r.userId ?? "autoservicio"}
                initialSort={{ key: "revenue", direction: "desc" }}
                caption="Ventas por mozo en el periodo seleccionado"
                emptyMessage="No hay órdenes completadas en este periodo, así que no hay ventas que repartir."
              />
            </section>

            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">Cobros por cajero</h3>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10"
                  disabled={cashiers.length === 0}
                  onClick={exportCashiers}
                >
                  <Download className="h-4 w-4 mr-2" aria-hidden="true" />
                  Exportar (CSV)
                </Button>
              </div>
              <SortableTable
                columns={cashierColumns}
                rows={cashiers}
                rowKey={(r) => r.userId ?? "sin-registrar"}
                initialSort={{ key: "collected", direction: "desc" }}
                caption="Cobros por cajero en el periodo seleccionado"
                emptyMessage="No se registró ningún cobro en este periodo."
              />
            </section>

            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-semibold">Anulaciones de cobro</h3>
                  <p className="text-xs text-muted-foreground">
                    Un cajero que anula mucho es la señal de alarma clásica: conviene revisarlo.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10"
                  disabled={voids.length === 0}
                  onClick={exportVoids}
                >
                  <Download className="h-4 w-4 mr-2" aria-hidden="true" />
                  Exportar (CSV)
                </Button>
              </div>
              <SortableTable
                columns={voidColumns}
                rows={voids}
                rowKey={(r) => r.userId ?? "sin-registrar"}
                initialSort={{ key: "amount", direction: "desc" }}
                caption="Anulaciones de cobro en el periodo seleccionado"
                emptyMessage="Ningún cobro fue anulado en este periodo."
              />
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}
