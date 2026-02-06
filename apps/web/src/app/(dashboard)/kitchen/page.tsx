"use client";

import { useCallback } from "react";
import { Badge } from "@restai/ui/components/badge";
import { Button } from "@restai/ui/components/button";
import { useWebSocket } from "@/hooks/use-websocket";
import { useAuthStore } from "@/stores/auth-store";
import {
  Clock,
  ChefHat,
  CheckCircle,
  ArrowRight,
  RefreshCw,
  AlertCircle,
  UtensilsCrossed,
  Timer,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useKitchenOrders, useUpdateKitchenItemStatus } from "@/hooks/use-kitchen";
import { useUpdateOrderStatus } from "@/hooks/use-orders";
import type { WsMessage } from "@restai/types";

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-muted rounded", className)} />;
}

function getTimeDiff(createdAt: string): string {
  const diff = Math.floor(
    (Date.now() - new Date(createdAt).getTime()) / 60000
  );
  if (diff < 1) return "<1m";
  return `${diff}m`;
}

function getTimeUrgency(createdAt: string): "normal" | "warning" | "urgent" {
  const diff = Math.floor(
    (Date.now() - new Date(createdAt).getTime()) / 60000
  );
  if (diff >= 20) return "urgent";
  if (diff >= 10) return "warning";
  return "normal";
}

function KitchenOrderCard({
  order,
  columnStatus,
  onAdvance,
  onItemReady,
  isAdvancing,
  isUpdatingItem,
}: {
  order: any;
  columnStatus: "pending" | "preparing" | "ready";
  onAdvance: (orderId: string, status: string) => void;
  onItemReady: (itemId: string) => void;
  isAdvancing: boolean;
  isUpdatingItem: boolean;
}) {
  const orderNum = order.orderNumber || order.order_number || order.id;
  const tableName = order.tableName || order.table_name || "";
  const createdAt = order.createdAt || order.created_at || "";
  const items: any[] = order.items || [];
  const urgency = createdAt ? getTimeUrgency(createdAt) : "normal";

  const borderColor =
    columnStatus === "pending"
      ? urgency === "urgent"
        ? "border-red-500"
        : urgency === "warning"
          ? "border-amber-500"
          : "border-amber-400/60"
      : columnStatus === "preparing"
        ? "border-blue-500"
        : "border-green-500";

  const headerBg =
    columnStatus === "pending"
      ? urgency === "urgent"
        ? "bg-red-500"
        : urgency === "warning"
          ? "bg-amber-500"
          : "bg-amber-500"
      : columnStatus === "preparing"
        ? "bg-blue-500"
        : "bg-green-500";

  return (
    <div
      className={cn(
        "rounded-lg border-2 overflow-hidden bg-card shadow-sm transition-all",
        borderColor,
        urgency === "urgent" && columnStatus === "pending" && "ring-2 ring-red-500/30"
      )}
    >
      {/* Card Header */}
      <div className={cn("px-3 py-2 flex items-center justify-between", headerBg)}>
        <div className="flex items-center gap-2">
          <span className="text-white font-bold text-lg tracking-tight">
            #{orderNum}
          </span>
          {tableName && (
            <span className="text-white/80 text-sm font-medium">
              {tableName}
            </span>
          )}
        </div>
        {createdAt && (
          <div
            className={cn(
              "flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold",
              urgency === "urgent"
                ? "bg-white/30 text-white"
                : urgency === "warning"
                  ? "bg-white/25 text-white"
                  : "bg-white/20 text-white/90"
            )}
          >
            <Timer className="h-3 w-3" />
            {getTimeDiff(createdAt)}
          </div>
        )}
      </div>

      {/* Items List */}
      <div className="p-2 space-y-1">
        {items.map((item: any) => {
          const isItemReady = item.status === "ready";
          return (
            <div
              key={item.id}
              className={cn(
                "flex items-start justify-between gap-2 px-2.5 py-1.5 rounded-md text-sm",
                isItemReady
                  ? "bg-green-500/10 text-muted-foreground"
                  : "bg-muted/50"
              )}
            >
              <div className="flex-1 min-w-0">
                <div className={cn("font-semibold", isItemReady && "line-through")}>
                  <span className="text-foreground/70 mr-1">{item.quantity}x</span>
                  {item.name}
                </div>
                {item.notes && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5 font-medium leading-tight">
                    * {item.notes}
                  </p>
                )}
              </div>
              {columnStatus === "preparing" && (
                isItemReady ? (
                  <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
                ) : (
                  <button
                    className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 px-2 py-0.5 rounded transition-colors shrink-0"
                    disabled={isUpdatingItem}
                    onClick={() => onItemReady(item.id)}
                  >
                    Listo
                  </button>
                )
              )}
            </div>
          );
        })}
      </div>

      {/* Action Button */}
      <div className="p-2 pt-0">
        {columnStatus === "pending" && (
          <Button
            size="sm"
            className="w-full bg-amber-500 hover:bg-amber-600 text-white font-semibold"
            disabled={isAdvancing}
            onClick={() => onAdvance(order.id, "pending")}
          >
            Iniciar Preparacion
            <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        )}
        {columnStatus === "preparing" && (
          <Button
            size="sm"
            className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold"
            disabled={isAdvancing}
            onClick={() => onAdvance(order.id, "preparing")}
          >
            Marcar como Listo
            <CheckCircle className="h-4 w-4 ml-1" />
          </Button>
        )}
        {columnStatus === "ready" && (
          <Button
            size="sm"
            variant="outline"
            className="w-full border-green-500/40 text-green-700 dark:text-green-400 hover:bg-green-500/10 font-semibold"
            disabled={isAdvancing}
            onClick={() =>
              onAdvance(order.id, "ready")
            }
          >
            <UtensilsCrossed className="h-4 w-4 mr-1" />
            Servir
          </Button>
        )}
      </div>
    </div>
  );
}

