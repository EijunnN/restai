"use client";

import { Clock, ChefHat, CheckCircle2 } from "lucide-react";
import { ColumnHeader } from "./column-header";
import { KitchenOrderCard } from "./order-card";
import { useKitchenContext } from "./kitchen-context";

type TabKey = "pending" | "preparing" | "ready";

const COLUMN_CONFIG: Record<
  TabKey,
  { icon: React.ComponentType<{ className?: string }>; label: string; emptyLabel: string }
> = {
  pending: { icon: Clock, label: "En cola", emptyLabel: "Sin órdenes en cola" },
  preparing: { icon: ChefHat, label: "Preparando", emptyLabel: "Nada en preparación" },
  ready: { icon: CheckCircle2, label: "Listos para pasar", emptyLabel: "Sin órdenes listas" },
};

function KanbanColumn({ status }: { status: TabKey }) {
  const {
    views,
    advanceOrder,
    goBackOrder,
    handlePrint,
    newOrderIds,
    pendingOrderIds,
    orders,
  } = useKitchenContext();

  const config = COLUMN_CONFIG[status];
  const cards = views[status];

  // Cuántas se entregaron hoy no lo sabe el tablero (solo ve lo que sigue en
  // cocina), así que la columna de listos muestra el dato que sí es suyo y sí
  // importa en el pase: cuántas están esperando a que alguien las recoja.
  const servedMeta =
    status === "ready"
      ? cards.length > 0
        ? `${cards.length} esperando pase`
        : undefined
      : undefined;

  return (
    <section className="flex min-h-0 flex-col bg-background">
      <ColumnHeader
        label={config.label}
        count={cards.length}
        variant={status}
        oldest={cards[0]?.timeLabel}
        meta={servedMeta}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overflow-x-hidden p-3">
        {cards.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2.5 py-14 text-muted-foreground opacity-60">
            <config.icon className="h-7 w-7" />
            <p className="text-[13px]">{config.emptyLabel}</p>
          </div>
        ) : (
          cards.map((card) => (
            <KitchenOrderCard
              key={card.order.id}
              view={card}
              columnStatus={status}
              onAdvance={advanceOrder}
              onBack={goBackOrder}
              onPrint={handlePrint}
              isAdvancing={pendingOrderIds.has(card.order.id)}
              isNew={newOrderIds.has(card.order.id)}
              totalInBoard={orders.length}
            />
          ))
        )}
      </div>
    </section>
  );
}

/**
 * Tablero de tres columnas.
 *
 * Las columnas se separan con una rejilla de 1px sobre el color del borde: es
 * una división más nítida que un `gap` vacío en una pantalla que se mira de
 * lejos y de reojo, y no gasta espacio horizontal, que en cocina es lo único
 * que escasea.
 */
export function KanbanBoard() {
  return (
    <div className="hidden min-h-0 flex-1 gap-px bg-border md:grid md:grid-cols-3">
      <KanbanColumn status="pending" />
      <KanbanColumn status="preparing" />
      <KanbanColumn status="ready" />
    </div>
  );
}
