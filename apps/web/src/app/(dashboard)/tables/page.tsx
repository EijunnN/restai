"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Button, buttonVariants } from "@restai/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@restai/ui/components/card";
import { Tabs, TabsList, TabsTrigger } from "@restai/ui/components/tabs";
import {
  Plus,
  RefreshCw,
  Check,
  X,
  Bell,
  LayoutGrid,
  Map as MapIcon,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useWebSocket } from "@/hooks/use-websocket";
import { useAuthStore } from "@/stores/auth-store";
import type { WsMessage } from "@restai/types";
import { toast } from "sonner";
import {
  useTables,
  useUpdateTableStatus,
  useDeleteTable,
  useSpaces,
  useDeleteSpace,
  usePendingSessions,
  useApproveSession,
  useRejectSession,
  useMyAssignedTables,
  type TableRow,
} from "@/hooks/use-tables";
import { useServiceRequests } from "@/hooks/use-service-requests";
import { useBranchSettings } from "@/hooks/use-settings";
import { hasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/page-header";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FloorPlannerView } from "./_components/floor-planner-view";
import { GridView } from "./_components/grid-view";
import { QrDialog } from "./_components/qr-dialog";
import { CreateTableDialog } from "./_components/create-table-dialog";
import { CreateSpaceDialog, EditSpaceDialog, SpaceInfoCard } from "./_components/space-management";
import { HistoryDialog } from "./_components/history-dialog";
import { AssignmentDialog } from "./_components/assignment-dialog";
import { CobrarDialog } from "./_components/cobrar-dialog";
import { FreeTableDialog } from "./_components/free-table-dialog";
import { SeatCustomerDialog } from "./_components/seat-customer-dialog";
import { MoveSessionDialog } from "./_components/move-session-dialog";
import { MergeTablesDialog } from "./_components/merge-tables-dialog";

interface TableServiceRequestIndicator {
  type: "request_bill" | "call_waiter";
  customerName: string;
}

interface PendingSessionRequest {
  id: string;
  customer_name: string;
  customer_phone: string | null;
  started_at: string;
  table_id: string;
  table_number: number;
}

/** Avisos que siguen sin resolverse: son los que pintan la mesa. */
const OPEN_REQUEST_STATUSES = new Set(["pending", "acknowledged"]);

export default function TablesPage() {
  const [activeTab, setActiveTab] = useState("all");
  const [viewMode, setViewMode] = useState<"grid" | "planner">("grid");
  const [onlyMine, setOnlyMine] = useState(false);
  const [qrDialog, setQrDialog] = useState<TableRow | null>(null);
  const [createTableDialog, setCreateTableDialog] = useState(false);
  const [createSpaceDialog, setCreateSpaceDialog] = useState(false);
  const [editSpaceDialog, setEditSpaceDialog] = useState<any>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: "table" | "space"; id: string; name: string } | null>(null);
  const [historyDialog, setHistoryDialog] = useState<TableRow | null>(null);
  const [assignDialog, setAssignDialog] = useState<TableRow | null>(null);
  const [chargeTable, setChargeTable] = useState<TableRow | null>(null);
  const [freeTarget, setFreeTarget] = useState<TableRow | null>(null);
  const [seatTarget, setSeatTarget] = useState<TableRow | null>(null);
  const [moveTarget, setMoveTarget] = useState<TableRow | null>(null);
  const [mergeTarget, setMergeTarget] = useState<TableRow | null>(null);
  const [pendingSessions, setPendingSessions] = useState<PendingSessionRequest[]>([]);
  const [mutatingSessionId, setMutatingSessionId] = useState<string | null>(null);
  const { accessToken, selectedBranchId, user } = useAuthStore();
  const queryClient = useQueryClient();

  // Crear mesas y espacios es configurar el local (`tables:create`): el mozo y
  // el cajero entran aquí a trabajar la sala, no a montarla. Enseñarles los
  // botones solo servía para que la API les respondiera 403.
  const canCreateLayout = hasPermission(user?.role, "tables:create");
  /** Aprobar o rechazar una solicitud de ingreso exige `tables:update`. */
  const canOperateTables = hasPermission(user?.role, "tables:update");

  // Data hooks
  const { data: spacesData, isLoading: spacesLoading } = useSpaces();
  const { data: tablesData, isLoading: tablesLoading, error, refetch } = useTables();
  const updateTableStatus = useUpdateTableStatus();
  const deleteTable = useDeleteTable();
  const deleteSpace = useDeleteSpace();
  const { data: pendingData, refetch: refetchPendingSessions } = usePendingSessions();
  const approveSession = useApproveSession();
  const rejectSession = useRejectSession();
  const { data: branchSettingsData } = useBranchSettings();
  // Los avisos ahora persisten: la mesa sigue marcada aunque el mozo entre a la
  // pantalla media hora después de que el comensal levantara la mano.
  const { data: serviceRequestsData } = useServiceRequests();

  const waiterAssignmentEnabled = (branchSettingsData as any)?.settings?.waiter_table_assignment_enabled ?? false;
  const { data: myAssignedTables } = useMyAssignedTables({ enabled: waiterAssignmentEnabled });
  const spaces: any[] = spacesData ?? [];
  const allTables: TableRow[] = tablesData?.tables ?? [];
  const branchSlug: string = tablesData?.branchSlug ?? "";
  const isLoading = spacesLoading || tablesLoading;
  const currentTableIds = useMemo(
    () => new Set(allTables.map((table) => String(table.id))),
    [allTables]
  );

  const assignedTableIds = useMemo(
    () => new Set((myAssignedTables ?? []).map((a) => a.table_id)),
    [myAssignedTables]
  );

  // El interruptor solo tiene sentido si la sede usa asignación de mozos y este
  // usuario tiene mesas asignadas; si no, filtraría la sala hasta dejarla vacía.
  const canFilterMine = waiterAssignmentEnabled && assignedTableIds.size > 0;

  useEffect(() => {
    if (!canFilterMine && onlyMine) setOnlyMine(false);
  }, [canFilterMine, onlyMine]);

  useEffect(() => {
    setPendingSessions((pendingData ?? []) as PendingSessionRequest[]);
  }, [pendingData]);

  const filteredTables = useMemo(() => {
    let list = allTables;
    if (activeTab === "unassigned") list = list.filter((t) => !t.space_id);
    else if (activeTab !== "all") list = list.filter((t) => t.space_id === activeTab);
    if (onlyMine && canFilterMine) list = list.filter((t) => assignedTableIds.has(t.id));
    return list;
  }, [allTables, activeTab, onlyMine, canFilterMine, assignedTableIds]);

  const counts = {
    total: allTables.length,
    available: allTables.filter((t) => t.status === "available").length,
    occupied: allTables.filter((t) => t.status === "occupied").length,
    reserved: allTables.filter((t) => t.status === "reserved").length,
  };

  const requestByTableId = useMemo<Record<string, TableServiceRequestIndicator>>(() => {
    const result: Record<string, TableServiceRequestIndicator> = {};
    for (const request of serviceRequestsData ?? []) {
      if (!request.table_id || !OPEN_REQUEST_STATUSES.has(request.status)) continue;
      // La lista llega ordenada con los más antiguos primero dentro de cada
      // grupo: nos quedamos con el primero que veamos, que es el que más espera.
      if (result[request.table_id]) continue;
      result[request.table_id] = {
        type: request.type,
        customerName:
          (request as { customer_name?: string | null }).customer_name || "Cliente",
      };
    }
    return result;
  }, [serviceRequestsData]);

  const openRequestCount = Object.keys(requestByTableId).length;

  const handleWsMessage = useCallback((msg: WsMessage) => {
    // El tipado de WsMessageType aún no incluye los eventos nuevos de sala.
    const type = msg.type as string;

    if (type === "auth:success") {
      void refetchPendingSessions();
      void queryClient.invalidateQueries({ queryKey: ["service-requests"] });
      return;
    }

    if (type === "session:pending") {
      const payload = msg.payload as {
        sessionId: string;
        tableId: string;
        tableNumber: number;
        customerName?: string;
      };

      if (!currentTableIds.has(String(payload.tableId))) {
        return;
      }

      setPendingSessions((prev) => {
        if (prev.some((session) => session.id === payload.sessionId)) {
          return prev;
        }
        return [
          {
            id: payload.sessionId,
            customer_name: payload.customerName || "Cliente",
            customer_phone: null,
            started_at: new Date(msg.timestamp).toISOString(),
            table_id: payload.tableId,
            table_number: payload.tableNumber,
          },
          ...prev,
        ];
      });
      return;
    }

    if (type === "session:approved" || type === "session:rejected") {
      const payload = msg.payload as { sessionId: string };
      setPendingSessions((prev) =>
        prev.filter((session) => session.id !== payload.sessionId)
      );
      void queryClient.invalidateQueries({ queryKey: ["tables"] });
      return;
    }

    // Mover, juntar, liberar o cambiar el estado de una mesa reordena el plano
    // entero: se relee en vez de intentar parchear el caché a mano.
    if (
      type === "table:status" ||
      type === "session:started" ||
      type === "session:ended" ||
      type === "session:moved" ||
      type === "session:merged"
    ) {
      void queryClient.invalidateQueries({ queryKey: ["tables"] });
      void queryClient.invalidateQueries({ queryKey: ["service-requests"] });
      return;
    }

    if (
      type === "service_request:acknowledged" ||
      type === "service_request:resolved"
    ) {
      void queryClient.invalidateQueries({ queryKey: ["service-requests"] });
      return;
    }

    if (type !== "table:request_bill" && type !== "table:call_waiter") {
      return;
    }

    const payload = msg.payload as {
      tableId: string;
      tableNumber: number;
      customerName?: string;
    };

    void queryClient.invalidateQueries({ queryKey: ["service-requests"] });

    toast.info(
      type === "table:request_bill"
        ? `Mesa ${payload.tableNumber}: ${payload.customerName || "Cliente"} solicita la cuenta`
        : `Mesa ${payload.tableNumber}: ${payload.customerName || "Cliente"} solicita mozo`
    );
  }, [currentTableIds, queryClient, refetchPendingSessions]);

  useWebSocket(
    selectedBranchId ? [`branch:${selectedBranchId}`] : [],
    handleWsMessage,
    accessToken || undefined
  );

  const handleStatusChange = (tableId: string, newStatus: string) => {
    const table = allTables.find((t) => t.id === tableId);
    if (!table) return;

    // Liberar cierra la visita y finaliza pedidos: pasa por su propio diálogo,
    // que además enseña el saldo pendiente si lo hay.
    if (newStatus === "available") {
      if (table.status === "available") return;
      setFreeTarget(table);
      return;
    }

    // "Ocupar" sin abrir cuenta dejaba la mesa sin sesión: no se le podía cobrar
    // y su QR seguía libre para cualquiera. Se sienta al cliente de verdad.
    if (newStatus === "occupied") {
      if (table.status === "occupied") return;
      setSeatTarget(table);
      return;
    }

    updateTableStatus.mutate(
      { id: tableId, status: newStatus },
      {
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : "No se pudo cambiar el estado de la mesa"
          ),
      }
    );
  };

  const handleDelete = () => {
    if (!deleteConfirm) return;
    if (deleteConfirm.type === "table") {
      deleteTable.mutate(deleteConfirm.id, {
        onSuccess: () => {
          toast.success(`${deleteConfirm.name} eliminada`);
          setDeleteConfirm(null);
        },
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "No se pudo eliminar la mesa"),
      });
    } else {
      deleteSpace.mutate(deleteConfirm.id, {
        onSuccess: () => {
          toast.success(`Espacio "${deleteConfirm.name}" eliminado`);
          setDeleteConfirm(null);
          if (activeTab === deleteConfirm.id) setActiveTab("all");
        },
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : "No se pudo eliminar el espacio"
          ),
      });
    }
  };

  const emptyMessage =
    onlyMine && canFilterMine
      ? "No tienes mesas asignadas en esta vista. Desactiva «Solo mis mesas» para ver toda la sala."
      : activeTab === "unassigned"
        ? "Todas las mesas están asignadas a un espacio."
        : canCreateLayout
          ? "No hay mesas aquí todavía. Crea la primera con «Nueva Mesa»."
          : "No hay mesas aquí todavía. Pídele a un responsable que dé de alta las mesas del salón.";

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Mesas</h1>
        </div>
        <div
          className="p-4 rounded-lg border border-destructive/50 bg-destructive/5 flex flex-wrap items-center justify-between gap-3"
          role="alert"
        >
          <p className="text-sm text-destructive">
            No se pudieron cargar las mesas: {(error as Error).message}
          </p>
          <Button variant="outline" className="h-10" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" />
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Cabecera */}
      <PageHeader
        title="Mesas y Espacios"
        description={
          isLoading
            ? "Cargando..."
            : `${counts.available} disponibles, ${counts.occupied} ocupadas de ${counts.total} mesas`
        }
        actions={
          <>
            <div className="flex border rounded-md">
              <Button
                variant={viewMode === "grid" ? "default" : "ghost"}
                className="h-10 rounded-r-none"
                aria-label="Ver las mesas en cuadrícula"
                aria-pressed={viewMode === "grid"}
                onClick={() => setViewMode("grid")}
              >
                <LayoutGrid className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                variant={viewMode === "planner" ? "default" : "ghost"}
                className="h-10 rounded-l-none"
                aria-label="Ver el plano del local"
                aria-pressed={viewMode === "planner"}
                onClick={() => setViewMode("planner")}
              >
                <MapIcon className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
            {canCreateLayout && (
              <>
                <Button variant="outline" className="h-10" onClick={() => setCreateSpaceDialog(true)}>
                  <LayoutGrid className="h-4 w-4 mr-2" aria-hidden="true" />
                  Nuevo Espacio
                </Button>
                <Button className="h-10" onClick={() => setCreateTableDialog(true)}>
                  <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
                  Nueva Mesa
                </Button>
              </>
            )}
          </>
        }
      />

      {/* Resumen */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total", value: counts.total, color: "text-foreground" },
          { label: "Disponibles", value: counts.available, color: "text-green-600 dark:text-green-400" },
          { label: "Ocupadas", value: counts.occupied, color: "text-blue-600 dark:text-blue-400" },
          { label: "Reservadas", value: counts.reserved, color: "text-orange-600 dark:text-orange-400" },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">{stat.label}</p>
              <p className={cn("text-2xl font-bold", stat.color)}>
                {isLoading ? "-" : stat.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Solicitudes de ingreso pendientes de aprobar */}
      {pendingSessions.length > 0 && canOperateTables && (
        <Card className="border-2 border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Bell className="h-4 w-4 text-amber-600" aria-hidden="true" />
              Solicitudes de ingreso ({pendingSessions.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {pendingSessions.map((session) => {
                const busy = mutatingSessionId === session.id;
                return (
                  <div
                    key={session.id}
                    className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-background border"
                  >
                    <div>
                      <p className="font-medium">{session.customer_name}</p>
                      <p className="text-sm text-muted-foreground">
                        Mesa {session.table_number}
                        {session.customer_phone && ` · ${session.customer_phone}`}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="h-10 text-destructive hover:text-destructive"
                        aria-label={`Rechazar el ingreso de ${session.customer_name} en la mesa ${session.table_number}`}
                        disabled={busy}
                        onClick={() => {
                          setMutatingSessionId(session.id);
                          rejectSession.mutate(session.id, {
                            onSuccess: () => toast.success("Solicitud rechazada"),
                            onError: (err) =>
                              toast.error(
                                err instanceof Error
                                  ? err.message
                                  : "No se pudo rechazar la solicitud"
                              ),
                            onSettled: () => setMutatingSessionId(null),
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
                          setMutatingSessionId(session.id);
                          approveSession.mutate(session.id, {
                            onSuccess: () =>
                              toast.success(
                                `${session.customer_name} ya puede pedir en la mesa ${session.table_number}`
                              ),
                            onError: (err) =>
                              toast.error(
                                err instanceof Error
                                  ? err.message
                                  : "No se pudo aceptar la solicitud"
                              ),
                            onSettled: () => setMutatingSessionId(null),
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
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Avisos de mesa sin resolver: el detalle vive en la bandeja */}
      {openRequestCount > 0 && (
        <Card className="border-2 border-blue-300 dark:border-blue-700 bg-blue-50/50 dark:bg-blue-950/20">
          <CardContent className="p-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-blue-600" aria-hidden="true" />
              <p className="text-sm font-medium">
                {openRequestCount === 1
                  ? "1 mesa está esperando atención"
                  : `${openRequestCount} mesas están esperando atención`}
              </p>
            </div>
            <Link
              href="/connections"
              className={cn(
                buttonVariants({ variant: "default" }),
                "h-10 px-4"
              )}
            >
              Ver bandeja de avisos
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Espacios */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="overflow-x-auto">
            <TabsList>
              <TabsTrigger value="all">Todas</TabsTrigger>
              {spaces.map((space: any) => (
                <TabsTrigger key={space.id} value={space.id}>
                  {space.name}
                </TabsTrigger>
              ))}
              <TabsTrigger value="unassigned">Sin espacio</TabsTrigger>
            </TabsList>
          </div>

          {canFilterMine && (
            <Button
              variant={onlyMine ? "default" : "outline"}
              className="h-10 ml-auto"
              aria-pressed={onlyMine}
              onClick={() => setOnlyMine((v) => !v)}
            >
              {onlyMine ? "Solo mis mesas" : "Ver solo mis mesas"}
            </Button>
          )}
        </div>

        {/* Ficha del espacio activo */}
        {activeTab !== "all" && activeTab !== "unassigned" && (() => {
          const currentSpace = spaces.find((s: any) => s.id === activeTab);
          if (!currentSpace) return null;
          return (
            <SpaceInfoCard
              space={currentSpace}
              tableCount={filteredTables.length}
              onEdit={() => setEditSpaceDialog(currentSpace)}
              onDelete={() =>
                setDeleteConfirm({
                  type: "space",
                  id: currentSpace.id,
                  name: currentSpace.name,
                })
              }
            />
          );
        })()}

        {/* Vista: cuadrícula o plano */}
        {viewMode === "planner" ? (
          <div className="mt-4">
            <FloorPlannerView
              tables={filteredTables}
              requestByTableId={requestByTableId}
            />
          </div>
        ) : (
          <GridView
            tables={filteredTables}
            isLoading={isLoading}
            waiterAssignmentEnabled={waiterAssignmentEnabled}
            statusChangePending={updateTableStatus.isPending}
            requestByTableId={requestByTableId}
            emptyMessage={emptyMessage}
            onQr={setQrDialog}
            onHistory={setHistoryDialog}
            onAssign={setAssignDialog}
            onDelete={(table) =>
              setDeleteConfirm({ type: "table", id: table.id, name: `Mesa ${table.number}` })
            }
            onStatusChange={handleStatusChange}
            onCharge={setChargeTable}
            onSeat={setSeatTarget}
            onMove={setMoveTarget}
            onMerge={setMergeTarget}
          />
        )}
      </Tabs>

      {/* Diálogos */}
      <QrDialog table={qrDialog} branchSlug={branchSlug} onClose={() => setQrDialog(null)} />
      <CreateTableDialog open={createTableDialog} onOpenChange={setCreateTableDialog} spaces={spaces} />
      <CreateSpaceDialog open={createSpaceDialog} onOpenChange={setCreateSpaceDialog} />
      <EditSpaceDialog space={editSpaceDialog} onClose={() => setEditSpaceDialog(null)} />
      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={(open) => !open && setDeleteConfirm(null)}
        title="Confirmar eliminación"
        description={
          deleteConfirm?.type === "space"
            ? `¿Seguro que quieres eliminar el espacio "${deleteConfirm.name}"? Solo se puede eliminar si no tiene mesas asignadas.`
            : `¿Seguro que quieres eliminar "${deleteConfirm?.name}"? Esta acción no se puede deshacer.`
        }
        onConfirm={handleDelete}
        loading={deleteTable.isPending || deleteSpace.isPending}
      />
      <HistoryDialog table={historyDialog} onClose={() => setHistoryDialog(null)} />
      <AssignmentDialog table={assignDialog} onClose={() => setAssignDialog(null)} />
      <CobrarDialog table={chargeTable} onClose={() => setChargeTable(null)} />
      <FreeTableDialog
        table={freeTarget}
        onClose={() => setFreeTarget(null)}
        onGoCharge={(table) => setChargeTable(table)}
      />
      <SeatCustomerDialog table={seatTarget} onClose={() => setSeatTarget(null)} />
      <MoveSessionDialog
        table={moveTarget}
        tables={allTables}
        onClose={() => setMoveTarget(null)}
      />
      <MergeTablesDialog
        table={mergeTarget}
        tables={allTables}
        onClose={() => setMergeTarget(null)}
      />
    </div>
  );
}
