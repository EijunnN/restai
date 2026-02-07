"use client";

import { cn } from "@/lib/utils";
import { TableCard } from "./table-card";

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-muted rounded", className)} />;
}

interface GridViewProps {
  tables: any[];
  isLoading: boolean;
  waiterAssignmentEnabled: boolean;
  statusChangePending: boolean;
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
  onQr,
  onHistory,
  onAssign,
  onDelete,
  onStatusChange,
}: GridViewProps) {
  return (
    <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 mt-4">
      {isLoading
        ? Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="rounded-xl h-36" />
          ))
        : tables.map((table: any) => (
            <TableCard
              key={table.id}
              table={table}
              waiterAssignmentEnabled={waiterAssignmentEnabled}
              statusChangePending={statusChangePending}
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
