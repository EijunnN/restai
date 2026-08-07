"use client";

import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@restai/ui/components/card";
import { Button } from "@restai/ui/components/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@restai/ui/components/tabs";
import { Wifi, Check, X, Clock, UserCheck, UserX, RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useWebSocket } from "@/hooks/use-websocket";
import { cn } from "@/lib/utils";
import {
  useSessions,
  useApproveSession,
  useRejectSession,
  useMyAssignedTables,
} from "@/hooks/use-tables";
import { useBranchSettings } from "@/hooks/use-settings";
import { useAuthStore } from "@/stores/auth-store";
import { hasPermission } from "@/lib/permissions";
import type { WsMessage } from "@restai/types";
import { ServiceRequestTray } from "./_components/service-request-tray";
import { EndSessionDialog, type EndSessionTarget } from "./_components/end-session-dialog";

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("es-PE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

const statusConfig: Record<string, { label: string; color: string; icon: any }> = {
  pending: { label: "Pendiente", color: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20", icon: Clock },
  active: { label: "Activa", color: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/20", icon: UserCheck },
  completed: { label: "Completada", color: "bg-muted text-muted-foreground border-border", icon: Check },
  rejected: { label: "Rechazada", color: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20", icon: UserX },
};

const emptyMessages: Record<string, string> = {
  pending: "No hay solicitudes de ingreso esperando aprobación.",
  active: "Ninguna mesa tiene una visita abierta ahora mismo.",
  completed: "Todavía no hay visitas cerradas para mostrar.",
  all: "Aún no hay sesiones de clientes en esta sede.",
};

interface TableSession {
  id: string;
  customer_name: string;
  customer_phone: string | null;
  started_at: string | null;
  table_id: string;
  table_number: number;
  status: string;
}

interface SessionEventPayload {
  sessionId: string;
  tableId: string;
}

export default function ConnectionsPage() {
  const [tab, setTab] = useState("pending");
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [endTarget, setEndTarget] = useState<EndSessionTarget | null>(null);
  const queryClient = useQueryClient();
  const { data: sessions, isLoading, isError, error, refetch } = useSessions(
    tab === "all" ? undefined : tab,
  );
  const approveSession = useApproveSession();
  const rejectSession = useRejectSession();

  // Filtro por asignación de mozos
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const selectedBranchId = useAuthStore((s) => s.selectedBranchId);
  const { data: branchSettingsData } = useBranchSettings();
  const waiterAssignmentEnabled = (branchSettingsData as any)?.settings?.waiter_table_assignment_enabled ?? false;
  const { data: myAssignedTables } = useMyAssignedTables({ enabled: waiterAssignmentEnabled });
  // Aceptar, rechazar y terminar una visita exigen `tables:update`. El cajero
  // llega a esta pantalla con `tables:read` a secas: los botones le devolvían
  // "Sin permisos" en la cara.
  const canOperate = hasPermission(user?.role, "tables:update");
  const isAdminOrManager = user?.role === "super_admin" || user?.role === "org_admin" || user?.role === "branch_manager";
  const shouldFilter = waiterAssignmentEnabled && !isAdminOrManager;
  const assignedTableIds = useMemo(
    () => new Set((myAssignedTables ?? []).map((assignment: { table_id: string }) => assignment.table_id)),
    [myAssignedTables]
  );

  /**
   * Mesas visibles para este usuario, o `null` si ve toda la sala.
   *
   * Si la sede filtra por asignación pero a este mozo no le han asignado
   * ninguna mesa, se le enseña todo: es preferible que vea de más a que se
   * quede mirando una pantalla vacía mientras el comedor llama.
   */
  const allowedTableIds = useMemo(
    () => (shouldFilter && assignedTableIds.size > 0 ? assignedTableIds : null),
    [shouldFilter, assignedTableIds]
  );

  const sessionList = useMemo(() => {
    const all = (sessions ?? []) as TableSession[];
    if (!allowedTableIds) return all;
    return all.filter((session) => allowedTableIds.has(session.table_id));
  }, [sessions, allowedTableIds]);

  const handleWsMessage = useCallback((msg: WsMessage) => {
    // WsMessageType todavía no declara los eventos nuevos de sala y avisos.
    const type = msg.type as string;

    if (type === "auth:success") {
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      void queryClient.invalidateQueries({ queryKey: ["service-requests"] });
      return;
    }

    if (
      type === "table:request_bill" ||
      type === "table:call_waiter" ||
      type === "service_request:acknowledged" ||
      type === "service_request:resolved"
    ) {
      void queryClient.invalidateQueries({ queryKey: ["service-requests"] });
      return;
    }

    if (
      type === "session:pending" ||
      type === "session:approved" ||
      type === "session:rejected" ||
      type === "session:ended" ||
      type === "session:started" ||
      type === "session:moved" ||
      type === "session:merged"
    ) {
      const payload = msg.payload as Partial<SessionEventPayload>;

      if (
        allowedTableIds &&
        payload.tableId &&
        !allowedTableIds.has(payload.tableId)
      ) {
        return;
      }

      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      void queryClient.invalidateQueries({ queryKey: ["tables", "sessions", "pending"] });
      void queryClient.invalidateQueries({ queryKey: ["service-requests"] });
    }
  }, [allowedTableIds, queryClient]);

  useWebSocket(
    selectedBranchId ? [`branch:${selectedBranchId}`] : [],
    handleWsMessage,
    accessToken || undefined,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Conexiones</h1>
          <p className="text-muted-foreground">
            Avisos de mesa y sesiones de clientes
          </p>
        </div>
        <Button variant="outline" className="h-10" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" />
          Actualizar
        </Button>
      </div>

      {/* Bandeja de avisos: lo primero que mira el mozo */}
      <ServiceRequestTray allowedTableIds={allowedTableIds} />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="pending">Pendientes</TabsTrigger>
          <TabsTrigger value="active">Activas</TabsTrigger>
          <TabsTrigger value="completed">Historial</TabsTrigger>
          <TabsTrigger value="all">Todas</TabsTrigger>
        </TabsList>

        <TabsContent value={tab}>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="animate-pulse bg-muted rounded-lg h-20" />
              ))}
            </div>
          ) : isError ? (
            <div
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/50 bg-destructive/5 p-4"
              role="alert"
            >
              <p className="text-sm text-destructive">
                No se pudieron cargar las sesiones
                {error instanceof Error ? `: ${error.message}` : "."}
              </p>
              <Button variant="outline" className="h-10" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" />
                Reintentar
              </Button>
            </div>
          ) : sessionList.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Wifi className="h-12 w-12 text-muted-foreground mb-4" aria-hidden="true" />
                <p className="text-muted-foreground">
                  {emptyMessages[tab] ?? emptyMessages.all}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {sessionList.map((session) => {
                const config = statusConfig[session.status] ?? statusConfig.pending!;
                const Icon = config.icon;
                const busy = mutatingId === session.id;
                return (
                  <Card key={session.id}>
                    <CardContent className="p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-4">
                          <div className={cn("flex items-center justify-center h-10 w-10 rounded-full border", config.color)}>
                            <Icon className="h-5 w-5" aria-hidden="true" />
                          </div>
                          <div>
                            <p className="font-medium">{session.customer_name}</p>
                            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                              <span>Mesa {session.table_number}</span>
                              {session.customer_phone && <span>· {session.customer_phone}</span>}
                              {session.started_at && <span>· {formatDate(session.started_at)}</span>}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn("text-xs px-2.5 py-1 rounded-full font-medium border", config.color)}>
                            {config.label}
                          </span>
                          {session.status === "pending" && canOperate && (
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                className="h-10 text-destructive hover:text-destructive"
                                aria-label={`Rechazar a ${session.customer_name} en la mesa ${session.table_number}`}
                                disabled={busy}
                                onClick={() => {
                                  setMutatingId(session.id);
                                  rejectSession.mutate(session.id, {
                                    onSuccess: () => toast.success("Solicitud rechazada"),
                                    onError: (err) =>
                                      toast.error(
                                        err instanceof Error
                                          ? err.message
                                          : "No se pudo rechazar la solicitud",
                                      ),
                                    onSettled: () => setMutatingId(null),
                                  });
                                }}
                              >
                                {busy && rejectSession.isPending ? (
                                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                                ) : (
                                  <X className="h-4 w-4" aria-hidden="true" />
                                )}
                              </Button>
                              <Button
                                className="h-10"
                                disabled={busy}
                                onClick={() => {
                                  setMutatingId(session.id);
                                  approveSession.mutate(session.id, {
                                    onSuccess: () =>
                                      toast.success(
                                        `${session.customer_name} ya puede pedir en la mesa ${session.table_number}`,
                                      ),
                                    onError: (err) =>
                                      toast.error(
                                        err instanceof Error
                                          ? err.message
                                          : "No se pudo aceptar la solicitud",
                                      ),
                                    onSettled: () => setMutatingId(null),
                                  });
                                }}
                              >
                                {busy && approveSession.isPending ? (
                                  <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden="true" />
                                ) : (
                                  <Check className="h-4 w-4 mr-1" aria-hidden="true" />
                                )}
                                Aceptar
                              </Button>
                            </div>
                          )}
                          {session.status === "active" && canOperate && (
                            <Button
                              variant="outline"
                              className="h-10"
                              onClick={() =>
                                setEndTarget({
                                  id: session.id,
                                  customerName: session.customer_name,
                                  tableNumber: session.table_number,
                                })
                              }
                            >
                              <X className="h-4 w-4 mr-1" aria-hidden="true" />
                              Terminar
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <EndSessionDialog session={endTarget} onClose={() => setEndTarget(null)} />
    </div>
  );
}
