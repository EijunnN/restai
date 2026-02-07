"use client";

import { useState } from "react";
import { Clock, ChefHat, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { ColumnHeader } from "./column-header";
import { KitchenOrderCard } from "./order-card";
import { useKitchenContext } from "./kitchen-context";

type TabKey = "pending" | "preparing" | "ready";

const TAB_CONFIG: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "pending", label: "Pendientes", icon: Clock },
  { key: "preparing", label: "Preparando", icon: ChefHat },
  { key: "ready", label: "Listos", icon: CheckCircle },
];

const COLUMN_CONFIG: Record<
  TabKey,
  { icon: React.ComponentType<{ className?: string }>; label: string; emptyLabel: string }
> = {
  pending: { icon: Clock, label: "Pendientes", emptyLabel: "Sin ordenes pendientes" },
  preparing: { icon: ChefHat, label: "En Preparacion", emptyLabel: "Nada en preparacion" },
  ready: { icon: CheckCircle, label: "Listos", emptyLabel: "Sin ordenes listas" },
};

function MobileColumn({ status }: { status: TabKey }) {
  const {
    columns,
    advanceOrder,
    handleItemReady,
    handlePrint,
    newOrderIds,
    isAdvancing,
    isUpdatingItem,
  } = useKitchenContext();

  const config = COLUMN_CONFIG[status];
  const columnOrders = columns[status];

  return (
    <div className="flex flex-col gap-2 min-h-0 overflow-y-auto pr-1" style={{ maxHeight: "calc(100vh - 10rem)" }}>
      <ColumnHeader
        icon={config.icon}
        label={config.label}
        count={columnOrders.length}
        variant={status}
        pulse={status === "pending" && columnOrders.length > 0}
      />
      {columnOrders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <config.icon className="h-10 w-10 mb-3 opacity-30" />
          <p className="text-sm">{config.emptyLabel}</p>
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
                ? (itemId) => handleItemReady(itemId)
                : () => {}
            }
            isAdvancing={isAdvancing}
            isUpdatingItem={isUpdatingItem}
            isNew={newOrderIds.has(order.id)}
          />
        ))
      )}
    </div>
  );
}

export function MobileTabs() {
  const [activeTab, setActiveTab] = useState<TabKey>("pending");
  const { columns } = useKitchenContext();

  return (
    <>
      {/* Tab bar */}
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

      {/* Single column view */}
      <div className="flex-1 min-h-0 md:hidden">
        <MobileColumn status={activeTab} />
      </div>
    </>
  );
}
