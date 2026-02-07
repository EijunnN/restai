"use client";

import { useState, useMemo } from "react";
import { Button } from "@restai/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@restai/ui/components/card";
import { Badge } from "@restai/ui/components/badge";
import { Tabs, TabsList, TabsTrigger } from "@restai/ui/components/tabs";
import {
  Plus,
  RefreshCw,
  Check,
  X,
  Bell,
  LayoutGrid,
  Map,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useTables,
  useUpdateTableStatus,
  useDeleteTable,
  useSpaces,
  useDeleteSpace,
  usePendingSessions,
  useApproveSession,
  useRejectSession,
} from "@/hooks/use-tables";
import { useBranchSettings } from "@/hooks/use-settings";
import { PageHeader } from "@/components/page-header";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FloorPlannerView } from "./_components/floor-planner-view";
import { GridView } from "./_components/grid-view";
import { QrDialog } from "./_components/qr-dialog";
import { CreateTableDialog } from "./_components/create-table-dialog";
import { CreateSpaceDialog, EditSpaceDialog, SpaceInfoCard } from "./_components/space-management";
import { HistoryDialog } from "./_components/history-dialog";
import { AssignmentDialog } from "./_components/assignment-dialog";

export default function TablesPage() {
  const [activeTab, setActiveTab] = useState("all");
  const [viewMode, setViewMode] = useState<"grid" | "planner">("grid");
  const [qrDialog, setQrDialog] = useState<any>(null);
  const [createTableDialog, setCreateTableDialog] = useState(false);
  const [createSpaceDialog, setCreateSpaceDialog] = useState(false);
  const [editSpaceDialog, setEditSpaceDialog] = useState<any>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: "table" | "space"; id: string; name: string } | null>(null);
  const [historyDialog, setHistoryDialog] = useState<any>(null);
  const [assignDialog, setAssignDialog] = useState<any>(null);

  // Data hooks
  const { data: spacesData, isLoading: spacesLoading } = useSpaces();
  const { data: tablesData, isLoading: tablesLoading, error, refetch } = useTables();
  const updateTableStatus = useUpdateTableStatus();
  const deleteTable = useDeleteTable();
  const deleteSpace = useDeleteSpace();
  const { data: pendingData } = usePendingSessions();
  const approveSession = useApproveSession();
  const rejectSession = useRejectSession();
  const { data: branchSettingsData } = useBranchSettings();

  const waiterAssignmentEnabled = (branchSettingsData as any)?.settings?.waiter_table_assignment_enabled ?? false;
  const pendingSessions: any[] = pendingData ?? [];
  const spaces: any[] = spacesData ?? [];
  const allTables: any[] = tablesData?.tables ?? [];
  const branchSlug: string = tablesData?.branchSlug ?? "";
  const isLoading = spacesLoading || tablesLoading;

  const filteredTables = useMemo(() => {
    if (activeTab === "all") return allTables;
    if (activeTab === "unassigned") return allTables.filter((t: any) => !t.space_id);
    return allTables.filter((t: any) => t.space_id === activeTab);
  }, [allTables, activeTab]);

  const counts = {
    total: allTables.length,
    available: allTables.filter((t: any) => t.status === "available").length,
    occupied: allTables.filter((t: any) => t.status === "occupied").length,
    reserved: allTables.filter((t: any) => t.status === "reserved").length,
  };

  const handleStatusChange = (tableId: string, newStatus: string) => {
    updateTableStatus.mutate({ id: tableId, status: newStatus });
  };

  const handleDelete = () => {
    if (!deleteConfirm) return;
    if (deleteConfirm.type === "table") {
      deleteTable.mutate(deleteConfirm.id, {
        onSuccess: () => setDeleteConfirm(null),
      });
    } else {
      deleteSpace.mutate(deleteConfirm.id, {
        onSuccess: () => {
          setDeleteConfirm(null);
          if (activeTab === deleteConfirm.id) setActiveTab("all");
        },
      });
    }
  };

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Mesas</h1>
        </div>
        <div className="p-4 rounded-lg border border-destructive/50 bg-destructive/5 flex items-center justify-between">
          <p className="text-sm text-destructive">
            Error al cargar mesas: {(error as Error).message}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
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
                size="sm"
                className="rounded-r-none"
                onClick={() => setViewMode("grid")}
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === "planner" ? "default" : "ghost"}
                size="sm"
                className="rounded-l-none"
                onClick={() => setViewMode("planner")}
              >
                <Map className="h-4 w-4" />
              </Button>
            </div>
            <Button variant="outline" onClick={() => setCreateSpaceDialog(true)}>
              <LayoutGrid className="h-4 w-4 mr-2" />
              Nuevo Espacio
            </Button>
            <Button onClick={() => setCreateTableDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Nueva Mesa
            </Button>
          </>
        }
      />

      {/* Summary Cards */}
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

      {/* Pending Session Requests */}
      {pendingSessions.length > 0 && (
        <Card className="border-2 border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Bell className="h-4 w-4 text-amber-600" />
              Solicitudes pendientes ({pendingSessions.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {pendingSessions.map((session: any) => (
                <div
                  key={session.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-background border"
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
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      disabled={rejectSession.isPending}
                      onClick={() => rejectSession.mutate(session.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      disabled={approveSession.isPending}
                      onClick={() => approveSession.mutate(session.id)}
                    >
                      <Check className="h-4 w-4 mr-1" />
                      Aceptar
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs: All / Per Space / Unassigned */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center gap-2 overflow-x-auto">
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

        {/* Space info card */}
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

        {/* View: Grid or Floor Planner */}
        {viewMode === "planner" ? (
          <div className="mt-4">
            <FloorPlannerView tables={filteredTables} />
          </div>
        ) : (
          <GridView
            tables={filteredTables}
            isLoading={isLoading}
            waiterAssignmentEnabled={waiterAssignmentEnabled}
            statusChangePending={updateTableStatus.isPending}
            onQr={setQrDialog}
            onHistory={setHistoryDialog}
            onAssign={setAssignDialog}
            onDelete={(table) =>
              setDeleteConfirm({ type: "table", id: table.id, name: `Mesa ${table.number}` })
            }
            onStatusChange={handleStatusChange}
          />
        )}
      </Tabs>

      {/* Dialogs */}
      <QrDialog table={qrDialog} branchSlug={branchSlug} onClose={() => setQrDialog(null)} />
      <CreateTableDialog open={createTableDialog} onOpenChange={setCreateTableDialog} spaces={spaces} />
      <CreateSpaceDialog open={createSpaceDialog} onOpenChange={setCreateSpaceDialog} />
      <EditSpaceDialog space={editSpaceDialog} onClose={() => setEditSpaceDialog(null)} />
      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={(open) => !open && setDeleteConfirm(null)}
        title="Confirmar Eliminacion"
        description={
          deleteConfirm?.type === "space"
            ? `Estas seguro de eliminar el espacio "${deleteConfirm.name}"? Solo se puede eliminar si no tiene mesas asignadas.`
            : `Estas seguro de eliminar "${deleteConfirm?.name}"? Esta accion no se puede deshacer.`
        }
        onConfirm={handleDelete}
        loading={deleteTable.isPending || deleteSpace.isPending}
      />
      <HistoryDialog table={historyDialog} onClose={() => setHistoryDialog(null)} />
      <AssignmentDialog table={assignDialog} onClose={() => setAssignDialog(null)} />
    </div>
  );
}
