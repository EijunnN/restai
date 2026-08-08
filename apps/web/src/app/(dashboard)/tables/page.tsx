"use client";

import { useState } from "react";
import { Button } from "@restai/ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@restai/ui/components/sheet";
import {
  AlertCircle,
  LayoutGrid,
  Map as MapIcon,
  Plus,
  RefreshCw,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { hasPermission } from "@/lib/permissions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  useUpdateTableStatus,
  useDeleteTable,
  useDeleteSpace,
  type TableRow,
} from "@/hooks/use-tables";
import {
  TablesProvider,
  useTablesContext,
  ALL_SPACES,
  UNASSIGNED_SPACE,
  type StateFilter,
} from "./_components/tables-context";
import { TableTile, TableTileSkeleton } from "./_components/table-tile";
import { SidePanel } from "./_components/side-panel";
import { FloorPlannerView } from "./_components/floor-planner-view";
import { QrDialog } from "./_components/qr-dialog";
import { CreateTableDialog } from "./_components/create-table-dialog";
import { CreateSpaceDialog, EditSpaceDialog } from "./_components/space-management";
import { HistoryDialog } from "./_components/history-dialog";
import { AssignmentDialog } from "./_components/assignment-dialog";
import { CobrarDialog } from "./_components/cobrar-dialog";
import { FreeTableDialog } from "./_components/free-table-dialog";
import { SeatCustomerDialog } from "./_components/seat-customer-dialog";
import { MoveSessionDialog } from "./_components/move-session-dialog";
import { MergeTablesDialog } from "./_components/merge-tables-dialog";

/** Filtros por estado, con el color del punto que los identifica. */
const FILTROS: { key: StateFilter; label: string; dot?: string }[] = [
  { key: "all", label: "Todas" },
  { key: "available", label: "Libres", dot: "bg-muted-foreground/60" },
  { key: "occupied", label: "Ocupadas", dot: "bg-blue-600 dark:bg-blue-500" },
  { key: "reserved", label: "Reservadas", dot: "bg-amber-500" },
  { key: "alerts", label: "Con aviso", dot: "bg-violet-600 dark:bg-violet-500" },
];

