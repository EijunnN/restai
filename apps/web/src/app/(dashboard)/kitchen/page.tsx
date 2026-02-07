"use client";

import { Badge } from "@restai/ui/components/badge";
import { Button } from "@restai/ui/components/button";
import { RefreshCw, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { KitchenProvider, useKitchenContext } from "./_components/kitchen-context";
import { KanbanBoard } from "./_components/kanban-board";
import { MobileTabs } from "./_components/mobile-tabs";

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-muted rounded", className)} />;
}

function KitchenContent() {
  const { orders, isLoading, error, refetch } = useKitchenContext();

  if (error) {
    return (
      <div className="space-y-4 h-full">
        <h1 className="text-2xl font-bold">Cocina (KDS)</h1>
        <div className="p-4 rounded-lg border border-destructive/50 bg-destructive/5 flex items-center justify-between">
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
    <div className="flex flex-col h-[calc(100vh-4rem)] gap-3">
      {/* flash animation keyframes */}
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

      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">Cocina</h1>
          <Badge variant="secondary" className="font-mono text-xs">
            KDS
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-sm tabular-nums">
            {isLoading ? "..." : `${orders.length} ordenes`}
          </Badge>
          <Button variant="ghost" size="sm" onClick={() => refetch()} className="h-8 w-8 p-0">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 flex-1 min-h-0">
          {Array.from({ length: 3 }).map((_, colIdx) => (
            <div key={colIdx} className="space-y-3">
              <Skeleton className="h-12 w-full rounded-lg" />
              {Array.from({ length: 2 }).map((_, cardIdx) => (
                <Skeleton key={cardIdx} className="h-40 w-full rounded-lg" />
              ))}
            </div>
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
