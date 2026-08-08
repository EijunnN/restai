"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { WsMessage } from "@restai/types";
import { useWebSocket } from "@/hooks/use-websocket";
import { useAuthStore } from "@/stores/auth-store";
import { hasPermission } from "@/lib/permissions";
import { useBranchSettings } from "@/hooks/use-settings";
import { useServiceRequests } from "@/hooks/use-service-requests";
import {
  useTables,
  useSpaces,
  usePendingSessions,
  useMyAssignedTables,
  type TableRow,
} from "@/hooks/use-tables";
import {
  ALL_SPACES,
  ALL_STATES,
  computeOccupancy,
  countTables,
  filterTables,
  UNASSIGNED_SPACE,
  type StateFilter,
} from "./table-filters";

/**
 * Estado compartido de la pantalla de sala.
 *
 * La página solo compone; todo lo que decide qué se ve —filtros, selección,
 * avisos, tiempo real— vive aquí, igual que en el KDS de cocina. Así la
 * cabecera, la cuadrícula y el panel lateral leen la MISMA verdad: antes, con
 * la lógica repartida por el JSX, el contador de la cabecera y la lista podían
 * discrepar sin que nadie lo notara.
 */

/** Avisos que siguen sin resolverse: son los que pintan la mesa. */
const OPEN_REQUEST_STATUSES = new Set(["pending", "acknowledged"]);

export { ALL_SPACES, UNASSIGNED_SPACE, ALL_STATES } from "./table-filters";
export type { StateFilter } from "./table-filters";

export interface TableServiceRequestIndicator {
  type: "request_bill" | "call_waiter";
  customerName: string;
}

export interface PendingSessionRequest {
  id: string;
  customer_name: string;
  customer_phone: string | null;
  started_at: string;
  table_id: string;
  table_number: number;
}

interface TablesContextValue {
  /** Toda la sala, sin filtrar. Lo que necesitan mover y juntar. */
  allTables: TableRow[];
  /** Lo que se pinta ahora mismo. */
  tables: TableRow[];
  spaces: any[];
  branchSlug: string;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;

  space: string;
  setSpace: (key: string) => void;
  stateFilter: StateFilter;
  setStateFilter: (key: StateFilter) => void;
  onlyMine: boolean;
  setOnlyMine: (v: boolean) => void;
  /** El interruptor solo existe si la sede asigna mozos y este tiene mesas. */
  canFilterMine: boolean;

  /** Mesa abierta en el panel lateral. */
  selected: TableRow | null;
  selectTable: (id: string | null) => void;

  counts: {
    total: number;
    available: number;
    occupied: number;
    reserved: number;
    maintenance: number;
    alerts: number;
  };
  /** Comensales sentados y aforo total de la sala. */
  occupancy: { seated: number; capacity: number; unknown: number };

  requestByTableId: Record<string, TableServiceRequestIndicator>;
  pendingSessions: PendingSessionRequest[];

  canCreateLayout: boolean;
  canOperateTables: boolean;
  waiterAssignmentEnabled: boolean;
  emptyMessage: string;
}

const TablesContext = createContext<TablesContextValue | null>(null);

export function useTablesContext() {
  const ctx = useContext(TablesContext);
  if (!ctx) throw new Error("useTablesContext debe usarse dentro de TablesProvider");
  return ctx;
}