function TablesContent() {
  const {
    allTables,
    tables,
    spaces,
    branchSlug,
    isLoading,
    error,
    refetch,
    space,
    setSpace,
    stateFilter,
    setStateFilter,
    onlyMine,
    setOnlyMine,
    canFilterMine,
    selected,
    selectTable,
    counts,
    requestByTableId,
    pendingSessions,
    canCreateLayout,
    canOperateTables,
    emptyMessage,
  } = useTablesContext();

  const user = useAuthStore((s) => s.user);
  const canDelete = hasPermission(user?.role, "tables:delete");
  const canCharge = hasPermission(user?.role, "payments:create");

  const [viewMode, setViewMode] = useState<"grid" | "planner">("grid");
  const [qrDialog, setQrDialog] = useState<TableRow | null>(null);
  const [createTableDialog, setCreateTableDialog] = useState(false);
  const [createSpaceDialog, setCreateSpaceDialog] = useState(false);
  const [editSpaceDialog, setEditSpaceDialog] = useState<any>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<
    { type: "table" | "space"; id: string; name: string } | null
  >(null);
  const [historyDialog, setHistoryDialog] = useState<TableRow | null>(null);
  const [assignDialog, setAssignDialog] = useState<TableRow | null>(null);
  const [chargeTable, setChargeTable] = useState<TableRow | null>(null);
  const [freeTarget, setFreeTarget] = useState<TableRow | null>(null);
  const [seatTarget, setSeatTarget] = useState<TableRow | null>(null);
  const [moveTarget, setMoveTarget] = useState<TableRow | null>(null);
  const [mergeTarget, setMergeTarget] = useState<TableRow | null>(null);

  const updateTableStatus = useUpdateTableStatus();
  const deleteTable = useDeleteTable();
  const deleteSpace = useDeleteSpace();

  /** Mesas donde alguien escaneó el QR y espera aprobación. */
  const wantsToJoin = new Set(pendingSessions.map((s) => s.table_id));


  /**
   * Cambio de estado desde los chips de la ficha.
   *
   * Dos de los cuatro valores NO son un cambio de columna y por eso se
   * interceptan: "ocupada" sin abrir cuenta deja una mesa a la que no se le
   * puede colgar un pedido y con el QR libre para cualquiera, y "libre" sin
   * cerrar la visita deja la sesión huérfana con sus pedidos sin cobrar. Cada
   * uno abre el diálogo que hace el trabajo de verdad.
   */
  const handleStatusChange = (tableId: string, newStatus: string) => {
    const table = allTables.find((t) => t.id === tableId);
    if (!table) return;

    if (newStatus === "available") {
      if (table.status === "available") return;
      setFreeTarget(table);
      return;
    }
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
            err instanceof Error ? err.message : "No se pudo cambiar el estado de la mesa",
          ),
      },
    );
  };

  const handleDelete = () => {
    if (!deleteConfirm) return;
    if (deleteConfirm.type === "table") {
      deleteTable.mutate(deleteConfirm.id, {
        onSuccess: () => {
          toast.success(`${deleteConfirm.name} eliminada`);
          setDeleteConfirm(null);
          selectTable(null);
        },
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "No se pudo eliminar la mesa"),
      });
    } else {
      deleteSpace.mutate(deleteConfirm.id, {
        onSuccess: () => {
          toast.success(`Espacio "${deleteConfirm.name}" eliminado`);
          setDeleteConfirm(null);
          if (space === deleteConfirm.id) setSpace(ALL_SPACES);
        },
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "No se pudo eliminar el espacio"),
      });
    }
  };

  /** La ficha es la misma en la columna fija y en el panel deslizante. */
  const panelProps = {
    onCharge: setChargeTable,
    onSeat: setSeatTarget,
    onFree: setFreeTarget,
    onMove: setMoveTarget,
    onMerge: setMergeTarget,
    onQr: setQrDialog,
    onHistory: setHistoryDialog,
    onAssign: setAssignDialog,
    onDelete: (t: TableRow) =>
      setDeleteConfirm({ type: "table", id: t.id, name: `Mesa ${t.number}` }),
    onStatusChange: handleStatusChange,
    statusChangePending: updateTableStatus.isPending,
    canDelete,
    canCharge,
  };

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Mesas</h1>
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/50 bg-destructive/5 p-4"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
            <p className="text-sm text-destructive">
              No se pudieron cargar las mesas: {error.message}
            </p>
          </div>
          <Button variant="outline" className="h-10" onClick={() => refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  const espacioActivo = spaces.find((s: any) => s.id === space);

  return (
    /*
      La sala ocupa el alto completo en escritorio: cada franja recuperada son
      dos filas más de mesas sin desplazar. En móvil NO se anula el relleno,
      porque el layout reserva ahí la barra de navegación inferior.
    */
    <div className="flex h-[calc(100vh-11rem)] flex-col overflow-hidden rounded-lg border border-border bg-background md:-m-6 md:h-[calc(100vh-3.5rem)] md:rounded-none md:border-0">
      <style>{`
        @keyframes mesa-pulse { 0% { transform: scale(1); opacity: .5 } 70% { transform: scale(2.2); opacity: 0 } 100% { opacity: 0 } }
        .animate-mesa-pulse { animation: mesa-pulse 2.4s ease-out infinite }
        @media (prefers-reduced-motion: reduce) { .animate-mesa-pulse { animation: none } }
      `}</style>

      {/* ── Cabecera ───────────────────────────────────────────────────── */}
      <header className="flex h-[60px] flex-none items-center gap-3 border-b border-border bg-card px-4">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-[24px] font-bold leading-none tracking-[-0.03em] text-foreground">
            Sala
          </h1>
          <span className="hidden text-[12px] text-muted-foreground sm:inline">
            {isLoading
              ? "Cargando…"
              : `${counts.occupied} de ${counts.total} ocupadas`}
          </span>
        </div>

        <div className="hidden h-6 w-px bg-border lg:block" />

        {/* Espacios. Solo aparecen si el local tiene más de un ambiente. */}
        {spaces.length > 0 && (
          <div className="hidden items-center gap-1 overflow-x-auto lg:flex">
            <SpaceChip
              label="Todas"
              active={space === ALL_SPACES}
              onClick={() => setSpace(ALL_SPACES)}
            />
            {spaces.map((s: any) => (
              <SpaceChip
                key={s.id}
                label={s.name}
                active={space === s.id}
                onClick={() => setSpace(s.id)}
              />
            ))}
            <SpaceChip
              label="Sin espacio"
              active={space === UNASSIGNED_SPACE}
              onClick={() => setSpace(UNASSIGNED_SPACE)}
            />
          </div>
        )}

        <span className="flex-1" />

        <div className="hidden rounded-lg bg-muted p-[3px] sm:flex">
          <ViewToggle
            active={viewMode === "grid"}
            icon={LayoutGrid}
            label="Lista"
            onClick={() => setViewMode("grid")}
          />
          <ViewToggle
            active={viewMode === "planner"}
            icon={MapIcon}
            label="Plano"
            onClick={() => setViewMode("planner")}
          />
        </div>

        {canCreateLayout && (
          <>
            <Button
              variant="outline"
              className="hidden h-9 md:inline-flex"
              onClick={() => setCreateSpaceDialog(true)}
            >
              Nuevo espacio
            </Button>
            <Button className="h-9" onClick={() => setCreateTableDialog(true)}>
              <Plus className="mr-1.5 h-[15px] w-[15px]" aria-hidden="true" />
              Nueva mesa
            </Button>
          </>
        )}

        <button
          type="button"
          onClick={() => refetch()}
          title="Actualizar la sala"
          aria-label="Actualizar la sala"
          className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <RefreshCw className="h-[18px] w-[18px]" aria-hidden="true" />
        </button>
      </header>

      {/* ── Filtros por estado ─────────────────────────────────────────── */}
      <div className="flex flex-none items-center gap-1.5 overflow-x-auto border-b border-border bg-card px-4 py-2.5">
        {FILTROS.map((f) => {
          const n =
            f.key === "all"
              ? counts.total
              : f.key === "alerts"
                ? counts.alerts
                : counts[f.key];
          const active = stateFilter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              aria-pressed={active}
              onClick={() => setStateFilter(f.key)}
              className={cn(
                "inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-[13px] font-semibold transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-foreground/[0.05] text-muted-foreground hover:text-foreground dark:bg-white/[0.06]",
              )}
            >
              {f.dot && <span className={cn("h-[7px] w-[7px] rounded-full", f.dot)} />}
              {f.label}
              <span className="text-[11px] font-extrabold tabular-nums opacity-60">{n}</span>
            </button>
          );
        })}

        <span className="flex-1" />

        {/* El interruptor solo existe si la sede asigna mozos y este tiene mesas:
            en cualquier otro caso filtraría la sala hasta dejarla vacía. */}
        {canFilterMine && (
          <button
            type="button"
            aria-pressed={onlyMine}
            onClick={() => setOnlyMine(!onlyMine)}
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-[13px] font-semibold transition-colors",
              onlyMine
                ? "bg-primary text-primary-foreground"
                : "bg-foreground/[0.05] text-muted-foreground hover:text-foreground dark:bg-white/[0.06]",
            )}
          >
            <Users className="h-[15px] w-[15px]" aria-hidden="true" />
            Solo mis mesas
          </button>
        )}
      </div>

      {/* ── Sala + panel ───────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 gap-4 p-4">
        <div className="min-h-0 flex-1 overflow-y-auto">
          {viewMode === "planner" ? (
            <FloorPlannerView tables={tables} requestByTableId={requestByTableId} />
          ) : isLoading ? (
            <div className="grid grid-cols-2 gap-3.5 md:grid-cols-3 2xl:grid-cols-4">
              {Array.from({ length: 12 }).map((_, i) => (
                <TableTileSkeleton key={i} />
              ))}
            </div>
          ) : tables.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-20 text-center">
              <LayoutGrid className="h-7 w-7 text-muted-foreground/40" aria-hidden="true" />
              <p className="max-w-sm text-[13.5px] text-muted-foreground">{emptyMessage}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3.5 md:grid-cols-3 2xl:grid-cols-4">
              {tables.map((t) => (
                <TableTile
                  key={t.id}
                  table={t}
                  selected={selected?.id === t.id}
                  serviceRequest={requestByTableId[t.id]}
                  wantsToJoin={wantsToJoin.has(t.id)}
                  canCharge={canCharge}
                  canOperate={canOperateTables}
                  onSelect={selectTable}
                  onPrimary={(table) =>
                    table.status === "occupied" ? setChargeTable(table) : setSeatTarget(table)
                  }
                />
              ))}
            </div>
          )}

          {/* Ficha del espacio activo: editar y borrar viven aquí abajo, fuera
              del camino de quien solo está trabajando la sala. */}
          {espacioActivo && canCreateLayout && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3">
              <p className="text-[13px] text-muted-foreground">
                <span className="font-semibold text-foreground">{espacioActivo.name}</span>
                {" · "}
                {tables.length} {tables.length === 1 ? "mesa" : "mesas"}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="h-9"
                  onClick={() => setEditSpaceDialog(espacioActivo)}
                >
                  Editar espacio
                </Button>
                <Button
                  variant="outline"
                  className="h-9 text-destructive hover:text-destructive"
                  onClick={() =>
                    setDeleteConfirm({
                      type: "space",
                      id: espacioActivo.id,
                      name: espacioActivo.name,
                    })
                  }
                >
                  Eliminar
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* En pantalla ancha el panel vive fijo al lado de la sala. */}
        <div className="hidden w-[344px] flex-none xl:block">
          <SidePanel {...panelProps} />
        </div>
      </div>

      {/*
        Por debajo de `xl` no cabe la columna, pero la ficha NO puede
        desaparecer: es el único sitio desde donde se llega al QR, al historial,
        a mover, juntar o liberar. En la tablet del mozo —que es justo este
        ancho— quedarse sin esas acciones sería perder media pantalla de
        trabajo, así que la misma ficha se abre como panel deslizante.
      */}
      <Sheet
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) selectTable(null);
        }}
      >
        <SheetContent className="w-full overflow-y-auto p-0 sm:max-w-[380px] xl:hidden">
          <SheetHeader className="sr-only">
            <SheetTitle>Ficha de la mesa {selected?.number}</SheetTitle>
          </SheetHeader>
          <SidePanel {...panelProps} />
        </SheetContent>
      </Sheet>

      {/* ── Diálogos ───────────────────────────────────────────────────── */}
      <QrDialog table={qrDialog} branchSlug={branchSlug} onClose={() => setQrDialog(null)} />
      <CreateTableDialog
        open={createTableDialog}
        onOpenChange={setCreateTableDialog}
        spaces={spaces}
      />
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
      {/* Mover y juntar reciben la sala ENTERA, no la filtrada: si no,
          desaparecerían mesas destino por estar en otro espacio o fuera del
          filtro activo. */}
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

function SpaceChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "h-8 shrink-0 rounded-lg px-3 text-[13px] font-semibold transition-colors",
        active
          ? "bg-foreground/[0.10] text-foreground dark:bg-white/[0.12]"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function ViewToggle({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof LayoutGrid;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-[30px] items-center gap-1.5 rounded-md px-3 text-[13px] font-semibold transition-colors",
        active ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-[15px] w-[15px]" aria-hidden="true" />
      {label}
    </button>
  );
}

export default function TablesPage() {
  return (
    <TablesProvider>
      <TablesContent />
    </TablesProvider>
  );
}
