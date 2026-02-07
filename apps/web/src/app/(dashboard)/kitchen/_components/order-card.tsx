"use client";

import { useState } from "react";
import { Button } from "@restai/ui/components/button";
import {
  CheckCircle,
  ArrowRight,
  UtensilsCrossed,
  Timer,
  ChevronDown,
  ChevronUp,
  Printer,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getTimeDiff, getTimeUrgency } from "./kitchen-context";

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

export function KitchenOrderCard({
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