export function TablesProvider({ children }: { children: ReactNode }) {
  const { accessToken, selectedBranchId, user } = useAuthStore();
  const queryClient = useQueryClient();

  const [space, setSpace] = useState<string>(ALL_SPACES);
  const [stateFilter, setStateFilter] = useState<StateFilter>(ALL_STATES);
  const [onlyMine, setOnlyMine] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingSessions, setPendingSessions] = useState<PendingSessionRequest[]>([]);

  // Crear mesas y espacios es configurar el local: el mozo y el cajero entran
  // aquí a trabajar la sala, no a montarla.
  const canCreateLayout = hasPermission(user?.role, "tables:create");
  /** Aprobar o rechazar una solicitud de ingreso exige `tables:update`. */
  const canOperateTables = hasPermission(user?.role, "tables:update");

  const { data: spacesData, isLoading: spacesLoading } = useSpaces();
  // Sin `spaceId`: el filtro por espacio es de cliente. Pasarlo a la query
  // cambiaría la clave de caché y los contadores dejarían de ver toda la sala.
  const { data: tablesData, isLoading: tablesLoading, error, refetch } = useTables();
  const { data: pendingData, refetch: refetchPendingSessions } = usePendingSessions();
  const { data: branchSettingsData } = useBranchSettings();
  const { data: serviceRequestsData } = useServiceRequests();

  const waiterAssignmentEnabled =
    (branchSettingsData as any)?.settings?.waiter_table_assignment_enabled ?? false;
  const { data: myAssignedTables } = useMyAssignedTables({ enabled: waiterAssignmentEnabled });

  const spaces: any[] = spacesData ?? [];
  const allTables: TableRow[] = tablesData?.tables ?? [];
  const branchSlug: string = tablesData?.branchSlug ?? "";
  const isLoading = spacesLoading || tablesLoading;

  const currentTableIds = useMemo(
    () => new Set(allTables.map((t) => String(t.id))),
    [allTables],
  );
  const assignedTableIds = useMemo(
    () => new Set((myAssignedTables ?? []).map((a) => a.table_id)),
    [myAssignedTables],
  );

  const canFilterMine = waiterAssignmentEnabled && assignedTableIds.size > 0;

  useEffect(() => {
    if (!canFilterMine && onlyMine) setOnlyMine(false);
  }, [canFilterMine, onlyMine]);

  useEffect(() => {
    setPendingSessions((pendingData ?? []) as PendingSessionRequest[]);
  }, [pendingData]);

  const requestByTableId = useMemo<Record<string, TableServiceRequestIndicator>>(() => {
    const result: Record<string, TableServiceRequestIndicator> = {};
    for (const request of serviceRequestsData ?? []) {
      if (!request.table_id || !OPEN_REQUEST_STATUSES.has(request.status)) continue;
      // La lista llega con los más antiguos primero dentro de cada grupo: nos
      // quedamos con el primero, que es el que más lleva esperando.
      if (result[request.table_id]) continue;
      result[request.table_id] = {
        type: request.type,
        customerName:
          (request as { customer_name?: string | null }).customer_name || "Cliente",
      };
    }
    return result;
  }, [serviceRequestsData]);

  /**
   * Mesas que reclaman atención: un aviso sin resolver, o alguien que escaneó
   * el QR y espera que le abran la cuenta. Las dos cosas piden lo mismo —que
   * alguien se acerque— así que el filtro "Con aviso" las trata igual.
   */
  const alertTableIds = useMemo(() => {
    const set = new Set<string>(Object.keys(requestByTableId));
    for (const s of pendingSessions) set.add(s.table_id);
    return set;
  }, [requestByTableId, pendingSessions]);

  // Los contadores miran SIEMPRE la sala entera: son el pulso del local, no del
  // filtro. Si bajaran al filtrar por espacio, la cabecera mentiría sobre cuánta
  // gente hay dentro.
  const counts = useMemo(
    () => countTables(allTables, alertTableIds),
    [allTables, alertTableIds],
  );

  /**
   * Ocupación real de la sala.
   *
   * Se cuentan comensales declarados, no sillas ocupadas: una mesa de seis con
   * dos personas no llena el local. `unknown` son las visitas que entraron por
   * QR sin declarar cuántos son; se informan aparte en vez de contarlas como
   * cero, que haría parecer el local más vacío de lo que está.
   */
  const occupancy = useMemo(() => computeOccupancy(allTables), [allTables]);

  const tables = useMemo(
    () =>
      filterTables(allTables, {
        space,
        stateFilter,
        onlyMine: onlyMine && canFilterMine,
        assignedTableIds,
        alertTableIds,
      }),
    [allTables, space, stateFilter, onlyMine, canFilterMine, assignedTableIds, alertTableIds],
  );

  // La selección se resuelve contra la sala entera, no contra lo filtrado: al
  // cambiar de espacio con una mesa abierta, el panel debe seguir mostrándola en
  // vez de cerrarse solo. Solo desaparece si la mesa deja de existir.
  const selected = useMemo(
    () => allTables.find((t) => t.id === selectedId) ?? null,
    [allTables, selectedId],
  );

  useEffect(() => {
    if (selectedId && !allTables.some((t) => t.id === selectedId)) setSelectedId(null);
  }, [allTables, selectedId]);

  const selectTable = useCallback((id: string | null) => setSelectedId(id), []);

  const handleWsMessage = useCallback(
    (msg: WsMessage) => {
      // `WsMessageType` (packages/types) aún no enumera los eventos de sala.
      const type = msg.type as string;

      // Resincronización tras (re)conectar: lo que ocurrió mientras el socket
      // estuvo caído no llega como evento, hay que volver a preguntarlo.
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
        if (!currentTableIds.has(String(payload.tableId))) return;

        setPendingSessions((prev) => {
          if (prev.some((s) => s.id === payload.sessionId)) return prev;
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
        setPendingSessions((prev) => prev.filter((s) => s.id !== payload.sessionId));
        void queryClient.invalidateQueries({ queryKey: ["tables"] });
        return;
      }

      // Mover, juntar, liberar o cambiar de estado reordena la sala entera: se
      // relee en vez de parchear el caché a mano.
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

      if (type === "service_request:acknowledged" || type === "service_request:resolved") {
        void queryClient.invalidateQueries({ queryKey: ["service-requests"] });
        return;
      }

      if (type !== "table:request_bill" && type !== "table:call_waiter") return;

      const payload = msg.payload as {
        tableId: string;
        tableNumber: number;
        customerName?: string;
      };
      void queryClient.invalidateQueries({ queryKey: ["service-requests"] });
      toast.info(
        type === "table:request_bill"
          ? `Mesa ${payload.tableNumber}: ${payload.customerName || "Cliente"} solicita la cuenta`
          : `Mesa ${payload.tableNumber}: ${payload.customerName || "Cliente"} solicita mozo`,
      );
    },
    [currentTableIds, queryClient, refetchPendingSessions],
  );

  useWebSocket(
    selectedBranchId ? [`branch:${selectedBranchId}`] : [],
    handleWsMessage,
    accessToken || undefined,
  );

  const emptyMessage =
    onlyMine && canFilterMine
      ? "No tienes mesas asignadas aquí. Quita «Solo mis mesas» para ver toda la sala."
      : stateFilter !== ALL_STATES
        ? "Ninguna mesa coincide con este filtro."
        : space === UNASSIGNED_SPACE
          ? "Todas las mesas están asignadas a un espacio."
          : canCreateLayout
            ? "No hay mesas aquí todavía. Crea la primera con «Nueva mesa»."
            : "No hay mesas aquí todavía. Pídele a un responsable que dé de alta las mesas del salón.";

  return (
    <TablesContext.Provider
      value={{
        allTables,
        tables,
        spaces,
        branchSlug,
        isLoading,
        error: (error as Error) ?? null,
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
        occupancy,
        requestByTableId,
        pendingSessions,
        canCreateLayout,
        canOperateTables,
        waiterAssignmentEnabled,
        emptyMessage,
      }}
    >
      {children}
    </TablesContext.Provider>
  );
}
