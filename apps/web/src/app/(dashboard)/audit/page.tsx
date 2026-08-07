"use client";

import { useState } from "react";
import { Button } from "@restai/ui/components/button";
import { Badge } from "@restai/ui/components/badge";
import { Label } from "@restai/ui/components/label";
import { DatePicker } from "@restai/ui/components/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@restai/ui/components/select";
import { ScrollText, RefreshCw, Download, ChevronLeft, ChevronRight } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { downloadCsv } from "@/lib/csv";
import { limaLastDaysRange } from "@/lib/date";
import { useAuditLogs, useAuditFilters, type AuditLog } from "@/hooks/use-audit";
import { ChangeList } from "./_components/change-list";

/** Verbo canónico -> frase en español. Lo que no esté aquí se muestra tal cual. */
const ACTION_LABELS: Record<string, string> = {
  "payment.create": "Registró un cobro",
  "payment.void": "Anuló un cobro",
  "order.create": "Creó una orden",
  "order.cancel": "Canceló una orden",
  "order.void": "Anuló una venta",
  "order.status_change": "Cambió el estado de una orden",
  "order_item.cancel": "Anuló un plato",
  "cash.open": "Abrió caja",
  "cash.close": "Cerró caja",
  "settings.update": "Cambió la configuración",
  "branch.update": "Modificó una sede",
  "branch.create": "Creó una sede",
  "menu.price_change": "Cambió un precio",
  "menu.availability_change": "Cambió la disponibilidad de un plato",
  "menu.delete": "Eliminó un producto",
  "staff.create": "Dio de alta a un empleado",
  "staff.update": "Modificó a un empleado",
  "staff.password_change": "Cambió una contraseña",
  "staff.deactivate": "Desactivó a un empleado",
  "staff.shift_force_close": "Cerró un turno ajeno",
  "table.delete": "Eliminó una mesa",
  "table.free": "Liberó una mesa",
  "space.delete": "Eliminó un espacio",
  "session.force_end": "Terminó una sesión de mesa",
  "inventory.adjust": "Ajustó inventario",
  "loyalty.points_adjust": "Ajustó puntos",
  "loyalty.reward_redeem": "Canjeó una recompensa",
  "customer.merge": "Fusionó clientes",
  "customer.anonymize": "Anonimizó un cliente",
  "invoice.emit": "Emitió un comprobante",
  "invoice.void": "Anuló un comprobante",
  "sunat.config_update": "Cambió la configuración de SUNAT",
};

/** Acciones que un dueño querría ver destacadas al abrir la pantalla. */
const SENSITIVE = new Set([
  "payment.void",
  "order.void",
  "order.cancel",
  "settings.update",
  "staff.password_change",
  "table.free",
  "menu.price_change",
  "customer.anonymize",
  "invoice.void",
  "sunat.config_update",
]);

const SENTINEL_ALL = "all";

