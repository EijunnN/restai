"use client";

import { Button } from "@restai/ui/components/button";
import { RefreshCw, AlertCircle, Clock3, ChefHat, CheckCircle2, Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import { KitchenProvider, useKitchenContext, getMinutesDiff, getTimeDiff } from "./_components/kitchen-context";
import { KanbanBoard } from "./_components/kanban-board";
import { MobileTabs } from "./_components/mobile-tabs";

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-muted rounded", className)} />;
}

function StatCard({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  tone: "neutral" | "pending" | "preparing" | "ready" | "urgent";
  icon: React.ComponentType<{ className?: string }>;
}) {
  const toneStyles = {
    neutral: "border-border bg-card text-foreground",
    pending: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    preparing: "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300",
    ready: "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300",
    urgent: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
  } as const;

  return (
    <div className={cn("rounded-2xl border px-4 py-3", toneStyles[tone])}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-80">
            {label}
          </p>
          <p className="mt-2 text-2xl font-black tracking-tight">{value}</p>
        </div>
        <div className="rounded-xl bg-background/70 p-2.5">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function KitchenContent() {
  const { orders, columns, isLoading, error, refetch } = useKitchenContext();
  const oldestPendingOrder = columns.pending[0];
  const urgentOrdersCount = orders.filter((order: { created_at?: string; createdAt?: string }) => {
    const createdAt = order.created_at || order.createdAt;
    return createdAt ? getMinutesDiff(createdAt) >= 15 : false;
  }).length;
  const oldestPendingTime = oldestPendingOrder
    ? getTimeDiff(oldestPendingOrder.created_at || oldestPendingOrder.createdAt || "")
    : "--";

  if (error) {
    return (
      <div className="space-y-4 h-full">
        <h1 className="text-2xl font-bold">Cocina (KDS)</h1>
        <div className="p-4 rounded-2xl border border-destructive/50 bg-destructive/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <p className="text-sm text-destructive">Error al cargar ordenes: {error.message}</p>
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
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-4 overflow-hidden bg-background">
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

      <div className="shrink-0 space-y-4">
        <div className="rounded-[28px] border border-border/70 bg-card px-5 py-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                <ChefHat className="h-3.5 w-3.5" />
                Kitchen Display System
              </div>
              <div>
                <h1 className="text-3xl font-black tracking-tight text-foreground">Cocina</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Orden mas antigua primero, contraste alto y acciones claras por estado.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 self-start lg:self-auto">
              <Button variant="outline" size="sm" onClick={() => refetch()} className="h-10 rounded-xl px-4">
                <RefreshCw className="mr-2 h-4 w-4" />
                Actualizar
              </Button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard label="Pendientes" value={String(columns.pending.length)} tone="pending" icon={Clock3} />
          <StatCard label="Preparando" value={String(columns.preparing.length)} tone="preparing" icon={ChefHat} />
          <StatCard label="Listos" value={String(columns.ready.length)} tone="ready" icon={CheckCircle2} />
          <StatCard
            label={oldestPendingOrder ? "Espera mas antigua" : "Urgencias"}
            value={oldestPendingOrder ? oldestPendingTime : String(urgentOrdersCount)}
            tone={oldestPendingOrder ? "urgent" : "neutral"}
            icon={Flame}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="grid flex-1 min-h-0 gap-3 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-full min-h-[24rem] rounded-[24px]" />
          ))}
        </div>
      ) : (
        <>
          <MobileTabs />
          <KanbanBoard />
        </>
      )}
    </div>
  );
}

export default function KitchenPage() {
  return (
    <KitchenProvider>
      <KitchenContent />
    </KitchenProvider>
  );
}
