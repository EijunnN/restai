"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@restai/ui/components/card";
import {
  ClipboardList,
  DollarSign,
  Receipt,
  TrendingUp,
  Grid3X3,
  PackageX,
  RefreshCw,
  ArrowRight,
} from "lucide-react";
import { Button, buttonVariants } from "@restai/ui/components/button";
import { cn, formatCurrency } from "@/lib/utils";
import { hasPermission } from "@/lib/permissions";
import { useAuthStore } from "@/stores/auth-store";
import {
  useDashboardStats,
  useRecentOrders,
  useLowStockAlerts,
  type RecentOrder,
  type LowStockItem,
} from "@/hooks/use-dashboard";
import { useTables, type TableRow } from "@/hooks/use-tables";
import { PageHeader } from "@/components/page-header";

const statusColors: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  confirmed: "bg-blue-100 text-blue-800",
  preparing: "bg-blue-100 text-blue-800",
  ready: "bg-green-100 text-green-800",
  served: "bg-gray-100 text-gray-800",
  completed: "bg-gray-100 text-gray-800",
  cancelled: "bg-red-100 text-red-800",
};

const statusLabels: Record<string, string> = {
  pending: "Pendiente",
  confirmed: "Confirmada",
  preparing: "Preparando",
  ready: "Lista",
  served: "Servida",
  completed: "Completada",
  cancelled: "Anulada",
};

