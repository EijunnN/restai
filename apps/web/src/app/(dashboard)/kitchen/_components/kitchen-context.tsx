"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useWebSocket } from "@/hooks/use-websocket";
import { useAuthStore } from "@/stores/auth-store";
import { useKitchenOrders, useUpdateKitchenItemStatus } from "@/hooks/use-kitchen";
import { useUpdateOrderStatus } from "@/hooks/use-orders";
import { usePrintKitchenTicket } from "@/components/print-ticket";
import type { WsMessage } from "@restai/types";

// ── Time helpers ──

export function getMinutesDiff(createdAt: string): number {
  const date = new Date(createdAt);
  if (isNaN(date.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
}

export function getTimeDiff(createdAt: string): string {
  const diff = getMinutesDiff(createdAt);
  if (diff < 1) return "<1m";
  if (diff >= 60) {
    const hours = Math.floor(diff / 60);
    const mins = diff % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  return `${diff}m`;
}

export function getTimeUrgency(createdAt: string): "normal" | "warning" | "urgent" {
  const diff = getMinutesDiff(createdAt);
  if (diff >= 15) return "urgent";
  if (diff >= 5) return "warning";
  return "normal";
}

/** Hook to force re-render every 10s so timers stay accurate */
export function useTimerTick(intervalMs = 10000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}

// ── Context ──

interface KitchenContextValue {
  orders: any[];
  columns: { pending: any[]; preparing: any[]; ready: any[] };
  advanceOrder: (orderId: string, currentStatus: string) => void;
  handleItemReady: (itemId: string) => void;
  handlePrint: (order: any) => void;
  newOrderIds: Set<string>;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
  isAdvancing: boolean;
  isUpdatingItem: boolean;
}

const KitchenContext = createContext<KitchenContextValue | null>(null);

export function useKitchenContext() {
  const ctx = useContext(KitchenContext);
  if (!ctx) throw new Error("useKitchenContext must be used within KitchenProvider");
  return ctx;
}

export function KitchenProvider({ children }: { children: ReactNode }) {
  useTimerTick();

  const { accessToken, selectedBranchId } = useAuthStore();
  const { data, isLoading, error, refetch } = useKitchenOrders();
  const updateItemStatus = useUpdateKitchenItemStatus();
  const updateOrderStatus = useUpdateOrderStatus();
  const printKitchenTicket = usePrintKitchenTicket();

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

  const handleWsMessage = useCallback(
    (msg: WsMessage) => {
      if (
        msg.type === "order:new" ||
        msg.type === "order:updated" ||
        msg.type === "order:item_status" ||
        msg.type === "order:cancelled"
      ) {
        refetch();
      }
    },
    [refetch]
  );

  useWebSocket(
    selectedBranchId ? [`branch:${selectedBranchId}:kitchen`] : [],
    handleWsMessage,
    accessToken || undefined
  );

  const handlePrint = useCallback(
    (order: any) => {
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
    },
    [printKitchenTicket]
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

  const handleItemReady = (itemId: string) => {
    updateItemStatus.mutate({ id: itemId, status: "ready" });
  };

  return (
    <KitchenContext.Provider
      value={{
        orders,
        columns,
        advanceOrder,
        handleItemReady,
        handlePrint,
        newOrderIds,
        isLoading,
        error: error as Error | null,
        refetch,
        isAdvancing: updateOrderStatus.isPending,
        isUpdatingItem: updateItemStatus.isPending,
      }}
    >
      {children}
    </KitchenContext.Provider>
  );
}
