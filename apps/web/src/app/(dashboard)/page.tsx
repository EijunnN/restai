"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@restai/ui/components/card";
import {
  ClipboardList,
  DollarSign,
  TrendingUp,
  Grid3X3,
  RefreshCw,
} from "lucide-react";
import { Button } from "@restai/ui/components/button";
import { formatCurrency } from "@/lib/utils";
import { useDashboardStats, useRecentOrders } from "@/hooks/use-dashboard";
import { useTables } from "@/hooks/use-tables";

const statusColors: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  preparing: "bg-blue-100 text-blue-800",
  ready: "bg-green-100 text-green-800",
  served: "bg-gray-100 text-gray-800",
  confirmed: "bg-blue-100 text-blue-800",
  completed: "bg-gray-100 text-gray-800",
};

const statusLabels: Record<string, string> = {
  pending: "Pendiente",
  preparing: "Preparando",
  ready: "Listo",
  served: "Servido",
  confirmed: "Confirmado",
  completed: "Completado",
};

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className ?? ""}`} />;
}

export default function DashboardPage() {
  const { data: dashboardStats, isLoading: statsLoading, error: statsError, refetch: refetchStats } = useDashboardStats();
  const { data: recentOrders, isLoading: ordersLoading, error: ordersError, refetch: refetchOrders } = useRecentOrders();
  const { data: tables, isLoading: tablesLoading } = useTables();

  const stats = dashboardStats
    ? [
        {
          title: "Ordenes Hoy",
          value: dashboardStats.ordersToday ?? 0,
          icon: ClipboardList,
          description: dashboardStats.ordersChange ?? "",
        },
        {
          title: "Ingresos Hoy",
          value: dashboardStats.revenueToday ?? 0,
          icon: DollarSign,
          description: dashboardStats.revenueChange ?? "",
          isCurrency: true,
        },
        {
          title: "Ordenes Activas",
          value: dashboardStats.activeOrders ?? 0,
          icon: TrendingUp,
          description: dashboardStats.activeOrdersDetail ?? "",
        },
        {
          title: "Mesas Ocupadas",
          value: dashboardStats.tablesOccupied ?? "0/0",
          icon: Grid3X3,
          description: dashboardStats.tablesDetail ?? "",
        },
      ]
    : [];

  const orders: any[] = recentOrders ?? [];
  const tableList: any[] = tables ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">
          Resumen del dia de tu restaurante
        </p>
      </div>

      {/* Stats Cards */}
      {statsError ? (
        <div className="p-4 rounded-lg border border-destructive/50 bg-destructive/5 flex items-center justify-between">
          <p className="text-sm text-destructive">Error al cargar estadisticas: {(statsError as Error).message}</p>
          <Button variant="outline" size="sm" onClick={() => refetchStats()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Reintentar
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {statsLoading
            ? Array.from({ length: 4 }).map((_, i) => (
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
            : stats.map((stat) => (
                <Card key={stat.title}>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      {stat.title}
                    </CardTitle>
                    <stat.icon className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {stat.isCurrency
                        ? formatCurrency(stat.value as number)
                        : stat.value}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {stat.description}
                    </p>
                  </CardContent>
                </Card>
              ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Orders */}
        <Card>
          <CardHeader>
            <CardTitle>Ordenes Recientes</CardTitle>
          </CardHeader>
          <CardContent>
            {ordersError ? (
              <div className="text-center py-4">
                <p className="text-sm text-destructive mb-2">Error al cargar ordenes</p>
                <Button variant="outline" size="sm" onClick={() => refetchOrders()}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Reintentar
                </Button>
              </div>
            ) : ordersLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="flex items-center gap-3">
                      <div>
                        <Skeleton className="h-4 w-16 mb-1" />
                        <Skeleton className="h-3 w-12" />
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-5 w-16 rounded-full" />
                      <Skeleton className="h-4 w-16" />
                    </div>
                  </div>
                ))}
              </div>
            ) : orders.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No hay ordenes recientes
              </p>
            ) : (
              <div className="space-y-3">
                {orders.map((order: any) => (
                  <div
                    key={order.id}
                    className="flex items-center justify-between p-3 rounded-lg border"
                  >
                    <div className="flex items-center gap-3">
                      <div>
                        <p className="font-medium text-sm">
                          {order.orderNumber || order.order_number || order.id}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {order.tableName || order.table_name || order.table || ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className={`text-xs px-2 py-1 rounded-full font-medium ${statusColors[order.status] || "bg-gray-100 text-gray-800"}`}
                      >
                        {statusLabels[order.status] || order.status}
                      </span>
                      <span className="text-sm font-medium">
                        {formatCurrency(order.total ?? 0)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Table Activity */}
        <Card>
          <CardHeader>
            <CardTitle>Actividad de Mesas</CardTitle>
          </CardHeader>
          <CardContent>
            {tablesLoading ? (
              <div className="grid grid-cols-4 gap-3">
                {Array.from({ length: 12 }).map((_, i) => (
                  <Skeleton key={i} className="aspect-square rounded-lg" />
                ))}
              </div>
            ) : tableList.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No hay mesas configuradas
              </p>
            ) : (
              <div className="grid grid-cols-4 gap-3">
                {tableList.map((table: any) => {
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
                      <span className="text-lg font-bold">
                        {table.number ?? table.table_number}
                      </span>
                      <span className="text-[10px]">
                        {occupied ? "Ocupada" : "Libre"}
                      </span>
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