/** Cuando la orden no tiene mesa, al menos se dice por qué. */
const orderTypeLabels: Record<string, string> = {
  dine_in: "En local (sin mesa)",
  takeout: "Para llevar",
  delivery: "Delivery",
};

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className ?? ""}`} />;
}

interface StatCardProps {
  title: string;
  value: string;
  /** Frase que explica QUÉ cuenta el número. Es lo que evita que el dueño crea que los KPI se contradicen. */
  hint: string;
  icon: LucideIcon;
}

function StatCard({ title, value, hint, icon: Icon }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground mt-1 leading-snug">{hint}</p>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const role = useAuthStore((s) => s.user?.role);
  const canReadInventory = hasPermission(role, "inventory:read");

  const {
    data: stats,
    isLoading: statsLoading,
    isFetching: statsFetching,
    error: statsError,
    refetch: refetchStats,
  } = useDashboardStats();
  const {
    data: recentOrders,
    isLoading: ordersLoading,
    error: ordersError,
    refetch: refetchOrders,
  } = useRecentOrders(6);
  const { data: tablesData, isLoading: tablesLoading, error: tablesError, refetch: refetchTables } =
    useTables();
  const {
    data: lowStock,
    error: lowStockError,
    refetch: refetchLowStock,
  } = useLowStockAlerts(canReadInventory);

  const orders: RecentOrder[] = recentOrders ?? [];
  // GET /api/tables responde { tables, branchSlug }, no un array: leerlo como
  // array dejaba esta tarjeta en blanco (o reventando en el .map).
  const tableList: TableRow[] = tablesData?.tables ?? [];
  const lowStockItems: LowStockItem[] = lowStock ?? [];

  // Diferencia deliberada entre las dos cifras del día:
  //  - órdenes  = todo lo que entró salvo lo anulado (carga de trabajo)
  //  - ingresos = solo lo completado y cobrado (caja)
  const notCompleted = stats ? Math.max(stats.totalOrders - stats.completedOrders, 0) : 0;

  const statCards: StatCardProps[] = stats
    ? [
        {
          title: "Órdenes hoy",
          value: String(stats.totalOrders),
          hint:
            stats.totalOrders === 0
              ? "Todavía no ha entrado ninguna orden hoy."
              : notCompleted > 0
                ? `Todas las del día salvo las anuladas. ${stats.completedOrders} ya completadas y ${notCompleted} aún en curso.`
                : `Todas las del día salvo las anuladas. Las ${stats.completedOrders} están completadas.`,
          icon: ClipboardList,
        },
        {
          title: "Ingresos hoy",
          value: formatCurrency(stats.revenueToday),
          hint:
            stats.completedOrders === 0
              ? "Aún no se ha completado ninguna orden: los ingresos suman al cerrarse."
              : `Solo de las ${stats.completedOrders} órdenes completadas. Las que siguen en cocina no suman hasta cerrarse.`,
          icon: DollarSign,
        },
        {
          title: "Ticket promedio",
          value: formatCurrency(stats.averageOrderValue),
          hint:
            stats.completedOrders === 0
              ? "Se calcula en cuanto se cierre la primera orden del día."
              : "Ingresos del día divididos entre las órdenes completadas.",
          icon: Receipt,
        },
        {
          title: "Órdenes activas",
          value: String(stats.activeOrders),
          hint: "En cola, confirmadas, en preparación o listas para servir.",
          icon: TrendingUp,
        },
        {
          title: "Mesas ocupadas",
          value: `${stats.occupiedTables}/${stats.totalTables}`,
          hint: "Mesas con visita abierta sobre el total configurado.",
          icon: Grid3X3,
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Panel"
        description="Resumen del día de tu restaurante"
        actions={
          <Button
            variant="outline"
            className="h-10"
            aria-label="Actualizar los datos del panel"
            disabled={statsFetching}
            onClick={() => {
              refetchStats();
              refetchOrders();
              refetchTables();
            }}
          >
            <RefreshCw
              className={`h-4 w-4 mr-2 ${statsFetching ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            Actualizar
          </Button>
        }
      />

      {/* Si la comprobación de stock falla hay que decirlo: callar equivale a
          afirmar "no falta nada", que es la conclusión más cara de las dos. */}
      {canReadInventory && lowStockError && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/50 bg-destructive/5 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <p className="text-sm text-destructive">
            No se pudo comprobar el stock de insumos: {(lowStockError as Error).message}
          </p>
          <Button
            variant="outline"
            className="h-10 shrink-0"
            onClick={() => refetchLowStock()}
          >
            <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" />
            Reintentar
          </Button>
        </div>
      )}

      {/* Aviso de stock bajo: se vende lo que no hay y el gerente se entera tarde. */}
      {canReadInventory && !lowStockError && lowStockItems.length > 0 && (
        <div
          role="alert"
          className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/40 dark:bg-amber-500/10"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex gap-3">
              <PackageX
                className="h-5 w-5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <div>
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                  {lowStockItems.length === 1
                    ? "1 insumo por debajo del mínimo"
                    : `${lowStockItems.length} insumos por debajo del mínimo`}
                </p>
                <ul className="mt-1 space-y-0.5 text-sm text-amber-900/90 dark:text-amber-200/90">
                  {lowStockItems.slice(0, 5).map((item) => (
                    <li key={item.id}>
                      <span className="font-medium">{item.name}</span>: quedan{" "}
                      {Number(item.current_stock)} {item.unit} (mínimo{" "}
                      {Number(item.min_stock)} {item.unit})
                    </li>
                  ))}
                </ul>
                {lowStockItems.length > 5 && (
                  <p className="mt-1 text-xs text-amber-900/80 dark:text-amber-200/80">
                    y {lowStockItems.length - 5} más.
                  </p>
                )}
              </div>
            </div>
            {/* Navegación interna con <Link>: `window.location.href` recarga la
                aplicación entera sin ninguna necesidad. */}
            <Link
              href="/inventory"
              className={cn(buttonVariants({ variant: "outline" }), "h-10 shrink-0")}
            >
              Ver inventario
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      )}

      {/* Tarjetas de cifras */}
      {statsError ? (
        <div
          role="alert"
          className="p-4 rounded-lg border border-destructive/50 bg-destructive/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <p className="text-sm text-destructive">
            No se pudieron cargar las estadísticas: {statsError.message}
          </p>
          <Button variant="outline" className="h-10" onClick={() => refetchStats()}>
            <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" />
            Reintentar
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {statsLoading
            ? Array.from({ length: 5 }).map((_, i) => (
                <Card key={i}>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-4" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-8 w-20 mb-2" />
                    <Skeleton className="h-3 w-32" />
                  </CardContent>
                </Card>
              ))
            : statCards.map((stat) => <StatCard key={stat.title} {...stat} />)}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Órdenes recientes */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Órdenes recientes</CardTitle>
            {/* h-10: en tablet un enlace de 20px de alto se falla al tocarlo. */}
            <Link
              href="/orders"
              className="inline-flex items-center h-10 px-2 -mr-2 text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
            >
              Ver todas
            </Link>
          </CardHeader>
          <CardContent>
            {ordersError ? (
              <div role="alert" className="text-center py-4">
                <p className="text-sm text-destructive mb-3">
                  No se pudieron cargar las órdenes: {(ordersError as Error).message}
                </p>
                <Button variant="outline" className="h-10" onClick={() => refetchOrders()}>
                  <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" />
                  Reintentar
                </Button>
              </div>
            ) : ordersLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-3 rounded-lg border"
                  >
                    <div>
                      <Skeleton className="h-4 w-20 mb-1" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-5 w-16 rounded-full" />
                      <Skeleton className="h-4 w-16" />
                    </div>
                  </div>
                ))}
              </div>
            ) : orders.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-sm text-muted-foreground">
                  Todavía no hay órdenes hoy. Aparecerán aquí en cuanto se registre la primera.
                </p>
              </div>
            ) : (
              <ul className="space-y-3">
                {orders.map((order) => {
                  const place =
                    order.table_number != null
                      ? `Mesa ${order.table_number}`
                      : orderTypeLabels[order.type] ?? "Sin mesa";
                  return (
                    <li
                      key={order.id}
                      className="flex items-center justify-between gap-3 p-3 rounded-lg border"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{order.order_number}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {place}
                          {order.customer_name ? ` · ${order.customer_name}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span
                          className={`text-xs px-2 py-1 rounded-full font-medium ${statusColors[order.status] || "bg-gray-100 text-gray-800"}`}
                        >
                          {statusLabels[order.status] || order.status}
                        </span>
                        <span className="text-sm font-medium tabular-nums">
                          {formatCurrency(order.total ?? 0)}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Actividad de mesas */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Actividad de mesas</CardTitle>
            <Link
              href="/tables"
              className="inline-flex items-center h-10 px-2 -mr-2 text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
            >
              Ver salón
            </Link>
          </CardHeader>
          <CardContent>
            {tablesError ? (
              <div role="alert" className="text-center py-4">
                <p className="text-sm text-destructive mb-3">
                  No se pudieron cargar las mesas: {(tablesError as Error).message}
                </p>
                <Button variant="outline" className="h-10" onClick={() => refetchTables()}>
                  <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" />
                  Reintentar
                </Button>
              </div>
            ) : tablesLoading ? (
              <div className="grid grid-cols-4 gap-3">
                {Array.from({ length: 12 }).map((_, i) => (
                  <Skeleton key={i} className="aspect-square rounded-lg" />
                ))}
              </div>
            ) : tableList.length === 0 ? (
              <div className="text-center py-6 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Aún no hay mesas configuradas en esta sede.
                </p>
                <Link
                  href="/tables"
                  className={cn(buttonVariants({ variant: "outline" }), "h-10")}
                >
                  Configurar mesas
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-3">
                {tableList.map((table) => {
                  const occupied = table.status === "occupied";
                  return (
                    <div
                      key={table.id}
                      className={`aspect-square rounded-lg flex flex-col items-center justify-center text-sm font-medium border-2 transition-colors ${
                        occupied
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-muted/50 text-muted-foreground"
                      }`}
                    >
                      <span className="text-lg font-bold">{table.number}</span>
                      <span className="text-[10px]">{occupied ? "Ocupada" : "Libre"}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
