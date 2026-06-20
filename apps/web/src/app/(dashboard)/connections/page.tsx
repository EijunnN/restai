"use client";

import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@restai/ui/components/card";
import { Button } from "@restai/ui/components/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@restai/ui/components/tabs";
import { Wifi, Check, X, Clock, UserCheck, UserX, RefreshCw, Loader2, Bell, Receipt } from "lucide-react";
import { useWebSocket } from "@/hooks/use-websocket";
import { cn } from "@/lib/utils";
import { useSessions, useApproveSession, useRejectSession, useEndSession, useMyAssignedTables } from "@/hooks/use-tables";
import { useBranchSettings } from "@/hooks/use-settings";
import { useAuthStore } from "@/stores/auth-store";
import type { WsMessage } from "@restai/types";

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

interface TableSession {
  id: string;
  customer_name: string;
  customer_phone: string | null;
  started_at: string | null;
  table_id: string;
  table_number: number;
  status: string;
}

interface TableServiceRequest {
  id: string;
  type: "request_bill" | "call_waiter";
  tableId: string;
  tableNumber: number;
  tableSessionId: string;
  customerName: string;
  timestamp: number;
}

interface SessionEventPayload {
  sessionId: string;
  tableId: string;
}

interface ServiceRequestPayload {
  tableId: string;
  tableNumber: number;
  tableSessionId: string;
  customerName?: string;
}