function ColumnHeader({
  icon: Icon,
  label,
  count,
  variant,
  pulse,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count: number;
  variant: "pending" | "preparing" | "ready";
  pulse?: boolean;
}) {
  const styles = {
    pending: "bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-400",
    preparing: "bg-blue-500/15 border-blue-500/30 text-blue-700 dark:text-blue-400",
    ready: "bg-green-500/15 border-green-500/30 text-green-700 dark:text-green-400",
  };

  const countBg = {
    pending: "bg-amber-500 text-white",
    preparing: "bg-blue-500 text-white",
    ready: "bg-green-500 text-white",
  };

  return (
    <div
      className={cn(
        "flex items-center justify-between p-3 rounded-lg border sticky top-0 z-10 backdrop-blur-sm",
        styles[variant],
        pulse && "animate-pulse"
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-5 w-5" />
        <h2 className="font-bold text-sm uppercase tracking-wide">{label}</h2>
      </div>
      <span
        className={cn(
          "flex items-center justify-center h-7 w-7 rounded-full text-sm font-bold",
          countBg[variant]
        )}
      >
        {count}
      </span>
    </div>
  );
}

export default function KitchenPage() {
  const { accessToken, selectedBranchId } = useAuthStore();
  const { data, isLoading, error, refetch } = useKitchenOrders();
  const updateItemStatus = useUpdateKitchenItemStatus();
  const updateOrderStatus = useUpdateOrderStatus();

  const handleWsMessage = useCallback((msg: WsMessage) => {
    if (
      msg.type === "order:new" ||
      msg.type === "order:updated" ||
      msg.type === "order:item_status"
    ) {
      refetch();
    }
  }, [refetch]);

  useWebSocket(
    selectedBranchId ? [`branch:${selectedBranchId}:kitchen`] : [],
    handleWsMessage,
    accessToken || undefined
  );

  const orders: any[] = data ?? [];

  const columns = {
    pending: orders.filter((o: any) => o.status === "pending"),
    preparing: orders.filter((o: any) => o.status === "preparing"),
    ready: orders.filter((o: any) => o.status === "ready"),
  };

  const advanceOrder = (orderId: string, currentStatus: string) => {
    const newStatus =
      currentStatus === "pending"
        ? "preparing"
        : currentStatus === "preparing"
          ? "ready"
          : currentStatus === "ready"
            ? "served"
            : currentStatus;
    updateOrderStatus.mutate({ id: orderId, status: newStatus });
  };

  if (error) {
    return (
      <div className="space-y-4 h-full">
        <h1 className="text-2xl font-bold">Cocina (KDS)</h1>
        <div className="p-4 rounded-lg border border-destructive/50 bg-destructive/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <p className="text-sm text-destructive">Error al cargar ordenes: {(error as Error).message}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] gap-3">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">Cocina</h1>
          <Badge variant="secondary" className="font-mono text-xs">
            KDS
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-sm tabular-nums">
            {isLoading ? "..." : `${orders.length} ordenes`}
          </Badge>
          <Button variant="ghost" size="sm" onClick={() => refetch()} className="h-8 w-8 p-0">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 flex-1 min-h-0">
          {Array.from({ length: 3 }).map((_, colIdx) => (
            <div key={colIdx} className="space-y-3">
              <Skeleton className="h-12 w-full rounded-lg" />
              {Array.from({ length: 2 }).map((_, cardIdx) => (
                <Skeleton key={cardIdx} className="h-40 w-full rounded-lg" />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 flex-1 min-h-0">
          {/* Pendientes Column */}
          <div className="flex flex-col gap-2 overflow-y-auto pr-1">
            <ColumnHeader
              icon={Clock}
              label="Pendientes"
              count={columns.pending.length}
              variant="pending"
              pulse={columns.pending.length > 0}
            />
            {columns.pending.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Clock className="h-8 w-8 mb-2 opacity-30" />
                <p className="text-sm">Sin ordenes pendientes</p>
              </div>
            ) : (
              columns.pending.map((order: any) => (
                <KitchenOrderCard
                  key={order.id}
                  order={order}
                  columnStatus="pending"
                  onAdvance={advanceOrder}
                  onItemReady={() => {}}
                  isAdvancing={updateOrderStatus.isPending}
                  isUpdatingItem={false}
                />
              ))
            )}
          </div>

          {/* Preparando Column */}
          <div className="flex flex-col gap-2 overflow-y-auto pr-1">
            <ColumnHeader
              icon={ChefHat}
              label="Preparando"
              count={columns.preparing.length}
              variant="preparing"
            />
            {columns.preparing.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <ChefHat className="h-8 w-8 mb-2 opacity-30" />
                <p className="text-sm">Nada en preparacion</p>
              </div>
            ) : (
              columns.preparing.map((order: any) => (
                <KitchenOrderCard
                  key={order.id}
                  order={order}
                  columnStatus="preparing"
                  onAdvance={advanceOrder}
                  onItemReady={(itemId) =>
                    updateItemStatus.mutate({ id: itemId, status: "ready" })
                  }
                  isAdvancing={updateOrderStatus.isPending}
                  isUpdatingItem={updateItemStatus.isPending}
                />
              ))
            )}
          </div>

          {/* Listos Column */}
          <div className="flex flex-col gap-2 overflow-y-auto pr-1">
            <ColumnHeader
              icon={CheckCircle}
              label="Listos"
              count={columns.ready.length}
              variant="ready"
            />
            {columns.ready.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <CheckCircle className="h-8 w-8 mb-2 opacity-30" />
                <p className="text-sm">Sin ordenes listas</p>
              </div>
            ) : (
              columns.ready.map((order: any) => (
                <KitchenOrderCard
                  key={order.id}
                  order={order}
                  columnStatus="ready"
                  onAdvance={advanceOrder}
                  onItemReady={() => {}}
                  isAdvancing={updateOrderStatus.isPending}
                  isUpdatingItem={false}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
