"use client";

import { cn } from "@/lib/utils";
import { TableCard } from "./table-card";

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
      <div className="flex gap-1 mt-auto">
        <div className="h-7 w-7 bg-muted rounded-lg" />
        <div className="h-7 w-7 bg-muted rounded-lg" />
        <div className="h-7 w-7 bg-muted rounded-lg" />
      </div>
      <div className="h-7 w-full bg-muted rounded-lg" />
    </div>
  );
}

interface GridViewProps {
  tables: any[];
  isLoading: boolean;
  waiterAssignmentEnabled: boolean;
  statusChangePending: boolean;
  requestByTableId: Record<string, TableServiceRequestIndicator>;
  onQr: (table: any) => void;
  onHistory: (table: any) => void;
  onAssign: (table: any) => void;
  onDelete: (table: any) => void;
  onStatusChange: (tableId: string, status: string) => void;
}

export function GridView({
  tables,
  isLoading,
  waiterAssignmentEnabled,
  statusChangePending,
  requestByTableId,
  onQr,
  onHistory,
  onAssign,
  onDelete,
  onStatusChange,
}: GridViewProps) {
  return (
    <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 mt-4">
      {isLoading
        ? Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} />
          ))
        : tables.map((table: any) => (
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
            />
          ))}
    </div>
  );
}
