"use client";

import { Button } from "@restai/ui/components/button";
import { Card, CardContent } from "@restai/ui/components/card";
import { Badge } from "@restai/ui/components/badge";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@restai/ui/components/select";
import {
  QrCode,
  Users,
  Trash2,
  History,
  UserPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { statusConfig, statusOptions } from "./constants";

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
  const config = statusConfig[table.status] || statusConfig.available;

  return (
    <Card
      className={cn(
        "border-2 transition-all hover:shadow-md",
        config.bgColor,
        config.darkBgColor
      )}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-2xl font-bold">{table.number}</span>
          <Badge variant="outline" className={config.color}>
            {config.label}
          </Badge>
        </div>
        <div className="space-y-1 mb-3">
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Users className="h-3 w-3" />
            {table.capacity} personas
          </p>
        </div>
        <div className="flex gap-1 flex-wrap">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => onQr(table)}
            title="Ver QR"
          >
            <QrCode className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => onHistory(table)}
            title="Historial"
          >
            <History className="h-4 w-4" />
          </Button>
          {waiterAssignmentEnabled && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => onAssign(table)}
              title="Asignar mozos"
            >
              <UserPlus className="h-4 w-4" />
            </Button>
          )}
          {table.status === "available" && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={statusChangePending}
              onClick={() => onStatusChange(table.id, "occupied")}
            >
              Ocupar
            </Button>
          )}
          {table.status === "occupied" && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={statusChangePending}
              onClick={() => onStatusChange(table.id, "available")}
            >
              Liberar
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 ml-auto text-destructive hover:text-destructive"
            onClick={() => onDelete(table)}
            title="Eliminar"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
        {/* Status selector */}
        <Select value={table.status} onValueChange={(v) => onStatusChange(table.id, v)}>
          <SelectTrigger className="mt-2 h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {statusOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  );
}
