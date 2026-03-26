"use client";

import { Button } from "@restai/ui/components/button";
import {
  CheckCircle,
  ArrowRight,
  UtensilsCrossed,
  Timer,
  Printer,
  Truck,
  Phone,
  MapPin,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getTimeDiff, getTimeUrgency } from "./kitchen-context";

function ItemRow({
  item,
  columnStatus,
  isUpdatingItem,
  onItemReady,
}: {
  item: any;
  columnStatus: string;
  isUpdatingItem: boolean;
  onItemReady: (itemId: string) => void;
}) {
  const isItemReady = item.status === "ready";
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-1 px-2 py-1.5 text-sm border-b border-dashed border-zinc-200 dark:border-zinc-700 last:border-0",
        isItemReady && "opacity-50"
      )}
    >
      <div className="flex-1 min-w-0">
        <span className={cn("leading-tight", isItemReady && "line-through")}>
          <span className="font-black text-base mr-1">{item.quantity}x</span>
          <span className="font-medium">{item.name}</span>
        </span>
        {item.notes && (
          <p className="text-xs mt-0.5 text-amber-600 dark:text-amber-400 font-medium">
            * {item.notes}
          </p>
        )}
      </div>
      {columnStatus === "preparing" && (
        isItemReady ? (
          <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
        ) : (
          <button
            className="text-xs font-bold text-blue-600 hover:bg-blue-500/10 px-2 py-1 rounded shrink-0"
            disabled={isUpdatingItem}
            onClick={() => onItemReady(item.id)}
          >
            OK
          </button>
        )
      )}
    </div>
  );
}

function TicketTimer({ createdAt }: { createdAt: string }) {
  const urgency = getTimeUrgency(createdAt);
  const timeStr = getTimeDiff(createdAt);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono font-bold text-xs tabular-nums",
        urgency === "urgent"
          ? "bg-red-500 text-white animate-pulse"
          : urgency === "warning"
            ? "bg-amber-500 text-white"
            : "bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300"
      )}
    >
      <Timer className="h-3 w-3" />
      {timeStr}
    </span>
  );
}

export function TicketCard({
  order,
  onAdvance,
  onItemReady,
  onPrint,
  isAdvancing,
  isUpdatingItem,
  isNew,
}: {
  order: any;
  onAdvance: (orderId: string, status: string) => void;
  onItemReady: (itemId: string) => void;
  onPrint: (order: any) => void;
  isAdvancing: boolean;
  isUpdatingItem: boolean;
  isNew?: boolean;
}) {
  const orderNum = order.order_number || order.orderNumber || order.id;
  const createdAt = order.created_at || order.createdAt || "";
  const items: any[] = order.items || [];
  const status = order.status;
  const isDelivery = order.type === "delivery";
  const isTakeout = order.type === "takeout";
  const tableName = order.tableName || order.table_name || "";
  const urgency = createdAt ? getTimeUrgency(createdAt) : "normal";

  // Colors by status
  const topBorderColor =
    status === "pending"
      ? urgency === "urgent" ? "border-t-red-500" : "border-t-amber-400"
      : status === "preparing"
        ? "border-t-blue-500"
        : "border-t-green-500";

  const deliveryAccent = isDelivery ? "border-l-4 border-l-violet-500" : "";

  return (
    <div
      className={cn(
        "flex-shrink-0 w-[220px] md:w-[240px] bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 border-t-4 overflow-hidden flex flex-col snap-start shadow-sm hover:shadow-md transition-shadow",
        topBorderColor,
        deliveryAccent,
        urgency === "urgent" && status === "pending" && "ring-2 ring-red-400/40",
        isNew && "animate-kitchen-flash"
      )}
    >
      {/* Ticket header */}
      <div className="px-3 py-2 flex items-center justify-between border-b border-zinc-100 dark:border-zinc-700">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-black text-xl tracking-tight">#{orderNum}</span>
          {createdAt && <TicketTimer createdAt={createdAt} />}
        </div>
        <button
          className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-1 rounded"
          onClick={() => onPrint(order)}
          title="Imprimir"
        >
          <Printer className="h-4 w-4" />
        </button>
      </div>

      {/* Type badge */}
      <div className="px-3 py-1.5 border-b border-zinc-100 dark:border-zinc-700">
        {isDelivery ? (
          <div className="space-y-1">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 text-xs font-bold uppercase tracking-wide">
              <Truck className="h-3 w-3" />
              Delivery
            </span>
            {order.delivery_phone && (
              <p className="flex items-center gap-1 text-xs text-zinc-500">
                <Phone className="h-3 w-3" />
                {order.delivery_phone}
              </p>
            )}
            {order.delivery_address && (
              <p className="flex items-center gap-1 text-xs text-zinc-500 truncate">
                <MapPin className="h-3 w-3 shrink-0" />
                {order.delivery_address}
              </p>
            )}
          </div>
        ) : isTakeout ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-xs font-bold uppercase tracking-wide">
            Para llevar
          </span>
        ) : (
          <span className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">
            {tableName ? `Mesa ${tableName}` : order.customer_name || order.customerName || ""}
          </span>
        )}
      </div>

      {/* Items — receipt style */}
      <div className="flex-1 px-1 py-1">
        {items.map((item: any) => (
          <ItemRow
            key={item.id}
            item={item}
            columnStatus={status}
            isUpdatingItem={isUpdatingItem}
            onItemReady={onItemReady}
          />
        ))}
      </div>

      {/* Order notes */}
      {order.notes && (
        <div className="mx-2 mb-1 px-2 py-1 rounded bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs font-medium">
          {order.notes}
        </div>
      )}

      {/* Action */}
      <div className="p-2 pt-1">
        {status === "pending" && (
          <Button
            className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold h-11"
            disabled={isAdvancing}
            onClick={() => onAdvance(order.id, "pending")}
          >
            PREPARAR
            <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        )}
        {status === "preparing" && (
          <Button
            className="w-full bg-green-500 hover:bg-green-600 text-white font-bold h-11"
            disabled={isAdvancing}
            onClick={() => onAdvance(order.id, "preparing")}
          >
            <CheckCircle className="h-4 w-4 mr-1" />
            LISTO
          </Button>
        )}
        {status === "ready" && (
          <Button
            variant="outline"
            className="w-full font-bold h-11"
            disabled={isAdvancing}
            onClick={() => onAdvance(order.id, "ready")}
          >
            <UtensilsCrossed className="h-4 w-4 mr-1" />
            ENTREGADO
          </Button>
        )}
      </div>
    </div>
  );
}
