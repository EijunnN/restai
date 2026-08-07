"use client";

import { useState } from "react";
import { Clock, ChefHat, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ColumnHeader } from "./column-header";
import { KitchenOrderCard } from "./order-card";
import { useKitchenContext } from "./kitchen-context";

type TabKey = "pending" | "preparing" | "ready";

const TAB_CONFIG: {
  key: TabKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  emptyLabel: string;
  dot: string;
}[] = [
  { key: "pending", label: "En cola", icon: Clock, emptyLabel: "Sin órdenes en cola", dot: "bg-amber-500" },
  { key: "preparing", label: "Preparando", icon: ChefHat, emptyLabel: "Nada en preparación", dot: "bg-blue-500" },
  { key: "ready", label: "Listos", icon: CheckCircle2, emptyLabel: "Sin órdenes listas", dot: "bg-green-500" },
];

function MobileColumn({ status }: { status: TabKey }) {
  const {
    views,
    advanceOrder,
    goBackOrder,
    handlePrint,
    newOrderIds,
    pendingOrderIds,
    orders,
  } = useKitchenContext();

  const config = TAB_CONFIG.find((t) => t.key === status)!;
  const cards = views[status];

  return (
    <div className="flex min-h-0 flex-col">
      <ColumnHeader
        label={config.label}
        count={cards.length}
        variant={status}
        oldest={cards[0]?.timeLabel}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3">
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
    </div>
  );
}

export function MobileTabs() {
  const [activeTab, setActiveTab] = useState<TabKey>("pending");
  const { views } = useKitchenContext();

  return (
    <div className="flex min-h-0 flex-1 flex-col md:hidden">
      {/*
        Pestañas sobrias, del mismo lenguaje que el tablero de escritorio: un
        punto de color y el contador. Antes cada pestaña activa se pintaba de un
        color pleno distinto, y con la tarjeta ya coloreada la pantalla acababa
        pareciendo un semáforo averiado.
      */}
      <div className="flex shrink-0 gap-1 border-b border-border px-2">
        {TAB_CONFIG.map(({ key, label, dot }) => {
          const active = activeTab === key;
          return (
            <button
              key={key}
              type="button"
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 border-b-2 px-2 py-3 text-[13px] font-semibold transition-colors",
                active
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground",
              )}
              onClick={() => setActiveTab(key)}
            >
              <span className={cn("h-1.5 w-1.5 rounded-[2px]", dot)} />
              {label}
              {views[key].length > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded px-1 text-[11px] font-bold tabular-nums bg-foreground/[0.08] dark:bg-white/[0.08]">
                  {views[key].length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1">
        <MobileColumn status={activeTab} />
      </div>
    </div>
  );
}
