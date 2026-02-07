"use client";

import { Clock, ChefHat, CheckCircle } from "lucide-react";
import { ColumnHeader } from "./column-header";
import { KitchenOrderCard } from "./order-card";
import { useKitchenContext } from "./kitchen-context";

type TabKey = "pending" | "preparing" | "ready";

const COLUMN_CONFIG: Record<
  TabKey,
  { icon: React.ComponentType<{ className?: string }>; label: string; emptyLabel: string }
> = {
  pending: { icon: Clock, label: "Pendientes", emptyLabel: "Sin ordenes pendientes" },
  preparing: { icon: ChefHat, label: "En Preparacion", emptyLabel: "Nada en preparacion" },
  ready: { icon: CheckCircle, label: "Listos", emptyLabel: "Sin ordenes listas" },
};

function KanbanColumn({ status }: { status: TabKey }) {
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

export function KanbanBoard() {
  return (
    <div className="hidden md:grid md:grid-cols-3 gap-3 flex-1 min-h-0">
      <KanbanColumn status="pending" />
      <KanbanColumn status="preparing" />
      <KanbanColumn status="ready" />
    </div>
  );
}
