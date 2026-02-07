"use client";

import { useState } from "react";
import { Card, CardContent } from "@restai/ui/components/card";
import { Input } from "@restai/ui/components/input";
import { Badge } from "@restai/ui/components/badge";
import { Button } from "@restai/ui/components/button";
import { Search, RefreshCw, ChevronLeft, ChevronRight, Printer } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useOrders, useUpdateOrderStatus } from "@/hooks/use-orders";
import { useOrgSettings, useBranchSettings } from "@/hooks/use-settings";
import { usePrintReceipt } from "@/components/print-ticket";
import { apiFetch } from "@/lib/fetcher";

const PAGE_SIZE = 20;

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Pendiente", variant: "outline" },
  confirmed: { label: "Confirmado", variant: "secondary" },
  preparing: { label: "Preparando", variant: "default" },
  ready: { label: "Listo", variant: "default" },
  served: { label: "Servido", variant: "secondary" },
  completed: { label: "Completado", variant: "secondary" },
  cancelled: { label: "Cancelado", variant: "destructive" },
};

const paymentStatusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; className?: string }> = {
  paid: { label: "Pagado", variant: "default", className: "bg-green-600 hover:bg-green-600" },
  partial: { label: "Parcial", variant: "default", className: "bg-amber-500 hover:bg-amber-500" },
  unpaid: { label: "Sin pagar", variant: "outline" },
};

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className ?? ""}`} />;
}

export default function OrdersPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(1);

  const { data, isLoading, error, refetch } = useOrders({ status: statusFilter, page, limit: PAGE_SIZE });
  const updateStatus = useUpdateOrderStatus();
  const { data: orgSettings } = useOrgSettings();
  const { data: branchSettings } = useBranchSettings();
  const printReceipt = usePrintReceipt();

  const handlePrintReceipt = async (order: any) => {
    try {
      const orderDetail = await apiFetch(`/api/orders/${order.id}`);
      const org = orgSettings as any;
      const branch = branchSettings as any;
      const items = (orderDetail as any)?.items || [];
      printReceipt({
        businessName: org?.name || "Restaurante",
        ruc: org?.settings?.ruc || undefined,
        address: branch?.address || undefined,
        orderNumber: order.order_number || order.id,
        createdAt: order.created_at || new Date().toISOString(),
        items: items.map((i: any) => ({
          name: i.name,
          quantity: i.quantity,
          unit_price: i.unit_price,
          total: i.total,
        })),
        subtotal: order.subtotal ?? 0,
        tax: order.tax ?? 0,
        total: order.total ?? 0,
        customerName: order.customer_name || undefined,
      });
    } catch {
      // If we can't fetch details, print with what we have
      const org = orgSettings as any;
      printReceipt({
        businessName: org?.name || "Restaurante",
        orderNumber: order.order_number || order.id,
        createdAt: order.created_at || new Date().toISOString(),
        items: [],
        subtotal: order.subtotal ?? 0,
        tax: order.tax ?? 0,
        total: order.total ?? 0,
        customerName: order.customer_name || undefined,
      });
    }
  };

  const orders: any[] = data?.orders ?? [];
  const pagination = data?.pagination ?? { page: 1, limit: PAGE_SIZE, total: 0, totalPages: 1 };

  // Reset page when filter changes
  const handleStatusFilter = (status: string) => {
    setStatusFilter(status);
    setPage(1);
  };

  const filteredOrders = orders.filter((order: any) => {
    const orderNum = order.order_number || "";
    const customer = order.customer_name || "";
    const tableNum = order.table_number != null ? `Mesa ${order.table_number}` : "";
    return (
      orderNum.toLowerCase().includes(search.toLowerCase()) ||
      customer.toLowerCase().includes(search.toLowerCase()) ||
      tableNum.toLowerCase().includes(search.toLowerCase())
    );
  });

  const getNextStatus = (status: string): string | null => {
    const flow: Record<string, string> = {
      pending: "confirmed",
      confirmed: "preparing",
      preparing: "ready",
      ready: "served",
      served: "completed",
    };
    return flow[status] || null;
  };

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Ordenes</h1>
        </div>
        <div className="p-4 rounded-lg border border-destructive/50 bg-destructive/5 flex items-center justify-between">
          <p className="text-sm text-destructive">Error al cargar ordenes: {(error as Error).message}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Ordenes</h1>
        <p className="text-muted-foreground">
          Gestiona y rastrea todas las ordenes
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por numero, mesa o cliente..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {["all", "pending", "confirmed", "preparing", "ready", "served", "completed"].map(
            (status) => (
              <Button
                key={status}
                variant={statusFilter === status ? "default" : "outline"}
                size="sm"
                onClick={() => handleStatusFilter(status)}
              >
                {status === "all"
                  ? "Todos"
                  : statusConfig[status]?.label || status}
              </Button>
            )
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 text-sm font-medium text-muted-foreground">
                    Orden
                  </th>
                  <th className="text-left p-3 text-sm font-medium text-muted-foreground">
                    Mesa
                  </th>
                  <th className="text-left p-3 text-sm font-medium text-muted-foreground hidden sm:table-cell">
                    Cliente
                  </th>
                  <th className="text-left p-3 text-sm font-medium text-muted-foreground">
                    Estado
                  </th>
                  <th className="text-left p-3 text-sm font-medium text-muted-foreground hidden sm:table-cell">
                    Pago
                  </th>
                  <th className="text-left p-3 text-sm font-medium text-muted-foreground hidden md:table-cell">
                    Items
                  </th>
                  <th className="text-right p-3 text-sm font-medium text-muted-foreground">
                    Total
                  </th>
                  <th className="text-right p-3 text-sm font-medium text-muted-foreground hidden lg:table-cell">
                    Hora
                  </th>
                  <th className="text-center p-3 text-sm font-medium text-muted-foreground hidden md:table-cell">
                    Accion
                  </th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b">
                      <td className="p-3"><Skeleton className="h-4 w-20" /></td>
                      <td className="p-3"><Skeleton className="h-4 w-16" /></td>
                      <td className="p-3 hidden sm:table-cell"><Skeleton className="h-4 w-20" /></td>
                      <td className="p-3"><Skeleton className="h-5 w-20 rounded-full" /></td>
                      <td className="p-3 hidden sm:table-cell"><Skeleton className="h-5 w-16 rounded-full" /></td>
                      <td className="p-3 hidden md:table-cell"><Skeleton className="h-4 w-12" /></td>
                      <td className="p-3"><Skeleton className="h-4 w-16 ml-auto" /></td>
                      <td className="p-3 hidden lg:table-cell"><Skeleton className="h-4 w-24 ml-auto" /></td>
                      <td className="p-3 hidden md:table-cell"><Skeleton className="h-7 w-20 mx-auto" /></td>
                    </tr>
                  ))
                ) : filteredOrders.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-sm text-muted-foreground">
                      No se encontraron ordenes
                    </td>
                  </tr>
                ) : (
                  filteredOrders.map((order: any) => {
                    const config = statusConfig[order.status] || {
                      label: order.status,
                      variant: "outline" as const,
                    };
                    const nextStatus = getNextStatus(order.status);
                    const orderNum = order.order_number || order.id;
                    const table = order.table_number != null ? `Mesa ${order.table_number}` : "-";
                    const customer = order.customer_name || "";
                    const itemCount = order.item_count ?? 0;
                    const createdAt = order.created_at || "";
                    const paymentStatus = order.payment_status || "unpaid";
                    const payConfig = paymentStatusConfig[paymentStatus] || paymentStatusConfig.unpaid;

                    return (
                      <tr
                        key={order.id}
                        className="border-b last:border-0 hover:bg-muted/50 cursor-pointer transition-colors"
                      >
                        <td className="p-3 font-medium text-sm">{orderNum}</td>
                        <td className="p-3 text-sm">{table}</td>
                        <td className="p-3 text-sm hidden sm:table-cell">{customer}</td>
                        <td className="p-3">
                          <Badge variant={config.variant}>{config.label}</Badge>
                        </td>
                        <td className="p-3 hidden sm:table-cell">
                          <Badge variant={payConfig.variant} className={payConfig.className}>
                            {payConfig.label}
                          </Badge>
                          {paymentStatus === "partial" && order.total_paid != null && (
                            <span className="text-[10px] text-muted-foreground ml-1">
                              {formatCurrency(order.total_paid)}
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-sm text-muted-foreground hidden md:table-cell">
                          {itemCount} items
                        </td>
                        <td className="p-3 text-sm font-medium text-right">
                          {formatCurrency(order.total ?? 0)}
                        </td>
                        <td className="p-3 text-sm text-muted-foreground text-right hidden lg:table-cell">
                          {createdAt ? formatDate(createdAt) : "-"}
                        </td>
                        <td className="p-3 text-center hidden md:table-cell">
                          <div className="flex items-center justify-center gap-1">
                            {nextStatus && (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={updateStatus.isPending}
                                onClick={() =>
                                  updateStatus.mutate({ id: order.id, status: nextStatus })
                                }
                              >
                                {statusConfig[nextStatus]?.label || nextStatus}
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              onClick={() => handlePrintReceipt(order)}
                              title="Imprimir Boleta"
                            >
                              <Printer className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {pagination.total} ordenes en total
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
              Anterior
            </Button>
            <span className="text-sm text-muted-foreground">
              Pagina {pagination.page} de {pagination.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pagination.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Siguiente
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
