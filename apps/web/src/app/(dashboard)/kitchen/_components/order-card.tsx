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
  Hash,
  ReceiptText,
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
  priorityRank,
  onAdvance,
  onItemReady,
  onPrint,
  isAdvancing,
  isUpdatingItem,
  isNew,
}: {
  order: any;
  columnStatus: "pending" | "preparing" | "ready";
  priorityRank: number;
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
  const isDelivery = order.type === "delivery";
  const isTakeout = order.type === "takeout";
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
        ? "bg-red-600"
        : "bg-amber-500"
      : columnStatus === "preparing"
        ? "bg-blue-600"
        : "bg-green-600";

  const queueLabel = priorityRank === 1 ? "Primero en cola" : `Prioridad ${priorityRank}`;
  const detailLabel = isDelivery
    ? "Delivery"
    : isTakeout
      ? "Para llevar"
      : tableName
        ? `Mesa ${tableName}`
        : order.customer_name || order.customerName || "Salon";

  return (
    <div
      className={cn(
        "overflow-hidden rounded-[24px] border-2 bg-card shadow-sm transition-all",
        borderColor,
        urgency === "urgent" && columnStatus === "pending" && "ring-4 ring-red-500/20",
        isNew && "animate-kitchen-flash"
      )}
    >
      <div className={cn("px-4 py-4 text-white", headerBg)}>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-3 min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full bg-black/20 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.18em]">
              <Hash className="h-3.5 w-3.5" />
              {queueLabel}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-black text-3xl tracking-tight md:text-4xl">
                #{orderNum}
              </span>
              <span className="rounded-full bg-white/15 px-3 py-1 text-sm font-semibold">
                {detailLabel}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-white/85">
              <span className="inline-flex items-center gap-1 rounded-full bg-black/15 px-2.5 py-1 font-medium">
                <ReceiptText className="h-3.5 w-3.5" />
                {items.length} items
              </span>
              {order.notes && (
                <span className="inline-flex items-center rounded-full bg-black/15 px-2.5 py-1 font-medium">
                  Nota en pedido
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            {createdAt && <ElapsedTimerBadge createdAt={createdAt} />}
            <button
              className="rounded-xl bg-black/15 p-2 text-white/80 transition-colors hover:bg-black/25 hover:text-white"
              onClick={() => onPrint(order)}
              title="Imprimir Ticket"
            >
              <Printer className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-3 p-3">
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
            className="flex w-full items-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
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
                Ver {hiddenCount} items mas
              </>
            )}
          </button>
        )}
        {order.notes && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-sm font-medium text-amber-700 dark:text-amber-300">
            {order.notes}
          </div>
        )}
      </div>

      <div className="border-t border-border px-3 py-3">
        {columnStatus === "pending" && (
          <Button
            className="h-12 w-full rounded-2xl bg-blue-600 text-base font-black uppercase tracking-wide text-white hover:bg-blue-700"
            disabled={isAdvancing}
            onClick={() => onAdvance(order.id, "pending")}
          >
            Preparar
            <ArrowRight className="h-5 w-5 ml-2" />
          </Button>
        )}
        {columnStatus === "preparing" && (
          <Button
            className="h-12 w-full rounded-2xl bg-green-600 text-base font-black uppercase tracking-wide text-white hover:bg-green-700"
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
            className="h-12 w-full rounded-2xl border-2 border-green-600/40 text-base font-black uppercase tracking-wide text-green-700 hover:bg-green-500/10 dark:text-green-300"
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
