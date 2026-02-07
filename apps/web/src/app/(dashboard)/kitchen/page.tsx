"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  ChevronDown,
  ChevronUp,
  Printer,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useKitchenOrders, useUpdateKitchenItemStatus } from "@/hooks/use-kitchen";
import { useUpdateOrderStatus } from "@/hooks/use-orders";
import { usePrintKitchenTicket } from "@/components/print-ticket";
import type { WsMessage } from "@restai/types";

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-muted rounded", className)} />;
}

function getMinutesDiff(createdAt: string): number {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
}

function getTimeDiff(createdAt: string): string {
  const diff = getMinutesDiff(createdAt);
  if (diff < 1) return "<1m";
  return `${diff}m`;
}

function getTimeUrgency(createdAt: string): "normal" | "warning" | "urgent" {
  const diff = getMinutesDiff(createdAt);
  if (diff >= 15) return "urgent";
  if (diff >= 5) return "warning";
  return "normal";
}

/** Hook to force re-render every 10s so timers stay accurate */
function useTimerTick(intervalMs = 10000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}

const VISIBLE_ITEMS_LIMIT = 4;

function ItemRow({
  item,
  columnStatus,
  isUpdatingItem,
  onItemReady,
}: {
  item: any;
  columnStatus: "pending" | "preparing" | "ready";
  isUpdatingItem: boolean;
  onItemReady: (itemId: string) => void;
}) {
  const isItemReady = item.status === "ready";
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 px-3 py-2 rounded-md text-sm",
        isItemReady
          ? "bg-green-500/10 text-muted-foreground"
          : "bg-muted/50"
      )}
    >
      <div className="flex-1 min-w-0">
        <span className={cn("leading-tight", isItemReady && "line-through text-muted-foreground")}>
          <span className="font-bold text-foreground mr-1">{item.quantity}x</span>
          <span className="font-medium">{item.name}</span>
        </span>
        {item.notes && (
          <p className="text-xs mt-0.5 px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-medium leading-tight">
            {item.notes}
          </p>
        )}
      </div>
      {columnStatus === "preparing" && (
        isItemReady ? (
          <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
        ) : (
          <button
            className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 px-2 py-1 rounded transition-colors shrink-0"
            disabled={isUpdatingItem}
            onClick={() => onItemReady(item.id)}
          >
            Listo
          </button>
        )
      )}
    </div>
  );
}

function ElapsedTimerBadge({ createdAt }: { createdAt: string }) {
  const urgency = getTimeUrgency(createdAt);
  const timeStr = getTimeDiff(createdAt);

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono font-bold tabular-nums text-lg leading-none",
        urgency === "urgent"
          ? "bg-red-500 text-white animate-pulse"
          : urgency === "warning"
            ? "bg-amber-500 text-white"
            : "bg-green-600 text-white"
      )}
    >
      <Timer className="h-5 w-5" />
      {timeStr}
    </div>
  );
}

