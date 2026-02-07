"use client";

import { useState, useMemo } from "react";
import { Card, CardContent } from "@restai/ui/components/card";
import { Button } from "@restai/ui/components/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@restai/ui/components/tabs";
import { Wifi, Check, X, Clock, UserCheck, UserX, RefreshCw, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSessions, useApproveSession, useRejectSession, useEndSession, useMyAssignedTables } from "@/hooks/use-tables";
import { useBranchSettings } from "@/hooks/use-settings";
import { useAuthStore } from "@/stores/auth-store";

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

export default function ConnectionsPage() {
  const [tab, setTab] = useState("pending");
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const { data: sessions, isLoading, refetch } = useSessions(tab === "all" ? undefined : tab);
  const approveSession = useApproveSession();
  const rejectSession = useRejectSession();
  const endSession = useEndSession();

  // Waiter assignment filtering
  const user = useAuthStore((s) => s.user);
  const { data: branchSettingsData } = useBranchSettings();
  const { data: myAssignedTables } = useMyAssignedTables();
  const waiterAssignmentEnabled = (branchSettingsData as any)?.settings?.waiter_table_assignment_enabled ?? false;
  const isAdminOrManager = user?.role === "super_admin" || user?.role === "org_admin" || user?.role === "branch_manager";

  const sessionList: any[] = useMemo(() => {
    const all: any[] = sessions ?? [];
    // If assignment filtering is disabled or user is admin/manager, show all
    if (!waiterAssignmentEnabled || isAdminOrManager) return all;
    // Filter to only sessions whose table is assigned to this waiter
    const assignedTableIds = new Set((myAssignedTables ?? []).map((a: any) => a.table_id));
    if (assignedTableIds.size === 0) return all; // No assignments = show all (fallback)
    return all.filter((s: any) => assignedTableIds.has(s.table_id));
  }, [sessions, waiterAssignmentEnabled, isAdminOrManager, myAssignedTables]);

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
