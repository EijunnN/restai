"use client";

import { cn } from "@/lib/utils";
import { TableCard } from "./table-card";
import type { TableRow } from "@/hooks/use-tables";

interface TableServiceRequestIndicator {
  type: "request_bill" | "call_waiter";
  customerName: string;
}

function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("animate-pulse rounded-2xl bg-muted/50 p-4 flex flex-col gap-3", className)}>
      <div className="flex items-center justify-between">
        <div className="h-10 w-12 bg-muted rounded" />
        <div className="h-5 w-14 bg-muted rounded-full" />
      </div>
      <div className="h-3 w-20 bg-muted rounded" />
      <div className="flex gap-2 mt-auto">
        <div className="h-10 flex-1 bg-muted rounded-xl" />
        <div className="h-10 w-10 bg-muted rounded-xl" />
      </div>
      <div className="h-10 w-full bg-muted rounded-lg" />
    </div>
  );
}

interface GridViewProps {
  tables: TableRow[];
  isLoading: boolean;
  waiterAssignmentEnabled: boolean;
  statusChangePending: boolean;
  requestByTableId: Record<string, TableServiceRequestIndicator>;
  /** Texto del estado vacío: cambia según el filtro activo. */
  emptyMessage: string;
  onQr: (table: TableRow) => void;
  onHistory: (table: TableRow) => void;
  onAssign: (table: TableRow) => void;
  onDelete: (table: TableRow) => void;
  onStatusChange: (tableId: string, status: string) => void;
  onCharge: (table: TableRow) => void;
  onSeat: (table: TableRow) => void;
  onMove: (table: TableRow) => void;
  onMerge: (table: TableRow) => void;
}

export function GridView({
  tables,
  isLoading,
  waiterAssignmentEnabled,
  statusChangePending,
  requestByTableId,
  emptyMessage,
  onQr,
  onHistory,
  onAssign,
  onDelete,
  onStatusChange,
  onCharge,
  onSeat,
  onMove,
  onMerge,
}: GridViewProps) {
  if (!isLoading && tables.length === 0) {
    return (
      <div className="mt-4 rounded-2xl border border-dashed p-10 text-center">
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 mt-4">
      {isLoading
        ? Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} />)
        : tables.map((table) => (
            <TableCard
              key={table.id}
              table={table}
              waiterAssignmentEnabled={waiterAssignmentEnabled}
              statusChangePending={statusChangePending}
              serviceRequest={requestByTableId[table.id]}
              onQr={onQr}
              onHistory={onHistory}
              onAssign={onAssign}
              onDelete={onDelete}
              onStatusChange={onStatusChange}
              onCharge={onCharge}
              onSeat={onSeat}
              onMove={onMove}
              onMerge={onMerge}
            />
          ))}
    </div>
  );
}
