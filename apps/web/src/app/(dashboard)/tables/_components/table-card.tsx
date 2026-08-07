"use client";

import { useState } from "react";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@restai/ui/components/select";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@restai/ui/components/popover";
import {
  QrCode,
  Trash2,
  History,
  UserPlus,
  Circle,
  BellRing,
  Receipt,
  MoreHorizontal,
  MoveRight,
  Merge,
  UserCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { statusOptions } from "./constants";
import type { TableRow } from "@/hooks/use-tables";
import { useAuthStore } from "@/stores/auth-store";
import { hasPermission } from "@/lib/permissions";

interface TableServiceRequestIndicator {
  type: "request_bill" | "call_waiter";
  customerName: string;
}

interface TableCardProps {
  table: TableRow;
  waiterAssignmentEnabled: boolean;
  statusChangePending: boolean;
  serviceRequest?: TableServiceRequestIndicator;
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

const STATUS: Record<
  string,
  { label: string; bg: string; text: string; number: string }
> = {
  available: {
    label: "Libre",
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    text: "text-emerald-700 dark:text-emerald-300",
    number: "text-emerald-900 dark:text-emerald-100",
  },
  occupied: {
    label: "Ocupada",
    bg: "bg-blue-50 dark:bg-blue-950/30",
    text: "text-blue-700 dark:text-blue-300",
    number: "text-blue-900 dark:text-blue-100",
  },
  reserved: {
    label: "Reservada",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    text: "text-amber-700 dark:text-amber-300",
    number: "text-amber-900 dark:text-amber-100",
  },
  maintenance: {
    label: "Mant.",
    bg: "bg-red-50 dark:bg-red-950/30",
    text: "text-red-700 dark:text-red-300",
    number: "text-red-900 dark:text-red-100",
  },
};

export function TableCard({
  table,
  waiterAssignmentEnabled,
  statusChangePending,
  serviceRequest,
  onQr,
  onHistory,
  onAssign,
  onDelete,
  onStatusChange,
  onCharge,
  onSeat,
  onMove,
  onMerge,
}: TableCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const role = useAuthStore((state) => state.user?.role);
  // Cada acción se esconde según el permiso que exige su endpoint. El cajero
  // entra a esta pantalla con `tables:read` a secas: enseñarle "Sentar",
  // "Liberar" o "Eliminar" solo servía para que se comiera un 403 por toque.
  const canOperate = hasPermission(role, "tables:update");
  const canDelete = hasPermission(role, "tables:delete");
  const canCharge = hasPermission(role, "payments:create");

  const s = STATUS[table.status] ?? STATUS.available!;
  const hasServiceRequest = !!serviceRequest;
  const isOccupied = table.status === "occupied";
  const canSeat = canOperate && (table.status === "available" || table.status === "reserved");
  const requestAccent =
    serviceRequest?.type === "request_bill"
      ? "ring-2 ring-blue-500/70"
      : "ring-2 ring-orange-500/70";
  const requestLabel =
    serviceRequest?.type === "request_bill" ? "Solicita cuenta" : "Solicita mozo";

  const closeMenuThen = (action: () => void) => () => {
    setMenuOpen(false);
    action();
  };

  return (
    <div
      className={cn(
        "rounded-2xl p-4 flex flex-col gap-3 transition-shadow duration-200 hover:shadow-lg",
        s.bg,
        hasServiceRequest && requestAccent,
      )}
    >
      {/* Cabecera: número + estado */}
      <div className="flex items-start justify-between gap-2">
        {isOccupied && canCharge ? (
          <button
            type="button"
            aria-label={`Cobrar o ver los pedidos de la mesa ${table.number}`}
            onClick={() => onCharge(table)}
            className={cn(
              "text-[2.5rem] font-black leading-none tracking-tight tabular-nums text-left transition-opacity hover:opacity-70",
              s.number,
            )}
          >
            {table.number}
          </button>
        ) : (
          <p
            className={cn(
              "text-[2.5rem] font-black leading-none tracking-tight tabular-nums",
              s.number,
            )}
          >
            {table.number}
          </p>
        )}
        <div className="flex flex-col items-end gap-1">
          <span
            className={cn(
              "text-[11px] font-semibold px-2 py-0.5 rounded-full bg-white/60 dark:bg-white/10",
              s.text,
            )}
          >
            {s.label}
          </span>
          {serviceRequest && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                serviceRequest.type === "request_bill"
                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                  : "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
              )}
            >
              <BellRing className="h-3 w-3" aria-hidden="true" />
              {requestLabel}
            </span>
          )}
        </div>
      </div>

      {/* Aforo + código corto para quien no puede escanear el QR */}
      <p className="text-xs text-muted-foreground -mt-1">
        {table.capacity} {table.capacity === 1 ? "persona" : "personas"}
        {table.short_code && (
          <>
            {" · "}
            <span className="font-semibold tracking-wider text-foreground/70">
              {table.short_code}
            </span>
          </>
        )}
      </p>

      {/* Acción principal: lo que el mozo va a tocar el 90% de las veces */}
      <div className="mt-auto flex items-center gap-2">
        {isOccupied && canCharge ? (
          <button
            type="button"
            onClick={() => onCharge(table)}
            className="h-10 flex-1 rounded-xl bg-blue-600 px-3 text-sm font-bold text-white transition-colors hover:bg-blue-700"
          >
            <span className="inline-flex items-center justify-center gap-1.5">
              <Receipt className="h-4 w-4" aria-hidden="true" />
              Cobrar
            </span>
          </button>
        ) : canSeat ? (
          <button
            type="button"
            onClick={() => onSeat(table)}
            className="h-10 flex-1 rounded-xl bg-emerald-600 px-3 text-sm font-bold text-white transition-colors hover:bg-emerald-700"
          >
            <span className="inline-flex items-center justify-center gap-1.5">
              <UserCheck className="h-4 w-4" aria-hidden="true" />
              Sentar
            </span>
          </button>
        ) : (
          <div className="flex-1" />
        )}

        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Más acciones de la mesa ${table.number}`}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/70 text-muted-foreground transition-colors hover:text-foreground dark:bg-white/10"
            >
              <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-60 p-1.5">
            <MenuItem
              icon={<QrCode className="h-4 w-4" />}
              label="Código QR y cartel"
              onClick={closeMenuThen(() => onQr(table))}
            />
            <MenuItem
              icon={<History className="h-4 w-4" />}
              label="Historial de la mesa"
              onClick={closeMenuThen(() => onHistory(table))}
            />
            {waiterAssignmentEnabled && canOperate && (
              <MenuItem
                icon={<UserPlus className="h-4 w-4" />}
                label="Asignar mozo"
                onClick={closeMenuThen(() => onAssign(table))}
              />
            )}
            {isOccupied && canOperate && (
              <>
                <MenuItem
                  icon={<MoveRight className="h-4 w-4" />}
                  label="Mover la cuenta a otra mesa"
                  onClick={closeMenuThen(() => onMove(table))}
                />
                <MenuItem
                  icon={<Merge className="h-4 w-4" />}
                  label="Juntar otras mesas aquí"
                  onClick={closeMenuThen(() => onMerge(table))}
                />
                <MenuItem
                  icon={<Circle className="h-4 w-4 fill-current text-emerald-600" />}
                  label="Liberar la mesa"
                  onClick={closeMenuThen(() => onStatusChange(table.id, "available"))}
                />
              </>
            )}
            {canDelete && (
              <>
                <div className="my-1 border-t" />
                <MenuItem
                  icon={<Trash2 className="h-4 w-4" />}
                  label="Eliminar mesa"
                  destructive
                  onClick={closeMenuThen(() => onDelete(table))}
                />
              </>
            )}
          </PopoverContent>
        </Popover>
      </div>

      {/* Estado manual (reservada, mantenimiento…) */}
      <Select
        value={table.status}
        disabled={statusChangePending || !canOperate}
        onValueChange={(v) => onStatusChange(table.id, v)}
      >
        <SelectTrigger
          aria-label={`Estado de la mesa ${table.number}`}
          className="h-10 text-xs bg-white/50 dark:bg-white/5 border-0 shadow-none"
        >
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

function MenuItem({
  icon,
  label,
  onClick,
  destructive,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-10 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm transition-colors",
        destructive
          ? "text-destructive hover:bg-destructive/10"
          : "hover:bg-muted",
      )}
    >
      <span className="shrink-0" aria-hidden="true">
        {icon}
      </span>
      {label}
    </button>
  );
}