function KitchenOrderCard({
  order,
  columnStatus,
  onAdvance,
  onItemReady,
  onPrint,
  isAdvancing,
  isUpdatingItem,
  isNew,
}: {
  order: any;
  columnStatus: "pending" | "preparing" | "ready";
  onAdvance: (orderId: string, status: string) => void;
  onItemReady: (itemId: string) => void;
  onPrint: (order: any) => void;
  isAdvancing: boolean;
  isUpdatingItem: boolean;
  isNew?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const orderNum = order.orderNumber || order.order_number || order.id;
  const tableName = order.tableName || order.table_name || "";
  const createdAt = order.createdAt || order.created_at || "";
  const items: any[] = order.items || [];
  const urgency = createdAt ? getTimeUrgency(createdAt) : "normal";

  const hasOverflow = items.length > VISIBLE_ITEMS_LIMIT;
  const visibleItems = expanded ? items : items.slice(0, VISIBLE_ITEMS_LIMIT);
  const hiddenCount = items.length - VISIBLE_ITEMS_LIMIT;

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
        : "bg-amber-500"
      : columnStatus === "preparing"
        ? "bg-blue-500"
        : "bg-green-500";

  return (
    <div
      className={cn(
        "rounded-xl border-2 overflow-hidden bg-card shadow-sm transition-all",
        borderColor,
        urgency === "urgent" && columnStatus === "pending" && "ring-2 ring-red-500/30",
        isNew && "animate-kitchen-flash"
      )}
    >
      {/* Card Header */}
      <div className={cn("px-4 py-3 flex items-center justify-between", headerBg)}>
        <div className="flex items-center gap-3">
          <span className="text-white font-black text-2xl md:text-3xl tracking-tight">
            #{orderNum}
          </span>
          {tableName && (
            <span className="text-white/90 text-base font-semibold bg-white/20 px-2 py-0.5 rounded">
              {tableName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="text-white/70 hover:text-white p-2 rounded-lg transition-colors"
            onClick={() => onPrint(order)}
            title="Imprimir Ticket"
          >
            <Printer className="h-5 w-5" />
          </button>
          {createdAt && <ElapsedTimerBadge createdAt={createdAt} />}
        </div>
      </div>

      {/* Items List */}
      <div className="p-2 space-y-1">
        {visibleItems.map((item: any) => (
          <ItemRow
            key={item.id}
            item={item}
            columnStatus={columnStatus}
            isUpdatingItem={isUpdatingItem}
            onItemReady={onItemReady}
          />
        ))}
        {hasOverflow && (
          <button
            className="flex items-center gap-1 w-full px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded transition-colors"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3.5 w-3.5" />
                Mostrar menos
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" />
                y {hiddenCount} mas...
              </>
            )}
          </button>
        )}
      </div>

      {/* Order-level notes */}
      {order.notes && (
        <div className="mx-2 mb-2 px-3 py-2 rounded-md bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-sm font-medium">
          {order.notes}
        </div>
      )}

      {/* Action Button - touch friendly */}
      <div className="p-2 pt-0">
        {columnStatus === "pending" && (
          <Button
            className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold h-12 text-base"
            disabled={isAdvancing}
            onClick={() => onAdvance(order.id, "pending")}
          >
            Preparar
            <ArrowRight className="h-5 w-5 ml-2" />
          </Button>
        )}
        {columnStatus === "preparing" && (
          <Button
            className="w-full bg-green-500 hover:bg-green-600 text-white font-bold h-12 text-base"
            disabled={isAdvancing}
            onClick={() => onAdvance(order.id, "preparing")}
          >
            <CheckCircle className="h-5 w-5 mr-2" />
            Listo
          </Button>
        )}
        {columnStatus === "ready" && (
          <Button
            variant="outline"
            className="w-full border-gray-400 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 font-bold h-12 text-base"
            disabled={isAdvancing}
            onClick={() => onAdvance(order.id, "ready")}
          >
            <UtensilsCrossed className="h-5 w-5 mr-2" />
            Entregado
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
          "flex items-center justify-center h-7 min-w-7 px-1.5 rounded-full text-sm font-bold",
          countBg[variant]
        )}
      >
        {count}
      </span>
    </div>
  );
}

type TabKey = "pending" | "preparing" | "ready";

const TAB_CONFIG: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "pending", label: "Pendientes", icon: Clock },
  { key: "preparing", label: "Preparando", icon: ChefHat },
  { key: "ready", label: "Listos", icon: CheckCircle },
];

