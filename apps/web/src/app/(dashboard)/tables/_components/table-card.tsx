"use client";

import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@restai/ui/components/select";
import {
  QrCode,
  Trash2,
  History,
  UserPlus,
  Circle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { statusOptions } from "./constants";

interface TableCardProps {
  table: any;
  waiterAssignmentEnabled: boolean;
  statusChangePending: boolean;
  onQr: (table: any) => void;
  onHistory: (table: any) => void;
  onAssign: (table: any) => void;
  onDelete: (table: any) => void;
  onStatusChange: (tableId: string, status: string) => void;
}

const STATUS: Record<
  string,
  {
    label: string;
    bg: string;
    text: string;
    number: string;
    actionLabel?: string;
    actionTarget?: string;
    actionBg: string;
  }
> = {
  available: {
    label: "Libre",
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    text: "text-emerald-700 dark:text-emerald-300",
    number: "text-emerald-900 dark:text-emerald-100",
    actionLabel: "Ocupar",
    actionTarget: "occupied",
    actionBg: "bg-blue-600 hover:bg-blue-700 text-white",
  },
  occupied: {
    label: "Ocupada",
    bg: "bg-blue-50 dark:bg-blue-950/30",
    text: "text-blue-700 dark:text-blue-300",
    number: "text-blue-900 dark:text-blue-100",
    actionLabel: "Liberar",
    actionTarget: "available",
    actionBg: "bg-emerald-600 hover:bg-emerald-700 text-white",
  },
  reserved: {
    label: "Reservada",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    text: "text-amber-700 dark:text-amber-300",
    number: "text-amber-900 dark:text-amber-100",
    actionBg: "",
  },
  maintenance: {
    label: "Mant.",
    bg: "bg-red-50 dark:bg-red-950/30",
    text: "text-red-700 dark:text-red-300",
    number: "text-red-900 dark:text-red-100",
    actionBg: "",
  },
};

export function TableCard({
  table,
  waiterAssignmentEnabled,
  statusChangePending,
  onQr,
  onHistory,
  onAssign,
  onDelete,
  onStatusChange,
}: TableCardProps) {
  const s = STATUS[table.status] || STATUS.available;

  return (
    <div className={cn("rounded-2xl p-4 flex flex-col gap-3 transition-shadow duration-200 hover:shadow-lg", s.bg)}>
      {/* Header: number + status */}
      <div className="flex items-center justify-between">
        <p className={cn("text-[2.5rem] font-black leading-none tracking-tight tabular-nums", s.number)}>
          {table.number}
        </p>
        <span className={cn("text-[11px] font-semibold px-2 py-0.5 rounded-full bg-white/60 dark:bg-white/10", s.text)}>
          {s.label}
        </span>
      </div>

      {/* Capacity */}
      <p className="text-xs text-muted-foreground -mt-1">
        {table.capacity} {table.capacity === 1 ? "persona" : "personas"}
      </p>

      {/* Actions row */}
      <div className="flex items-center gap-1 mt-auto">
        <IconBtn icon={<QrCode className="h-3.5 w-3.5" />} title="QR" onClick={() => onQr(table)} />
        <IconBtn icon={<History className="h-3.5 w-3.5" />} title="Historial" onClick={() => onHistory(table)} />
        {waiterAssignmentEnabled && (
          <IconBtn icon={<UserPlus className="h-3.5 w-3.5" />} title="Asignar" onClick={() => onAssign(table)} />
        )}

        <div className="flex-1" />

        {s.actionLabel && s.actionTarget && (
          <button
            type="button"
            disabled={statusChangePending}
            onClick={() => onStatusChange(table.id, s.actionTarget!)}
            className={cn(
              "text-[10px] font-bold px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50",
              s.actionBg
            )}
          >
            {s.actionLabel}
          </button>
        )}

        <IconBtn
          icon={<Trash2 className="h-3.5 w-3.5" />}
          title="Eliminar"
          onClick={() => onDelete(table)}
          destructive
        />
      </div>

      {/* Status selector */}
      <Select value={table.status} onValueChange={(v) => onStatusChange(table.id, v)}>
        <SelectTrigger className="h-7 text-xs bg-white/50 dark:bg-white/5 border-0 shadow-none">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {statusOptions.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              <span className="flex items-center gap-2">
                <Circle className={cn("h-2 w-2 fill-current", STATUS[opt.value]?.text)} />
                {opt.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function IconBtn({
  icon,
  title,
  onClick,
  destructive,
}: {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "p-1.5 rounded-lg transition-colors",
        destructive
          ? "text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10"
          : "text-muted-foreground/80 hover:text-foreground hover:bg-white/60 dark:hover:bg-white/10"
      )}
    >
      {icon}
    </button>
  );
}