export default function AuditPage() {
  const defaults = limaLastDaysRange(30);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState<string>(SENTINEL_ALL);
  const [entityType, setEntityType] = useState<string>(SENTINEL_ALL);
  const [userId, setUserId] = useState<string>(SENTINEL_ALL);
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);
  const [expanded, setExpanded] = useState<string | null>(null);

  const query = {
    page,
    limit: 50,
    action: action === SENTINEL_ALL ? undefined : action,
    entityType: entityType === SENTINEL_ALL ? undefined : entityType,
    userId: userId === SENTINEL_ALL ? undefined : userId,
    startDate,
    endDate,
  };

  const { data, isLoading, isFetching, refetch, error } = useAuditLogs(query);
  const { data: filters } = useAuditFilters();

  const logs = data?.data ?? [];
  const pagination = data?.pagination;

  const resetToFirstPage = <T,>(setter: (v: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
  };

  const exportLogs = () => {
    downloadCsv(
      `auditoria_${startDate}_${endDate}`,
      [
        { header: "Fecha", value: (l: AuditLog) => formatDate(l.created_at) },
        { header: "Usuario", value: (l: AuditLog) => l.user_email ?? "—" },
        { header: "Rol", value: (l: AuditLog) => l.user_role ?? "—" },
        { header: "Acción", value: (l: AuditLog) => ACTION_LABELS[l.action] ?? l.action },
        { header: "Verbo", value: (l: AuditLog) => l.action },
        { header: "Entidad", value: (l: AuditLog) => l.entity_type },
        { header: "Detalle", value: (l: AuditLog) => l.summary ?? "" },
        { header: "Sede", value: (l: AuditLog) => l.branch_name ?? "" },
        { header: "IP", value: (l: AuditLog) => l.ip ?? "" },
      ],
      logs,
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Auditoría</h1>
          <p className="text-muted-foreground">
            Quién hizo qué, y cuándo. Cada acción sensible queda registrada.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={!logs.length} onClick={exportLogs}>
            <Download className="mr-2 h-4 w-4" />
            Exportar CSV
          </Button>
          <Button variant="outline" size="sm" disabled={isFetching} onClick={() => refetch()}>
            <RefreshCw className={cn("mr-2 h-4 w-4", isFetching && "animate-spin")} />
            Actualizar
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <div className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2 xl:grid-cols-5">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Desde</Label>
          <DatePicker value={startDate} onChange={(d) => resetToFirstPage(setStartDate)(d ?? "")} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Hasta</Label>
          <DatePicker value={endDate} onChange={(d) => resetToFirstPage(setEndDate)(d ?? "")} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Acción</Label>
          <Select value={action} onValueChange={resetToFirstPage(setAction)}>
            <SelectTrigger>
              <SelectValue placeholder="Todas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SENTINEL_ALL}>Todas</SelectItem>
              {(filters?.actions ?? []).map((a) => (
                <SelectItem key={a} value={a}>
                  {ACTION_LABELS[a] ?? a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Tipo</Label>
          <Select value={entityType} onValueChange={resetToFirstPage(setEntityType)}>
            <SelectTrigger>
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SENTINEL_ALL}>Todos</SelectItem>
              {(filters?.entityTypes ?? []).map((e) => (
                <SelectItem key={e} value={e}>
                  {e}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Usuario</Label>
          <Select value={userId} onValueChange={resetToFirstPage(setUserId)}>
            <SelectTrigger>
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SENTINEL_ALL}>Todos</SelectItem>
              {(filters?.users ?? []).map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name ?? u.email ?? u.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
          No se pudo cargar la auditoría: {(error as Error).message}
        </div>
      )}

      {/* Listado */}
      <div className="rounded-xl border">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <ScrollText className="h-10 w-10 text-muted-foreground/40" />
            <p className="font-medium">Sin movimientos registrados</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              No hay acciones auditadas en este rango. Prueba a ampliar las fechas.
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {logs.map((log) => {
              const isOpen = expanded === log.id;
              const hasDetail = Boolean(log.before || log.after);
              return (
                <div key={log.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">
                          {ACTION_LABELS[log.action] ?? log.action}
                        </span>
                        {SENSITIVE.has(log.action) && (
                          <Badge variant="destructive" className="text-[10px]">
                            Sensible
                          </Badge>
                        )}
                        <Badge variant="secondary" className="text-[10px]">
                          {log.entity_type}
                        </Badge>
                      </div>
                      {log.summary && (
                        <p className="mt-1 text-sm text-muted-foreground">{log.summary}</p>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {log.user_name ?? log.user_email ?? "Usuario eliminado"}
                        {log.user_role ? ` · ${log.user_role}` : ""}
                        {log.branch_name ? ` · ${log.branch_name}` : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDate(log.created_at)}
                      </p>
                      {hasDetail && (
                        <button
                          type="button"
                          onClick={() => setExpanded(isOpen ? null : log.id)}
                          className="mt-1 text-xs font-medium text-primary hover:underline"
                        >
                          {isOpen ? "Ocultar detalle" : "Ver detalle"}
                        </button>
                      )}
                    </div>
                  </div>

                  {isOpen && hasDetail && (
                    <ChangeList before={log.before ?? null} after={log.after ?? null} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {pagination.total} movimientos · página {pagination.page} de {pagination.totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pagination.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Siguiente
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