export default function KitchenPage() {
  useTimerTick();
  const { accessToken, selectedBranchId } = useAuthStore();
  const { data, isLoading, error, refetch } = useKitchenOrders();
  const updateItemStatus = useUpdateKitchenItemStatus();
  const updateOrderStatus = useUpdateOrderStatus();
  const printKitchenTicket = usePrintKitchenTicket();

  const [activeTab, setActiveTab] = useState<TabKey>("pending");
  const [newOrderIds, setNewOrderIds] = useState<Set<string>>(new Set());
  const prevOrderIdsRef = useRef<Set<string>>(new Set());

  // Track new orders for flash animation
  useEffect(() => {
    if (!data) return;
    const orders: any[] = data;
    const currentIds = new Set(orders.map((o: any) => o.id));
    const prevIds = prevOrderIdsRef.current;

    if (prevIds.size > 0) {
      const freshIds = new Set<string>();
      currentIds.forEach((id) => {
        if (!prevIds.has(id)) freshIds.add(id);
      });
      if (freshIds.size > 0) {
        setNewOrderIds(freshIds);
        const timeout = setTimeout(() => setNewOrderIds(new Set()), 2000);
        return () => clearTimeout(timeout);
      }
    }
    prevOrderIdsRef.current = currentIds;
  }, [data]);

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

  const handlePrint = useCallback((order: any) => {
    printKitchenTicket({
      orderNumber: order.orderNumber || order.order_number || order.id,
      tableNumber: order.tableName || order.table_name || undefined,
      customerName: order.customerName || order.customer_name || undefined,
      createdAt: order.createdAt || order.created_at || new Date().toISOString(),
      items: (order.items || []).map((i: any) => ({
        name: i.name,
        quantity: i.quantity,
        unit_price: i.unit_price || 0,
        total: i.total || 0,
        notes: i.notes,
      })),
      notes: order.notes,
    });
  }, [printKitchenTicket]);

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

  const renderColumn = (status: TabKey) => {
    const config = {
      pending: { icon: Clock, label: "Pendientes", variant: "pending" as const },
      preparing: { icon: ChefHat, label: "En Preparacion", variant: "preparing" as const },
      ready: { icon: CheckCircle, label: "Listos", variant: "ready" as const },
    }[status];

    const columnOrders = columns[status];

    return (
      <div className="flex flex-col gap-2 min-h-0 overflow-y-auto pr-1" style={{ maxHeight: "calc(100vh - 10rem)" }}>
        <ColumnHeader
          icon={config.icon}
          label={config.label}
          count={columnOrders.length}
          variant={config.variant}
          pulse={status === "pending" && columnOrders.length > 0}
        />
        {columnOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <config.icon className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm">
              {status === "pending" && "Sin ordenes pendientes"}
              {status === "preparing" && "Nada en preparacion"}
              {status === "ready" && "Sin ordenes listas"}
            </p>
          </div>
        ) : (
          columnOrders.map((order: any) => (
            <KitchenOrderCard
              key={order.id}
              order={order}
              columnStatus={status}
              onAdvance={advanceOrder}
              onPrint={handlePrint}
              onItemReady={
                status === "preparing"
                  ? (itemId) => updateItemStatus.mutate({ id: itemId, status: "ready" })
                  : () => {}
              }
              isAdvancing={updateOrderStatus.isPending}
              isUpdatingItem={updateItemStatus.isPending}
              isNew={newOrderIds.has(order.id)}
            />
          ))
        )}
      </div>
    );
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
      {/* flash animation keyframes */}
      <style>{`
        @keyframes kitchen-flash {
          0%, 100% { box-shadow: 0 0 0 0 rgba(250, 204, 21, 0); }
          25% { box-shadow: 0 0 0 4px rgba(250, 204, 21, 0.6); }
          50% { box-shadow: 0 0 0 0 rgba(250, 204, 21, 0); }
          75% { box-shadow: 0 0 0 4px rgba(250, 204, 21, 0.4); }
        }
        .animate-kitchen-flash {
          animation: kitchen-flash 1s ease-in-out 2;
        }
      `}</style>

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
        <>
          {/* Mobile tabs - visible only on small screens */}
          <div className="flex md:hidden gap-1 shrink-0">
            {TAB_CONFIG.map(({ key, label, icon: TabIcon }) => (
              <button
                key={key}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-lg text-sm font-semibold transition-colors",
                  activeTab === key
                    ? key === "pending"
                      ? "bg-amber-500 text-white"
                      : key === "preparing"
                        ? "bg-blue-500 text-white"
                        : "bg-green-500 text-white"
                    : "bg-muted text-muted-foreground"
                )}
                onClick={() => setActiveTab(key)}
              >
                <TabIcon className="h-4 w-4" />
                {label}
                {columns[key].length > 0 && (
                  <span className={cn(
                    "ml-0.5 text-xs rounded-full h-5 min-w-5 px-1 flex items-center justify-center font-bold",
                    activeTab === key ? "bg-white/30 text-white" : "bg-foreground/10"
                  )}>
                    {columns[key].length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Mobile: single column view */}
          <div className="flex-1 min-h-0 md:hidden">
            {renderColumn(activeTab)}
          </div>

          {/* Desktop: 3-column Kanban */}
          <div className="hidden md:grid md:grid-cols-3 gap-3 flex-1 min-h-0">
            {renderColumn("pending")}
            {renderColumn("preparing")}
            {renderColumn("ready")}
          </div>
        </>
      )}
    </div>
  );
}