export default function ConnectionsPage() {
  const [tab, setTab] = useState("pending");
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [serviceRequests, setServiceRequests] = useState<TableServiceRequest[]>([]);
  const queryClient = useQueryClient();
  const { data: sessions, isLoading, refetch } = useSessions(tab === "all" ? undefined : tab);
  const approveSession = useApproveSession();
  const rejectSession = useRejectSession();
  const endSession = useEndSession();

  // Waiter assignment filtering
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const selectedBranchId = useAuthStore((s) => s.selectedBranchId);
  const { data: branchSettingsData } = useBranchSettings();
  const { data: myAssignedTables } = useMyAssignedTables();
  const waiterAssignmentEnabled = (branchSettingsData as any)?.settings?.waiter_table_assignment_enabled ?? false;
  const isAdminOrManager = user?.role === "super_admin" || user?.role === "org_admin" || user?.role === "branch_manager";
  const shouldFilter = waiterAssignmentEnabled && !isAdminOrManager;
  const assignedTableIds = useMemo(
    () => new Set((myAssignedTables ?? []).map((assignment: { table_id: string }) => assignment.table_id)),
    [myAssignedTables]
  );

  const sessionList = useMemo(() => {
    const all = (sessions ?? []) as TableSession[];
    // If assignment filtering is disabled or user is admin/manager, show all
    if (!waiterAssignmentEnabled || isAdminOrManager) return all;
    // Filter to only sessions whose table is assigned to this waiter
    if (assignedTableIds.size === 0) return all; // No assignments = show all (fallback)
    return all.filter((session) => assignedTableIds.has(session.table_id));
  }, [sessions, waiterAssignmentEnabled, isAdminOrManager, assignedTableIds]);

  const visibleServiceRequests = useMemo(() => {
    if (!shouldFilter) {
      return serviceRequests;
    }

    if (assignedTableIds.size === 0) {
      return serviceRequests;
    }

    return serviceRequests.filter((request) => assignedTableIds.has(request.tableId));
  }, [serviceRequests, shouldFilter, assignedTableIds]);

  const requestSummary = useMemo(() => {
    return visibleServiceRequests.reduce(
      (summary, request) => {
        if (request.type === "request_bill") {
          summary.requestBillCount += 1;
        } else {
          summary.callWaiterCount += 1;
        }

        summary.total += 1;
        return summary;
      },
      { total: 0, requestBillCount: 0, callWaiterCount: 0 }
    );
  }, [visibleServiceRequests]);

  const handleWsMessage = useCallback((msg: WsMessage) => {
    if (msg.type === "auth:success") {
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      return;
    }

    if (
      msg.type === "session:pending" ||
      msg.type === "session:approved" ||
      msg.type === "session:rejected" ||
      msg.type === "session:ended"
    ) {
      const payload = msg.payload as SessionEventPayload;

      if (shouldFilter && assignedTableIds.size > 0 && !assignedTableIds.has(payload.tableId)) {
        return;
      }

      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      void queryClient.invalidateQueries({ queryKey: ["tables", "sessions", "pending"] });

      if (msg.type === "session:ended") {
        setServiceRequests((prev) => prev.filter((request) => request.tableSessionId !== payload.sessionId));
      }
      return;
    }

    if (msg.type !== "table:request_bill" && msg.type !== "table:call_waiter") {
      return;
    }

    const payload = msg.payload as ServiceRequestPayload;

    if (shouldFilter && assignedTableIds.size > 0 && !assignedTableIds.has(payload.tableId)) {
      return;
    }

    const requestType: TableServiceRequest["type"] =
      msg.type === "table:request_bill" ? "request_bill" : "call_waiter";
    const requestId = `${payload.tableSessionId}:${requestType}`;

    setServiceRequests((prev) => {
      const nextRequest: TableServiceRequest = {
        id: requestId,
        type: requestType,
        tableId: payload.tableId,
        tableNumber: payload.tableNumber,
        tableSessionId: payload.tableSessionId,
        customerName: payload.customerName || "Cliente",
        timestamp: msg.timestamp,
      };
      const filtered = prev.filter((request) => request.id !== requestId);

      return [nextRequest, ...filtered].slice(0, 25);
    });
  }, [assignedTableIds, queryClient, shouldFilter]);

  useWebSocket(
    selectedBranchId ? [`branch:${selectedBranchId}`] : [],
    handleWsMessage,
    accessToken || undefined,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Conexiones</h1>
          <p className="text-muted-foreground">Gestiona las sesiones de clientes</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Actualizar
        </Button>
      </div>

      {visibleServiceRequests.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium">Solicitudes en tiempo real</p>
                <p className="text-sm text-muted-foreground">
                  {requestSummary.requestBillCount} cuenta, {requestSummary.callWaiterCount} mozo
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setServiceRequests([])}>
                Limpiar
              </Button>
            </div>

            <div className="space-y-2">
              {visibleServiceRequests.map((request) => (
                <div
                  key={request.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-3"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    {request.type === "request_bill" ? (
                      <Receipt className="h-4 w-4 mt-0.5 shrink-0 text-blue-500" />
                    ) : (
                      <Bell className="h-4 w-4 mt-0.5 shrink-0 text-orange-500" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        Mesa {request.tableNumber}: {request.customerName}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {request.type === "request_bill" ? "Solicita la cuenta" : "Solicita mozo"}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setServiceRequests((prev) => prev.filter((item) => item.id !== request.id));
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

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
          ) : sessionList.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Wifi className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No hay sesiones {tab === "pending" ? "pendientes" : tab === "active" ? "activas" : ""}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {sessionList.map((session: any) => {
                const config = statusConfig[session.status] || statusConfig.pending;
                const Icon = config.icon;
                return (
                  <Card key={session.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className={cn("flex items-center justify-center h-10 w-10 rounded-full border", config.color)}>
                            <Icon className="h-5 w-5" />
                          </div>
                          <div>
                            <p className="font-medium">{session.customer_name}</p>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <span>Mesa {session.table_number}</span>
                              {session.customer_phone && <span>· {session.customer_phone}</span>}
                              <span>· {session.started_at ? formatDate(session.started_at) : ""}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={cn("text-xs px-2.5 py-1 rounded-full font-medium border", config.color)}>
                            {config.label}
                          </span>
                          {session.status === "pending" && (
                            <div className="flex gap-1 ml-2">
                              <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" disabled={mutatingId === session.id} onClick={() => {
                                setMutatingId(session.id);
                                rejectSession.mutate(session.id, { onSettled: () => setMutatingId(null) });
                              }}>
                                {mutatingId === session.id && rejectSession.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                              </Button>
                              <Button size="sm" disabled={mutatingId === session.id} onClick={() => {
                                setMutatingId(session.id);
                                approveSession.mutate(session.id, { onSettled: () => setMutatingId(null) });
                              }}>
                                {mutatingId === session.id && approveSession.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
                                Aceptar
                              </Button>
                            </div>
                          )}
                          {session.status === "active" && (
                            <Button size="sm" variant="outline" className="ml-2" disabled={mutatingId === session.id} onClick={() => {
                              setMutatingId(session.id);
                              endSession.mutate(session.id, { onSettled: () => setMutatingId(null) });
                            }}>
                              {mutatingId === session.id && endSession.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <X className="h-4 w-4 mr-1" />}
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
    </div>
  );
}
