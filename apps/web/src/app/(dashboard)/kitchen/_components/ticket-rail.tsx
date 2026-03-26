"use client";

import { useEffect, useRef, useState } from "react";
import { Badge } from "@restai/ui/components/badge";
import { Button } from "@restai/ui/components/button";
import { Clock, ChefHat, CheckCircle, Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useKitchenContext } from "./kitchen-context";
import { TicketCard } from "./ticket-card";

type FilterKey = "all" | "pending" | "preparing" | "ready" | "delivery";

const FILTERS: { key: FilterKey; label: string; icon?: React.ComponentType<{ className?: string }> }[] = [
  { key: "all", label: "Todos" },
  { key: "pending", label: "Pendientes", icon: Clock },
  { key: "preparing", label: "Preparando", icon: ChefHat },
  { key: "ready", label: "Listos", icon: CheckCircle },
  { key: "delivery", label: "Delivery", icon: Truck },
];

export function TicketRail() {
  const {
    sortedOrders,
    columns,
    deliveryCount,
    advanceOrder,
    handleItemReady,
    handlePrint,
    newOrderIds,
    isAdvancing,
    isUpdatingItem,
  } = useKitchenContext();

  const [filter, setFilter] = useState<FilterKey>("all");
  const railRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(sortedOrders.length);

  // Auto-scroll to start when a new ticket arrives
  useEffect(() => {
    if (sortedOrders.length > prevCountRef.current && railRef.current) {
      railRef.current.scrollTo({ left: 0, behavior: "smooth" });
    }
    prevCountRef.current = sortedOrders.length;
  }, [sortedOrders.length]);

  // Apply filter
  const filteredOrders = sortedOrders.filter((o: any) => {
    if (filter === "all") return true;
    if (filter === "delivery") return o.type === "delivery";
    return o.status === filter;
  });

  // Group boundaries for separators
  const getStatusGroup = (order: any) => order.status as string;

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-3">
      {/* Filter chips + counters */}
      <div className="flex items-center gap-2 flex-wrap">
        {FILTERS.map((f) => {
          const count =
            f.key === "all" ? sortedOrders.length
            : f.key === "delivery" ? deliveryCount
            : columns[f.key as keyof typeof columns]?.length ?? 0;

          const Icon = f.icon;

          return (
            <Button
              key={f.key}
              variant={filter === f.key ? "default" : "outline"}
              size="sm"
              className={cn(
                "gap-1.5",
                filter === f.key && f.key === "delivery" && "bg-violet-600 hover:bg-violet-700",
              )}
              onClick={() => setFilter(f.key)}
            >
              {Icon && <Icon className="h-3.5 w-3.5" />}
              {f.label}
              {count > 0 && (
                <Badge
                  variant="secondary"
                  className={cn(
                    "ml-0.5 h-5 min-w-5 text-[10px] px-1",
                    filter === f.key && "bg-white/20 text-white",
                  )}
                >
                  {count}
                </Badge>
              )}
            </Button>
          );
        })}
      </div>

      {/* Ticket rail */}
      {filteredOrders.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <ChefHat className="h-16 w-16 mx-auto mb-3 opacity-20" />
            <p className="text-lg font-medium">Sin tickets</p>
            <p className="text-sm">Los pedidos apareceran aqui</p>
          </div>
        </div>
      ) : (
        <div
          ref={railRef}
          className="flex-1 flex gap-3 overflow-x-auto overflow-y-hidden pb-2 snap-x snap-mandatory scroll-smooth"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          {filteredOrders.map((order: any, i: number) => {
            // Separator between status groups
            const prevOrder = i > 0 ? filteredOrders[i - 1] : null;
            const showSeparator = prevOrder && getStatusGroup(prevOrder) !== getStatusGroup(order) && filter === "all";

            return (
              <div key={order.id} className="flex gap-3">
                {showSeparator && (
                  <div className="flex-shrink-0 flex items-center px-1">
                    <div className="w-px h-3/4 bg-zinc-300 dark:bg-zinc-600 relative">
                      <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-zinc-100 dark:bg-zinc-900 px-2 py-1 text-[10px] font-bold text-zinc-400 uppercase tracking-widest whitespace-nowrap rounded">
                        {order.status === "preparing" ? "en prep" : order.status === "ready" ? "listos" : order.status}
                      </span>
                    </div>
                  </div>
                )}
                <TicketCard
                  order={order}
                  onAdvance={advanceOrder}
                  onItemReady={handleItemReady}
                  onPrint={handlePrint}
                  isAdvancing={isAdvancing}
                  isUpdatingItem={isUpdatingItem}
                  isNew={newOrderIds.has(order.id)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
