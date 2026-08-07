"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { KITCHEN_BACK_TRANSITIONS } from "@restai/config";
import { useWebSocket } from "@/hooks/use-websocket";
import { useAuthStore } from "@/stores/auth-store";
import {
  esAnulacionLocal,
  useKitchenOrders,
  useKitchenZones,
  useUpdateKitchenItemStatus,
} from "@/hooks/use-kitchen";
import { useUpdateOrderStatus } from "@/hooks/use-orders";
import { usePrintKitchenTicket } from "@/components/print-ticket";
import { useKitchenAlerts } from "@/hooks/use-kitchen-alerts";
import {
  ALL_STATIONS,
  ALL_ZONES,
  buildZones,
  countHidden,
  filterOrders,
} from "./kitchen-filters";
import { toast } from "sonner";
import type { WsMessage } from "@restai/types";

// ── Time helpers ──

export function getMinutesDiff(createdAt: string): number {
  const date = new Date(createdAt);
  if (isNaN(date.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
}

export function getTimeDiff(createdAt: string): string {
  const diff = getMinutesDiff(createdAt);
  if (diff < 1) return "<1m";
  if (diff >= 60) {
    const hours = Math.floor(diff / 60);
    const mins = diff % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  return `${diff}m`;
}

// ── Meta de tiempo del pase ──

const SLA_STORAGE_KEY = "restai_kds_sla";
const DEFAULT_SLA_MINUTES = 12;
const SLA_MIN = 3;
const SLA_MAX = 45;

/** Fracción de la meta a partir de la cual una comanda entra en aviso. */
const WARN_RATIO = 2 / 3;

/** Ventana para deshacer un movimiento, en milisegundos. */
const UNDO_WINDOW_MS = 8000;

/**
 * La zona es la asignación FÍSICA de la pantalla: esta tablet cuelga de la
 * cocina de la terraza y solo debe mostrar la terraza. Por eso se guarda por
 * dispositivo y, a diferencia de la estación, NO se reinicia sola cuando la
 * zona se queda sin comandas: el cocinero no cambió de sitio porque hubiera un
 * hueco de diez minutos entre servicios.
 */
const ZONE_STORAGE_KEY = "restai_kds_zone";

/** Nombre en castellano de cada estado, para el aviso de "Deshacer". */
const ESTADO_LABEL: Record<string, string> = {
  pending: "En cola",
  preparing: "Preparando",
  ready: "Listo",
  served: "Entregado",
};

/** Hook to force re-render every 10s so timers stay accurate */
export function useTimerTick(intervalMs = 10000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}

// ── Context ──

/** Una comanda ya proyectada para pintarse: tiempos, urgencia y orden de prioridad. */
export interface KitchenCardView {
  order: any;
  /** Posición dentro de su columna, 1 = la más urgente. */
  rank: number;
  minutes: number;
  timeLabel: string;
  /** Pasó la meta de tiempo. */
  late: boolean;
  /** Va por más de dos tercios de la meta. */
  warn: boolean;
  /** Porcentaje consumido de la meta, acotado a 100. */
  pct: number;
}

interface KitchenContextValue {
  orders: any[];
  columns: { pending: any[]; preparing: any[]; ready: any[] };
  /** Las mismas columnas ya proyectadas y ordenadas por urgencia. */
  views: { pending: KitchenCardView[]; preparing: KitchenCardView[]; ready: KitchenCardView[] };
  advanceOrder: (orderId: string, currentStatus: string) => void;
  /** Devuelve una comanda al estado anterior (toque errado). */
  goBackOrder: (orderId: string, currentStatus: string) => void;
  handlePrint: (order: any) => void;
  newOrderIds: Set<string>;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
  /** Órdenes con una transición en vuelo: solo esas se bloquean. */
  pendingOrderIds: Set<string>;
  soundEnabled: boolean;
  toggleSound: () => void;
  needsSoundUnlock: boolean;
  unlockSound: () => void;

  // ── Meta de tiempo (SLA) ──
  /** Minutos objetivo para sacar una comanda. */
  sla: number;
  setSla: (minutes: number) => void;
  /** Comandas que ya pasaron la meta (sin contar las que están listas). */
  lateCount: number;

  // ── Filtro por estación ──
  /** Estaciones disponibles, derivadas de las categorías de la carta. */
  stations: { key: string; label: string; count: number }[];
  station: string;
  setStation: (key: string) => void;

  // ── Filtro por zona (espacio de la sede) ──
  /** Zonas disponibles: espacios con comandas, más "para llevar" y "sin zona". */
  zones: { key: string; label: string; count: number }[];
  zone: string;
  setZone: (key: string) => void;
  /** Comandas pintables que los filtros están escondiendo ahora mismo. */
  hiddenCount: number;

  // ── Deshacer ──
  undo: { orderId: string; from: string; label: string } | null;
  runUndo: () => void;
  dismissUndo: () => void;

  /** Hora actual "HH:MM", para la cabecera. */
  clock: string;
}

const KitchenContext = createContext<KitchenContextValue | null>(null);

export function useKitchenContext() {
  const ctx = useContext(KitchenContext);
  if (!ctx) throw new Error("useKitchenContext must be used within KitchenProvider");
  return ctx;
}

export function KitchenProvider({ children }: { children: ReactNode }) {
  useTimerTick();

  const { accessToken, selectedBranchId } = useAuthStore();
  const { data, isLoading, error, refetch } = useKitchenOrders();
  const { data: branchZones } = useKitchenZones();
  const updateItemStatus = useUpdateKitchenItemStatus();
  const updateOrderStatus = useUpdateOrderStatus();
  const printKitchenTicket = usePrintKitchenTicket();
  const { soundEnabled, toggleSound, notifyNewOrder, needsUnlock, unlockAudio } =
    useKitchenAlerts();

  // Órdenes con una transición en vuelo. Antes se usaba el `isPending` global de
  // la mutación, así que un solo toque congelaba TODOS los botones del tablero
  // durante 1-2 segundos y favorecía los toques dobles.
  const [pendingOrderIds, setPendingOrderIds] = useState<Set<string>>(new Set());

  /**
   * Meta de tiempo del pase, en minutos.
   *
   * Es la referencia contra la que se colorea cada comanda y se decide qué está
   * retrasado. Se guarda POR DISPOSITIVO: la meta de la parrilla no es la de la
   * barra, y cada pantalla la ajusta desde su cabecera sin pedirle permiso a
   * nadie ni afectar a las demás.
   */
  const [sla, setSlaState] = useState<number>(DEFAULT_SLA_MINUTES);
  useEffect(() => {
    const stored = Number(window.localStorage.getItem(SLA_STORAGE_KEY));
    if (Number.isFinite(stored) && stored >= SLA_MIN && stored <= SLA_MAX) {
      setSlaState(stored);
    }
  }, []);
  const setSla = useCallback((minutes: number) => {
    const clamped = Math.min(SLA_MAX, Math.max(SLA_MIN, Math.round(minutes)));
    setSlaState(clamped);
    window.localStorage.setItem(SLA_STORAGE_KEY, String(clamped));
  }, []);

  /** Estación activa; `all` = toda la cocina. */
  const [station, setStation] = useState<string>(ALL_STATIONS);

  /** Zona activa; `all` = toda la sede. Se recuerda entre sesiones. */
  const [zone, setZoneState] = useState<string>(ALL_ZONES);
  useEffect(() => {
    const stored = window.localStorage.getItem(ZONE_STORAGE_KEY);
    if (stored) setZoneState(stored);
  }, []);
  const setZone = useCallback((key: string) => {
    setZoneState(key);
    window.localStorage.setItem(ZONE_STORAGE_KEY, key);
  }, []);

  /** Último movimiento deshacible, con su ventana de gracia. */
  const [undo, setUndo] = useState<KitchenContextValue["undo"]>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleUndo = useCallback((next: KitchenContextValue["undo"]) => {
    setUndo(next);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    if (next) {
      undoTimerRef.current = setTimeout(() => setUndo(null), UNDO_WINDOW_MS);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  const [newOrderIds, setNewOrderIds] = useState<Set<string>>(new Set());
  const prevOrderIdsRef = useRef<Set<string>>(new Set());
  const hasLoadedOnceRef = useRef(false);

  // Comandas nuevas: destello + aviso sonoro.
  //
  // El bug anterior: cuando había comandas frescas, el efecto hacía `return` con
  // el limpiador ANTES de actualizar `prevOrderIdsRef`, así que esas comandas
  // seguían siendo "nuevas" en cada render y medio tablero parpadeaba sin parar
  // hasta que la señal dejaba de significar nada. Ahora la referencia se
  // actualiza SIEMPRE, antes de cualquier retorno.
  useEffect(() => {
    if (!data) return;
    const orders: any[] = data;
    const currentIds = new Set<string>(orders.map((o: any) => o.id));
    const prevIds = prevOrderIdsRef.current;

    const freshIds = new Set<string>();
    if (hasLoadedOnceRef.current) {
      currentIds.forEach((id) => {
        if (!prevIds.has(id)) freshIds.add(id);
      });
    }

    prevOrderIdsRef.current = currentIds;
    hasLoadedOnceRef.current = true;

    if (freshIds.size === 0) return;

    setNewOrderIds(freshIds);
    notifyNewOrder();
    const timeout = setTimeout(() => setNewOrderIds(new Set()), 2500);
    return () => clearTimeout(timeout);
  }, [data, notifyNewOrder]);

  const queryClient = useQueryClient();

  const handleWsMessage = useCallback(
    (msg: WsMessage) => {
      // `WsMessageType` (packages/types) todavía no enumera los eventos nuevos
      // de cocina, así que se compara sobre string: el canal los emite igual y
      // ignorarlos dejaba el tablero mostrando platos que ya no existen.
      const tipo = msg.type as string;

      if (
        tipo === "order:new" ||
        tipo === "order:updated" ||
        tipo === "order:item_status" ||
        tipo === "order:cancelled" ||
        tipo === "order:item_cancelled"
      ) {
        refetch();
      }

      // Un "86" hecho desde la sala o desde otra tablet es noticia para quien ya
      // está cocinando ese plato: sin aviso se sigue preparando algo que nadie
      // va a servir. El eco de la anulación propia se filtra.
      if (tipo === "order:item_cancelled") {
        const payload = msg.payload as any;
        const item = payload?.item;
        if (item?.id && !esAnulacionLocal(item.id)) {
          toast.warning(`Plato anulado: ${item.quantity}x ${item.name}`, {
            description: `Pedido #${payload?.orderNumber ?? "?"}${
              payload?.reason ? ` — ${payload.reason}` : ""
            }`,
          });
        }
      }

      // Cambió la disponibilidad de un plato: hay que releer la carta para saber
      // cuáles figuran agotados (la comanda guarda una foto, no el estado vivo).
      if (tipo === "menu:availability") {
        queryClient.invalidateQueries({ queryKey: ["kitchen", "menu-availability"] });
        queryClient.invalidateQueries({ queryKey: ["menu"] });
      }
    },
    [refetch, queryClient]
  );

  useWebSocket(
    selectedBranchId ? [`branch:${selectedBranchId}:kitchen`] : [],
    handleWsMessage,
    accessToken || undefined
  );

  const handlePrint = useCallback(
    (order: any) => {
      printKitchenTicket({
        orderNumber: order.orderNumber || order.order_number || order.id,
        // La API devuelve `table_number` (routes/kitchen.ts). Leer solo
        // tableName/table_name hacía que el papel dijera "En local" mientras la
        // pantalla decía "Mesa 5", y la comanda salía sin destino.
        tableNumber:
          order.table_number ?? order.tableNumber ?? order.tableName ?? order.table_name ?? undefined,
        orderType: order.type,
        customerName: order.customerName || order.customer_name || undefined,
        createdAt: order.createdAt || order.created_at || new Date().toISOString(),
        items: (order.items || []).map((i: any) => ({
          name: i.name,
          quantity: i.quantity,
          unit_price: i.unit_price || 0,
          total: i.total || 0,
          notes: i.notes,
          modifiers: Array.isArray(i.modifiers)
            ? i.modifiers.map((m: any) => ({ name: m.name }))
            : undefined,
        })),
        notes: order.notes,
      });
    },
    [printKitchenTicket]
  );

  const allOrders: any[] = data ?? [];

  /**
   * Estaciones = categorías de la carta presentes en el tablero.
   *
   * Se derivan de lo que hay ahora mismo en cocina, no de un catálogo fijo: una
   * cocina sin postres en marcha no necesita un botón "Postres" vacío ocupando
   * la cabecera. El contador es de comandas, no de líneas: es lo que el
   * cocinero cuenta con la vista.
   */
  const stations = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const order of allOrders) {
      const seen = new Set<string>();
      for (const item of order.items ?? []) {
        const label = item.category_name;
        if (!label || seen.has(label)) continue;
        seen.add(label);
        const entry = counts.get(label) ?? { label, count: 0 };
        entry.count += 1;
        counts.set(label, entry);
      }
    }
    return [
      { key: ALL_STATIONS, label: "Todas", count: allOrders.length },
      ...[...counts.values()]
        .sort((a, b) => a.label.localeCompare(b.label, "es"))
        .map((s) => ({ key: s.label, label: s.label, count: s.count })),
    ];
  }, [allOrders]);

  const zones = useMemo(
    () => buildZones(allOrders, zone, branchZones ?? []),
    [allOrders, zone, branchZones],
  );

  const orders = useMemo(
    () => filterOrders(allOrders, zone, station),
    [allOrders, station, zone],
  );

  const hiddenCount = useMemo(() => countHidden(allOrders, orders), [allOrders, orders]);

  // Si la estación activa se queda sin comandas al terminarse el servicio de esa
  // partida, se vuelve a "Todas" sola: si no, el cocinero se queda mirando una
  // pantalla vacía sin recordar que tenía un filtro puesto.
  useEffect(() => {
    if (station === ALL_STATIONS) return;
    if (!stations.some((s) => s.key === station)) setStation(ALL_STATIONS);
  }, [stations, station]);

  const columns = {
    pending: orders.filter((o: any) => o.status === "pending"),
    preparing: orders.filter((o: any) => o.status === "preparing"),
    ready: orders.filter((o: any) => o.status === "ready"),
  };

  /**
   * Proyecta una columna: la más urgente primero, con sus tiempos ya calculados.
   *
   * El orden es por antigüedad descendente, que es exactamente el orden en que
   * hay que cocinar. Se calcula aquí y no en la tarjeta para que el número de
   * prioridad ("01") y el orden visual no puedan discrepar.
   */
  const project = useCallback(
    (list: any[], isReadyColumn: boolean): KitchenCardView[] =>
      [...list]
        .sort((a, b) => {
          const ta = new Date(a.created_at || a.createdAt || 0).getTime();
          const tb = new Date(b.created_at || b.createdAt || 0).getTime();
          return ta - tb;
        })
        .map((order, index) => {
          const createdAt = order.created_at || order.createdAt || "";
          const minutes = createdAt ? getMinutesDiff(createdAt) : 0;
          // Lo que ya está listo no "va tarde": el reloj de cocina paró; lo que
          // falte es tiempo de sala, y pintarlo en rojo aquí sería culpar a
          // quien ya hizo su parte.
          const late = !isReadyColumn && minutes >= sla;
          const warn = !isReadyColumn && !late && minutes >= sla * WARN_RATIO;
          return {
            order,
            rank: index + 1,
            minutes,
            timeLabel: createdAt ? getTimeDiff(createdAt) : "—",
            late,
            warn,
            pct: sla > 0 ? Math.min(100, Math.round((minutes / sla) * 100)) : 0,
          };
        }),
    [sla],
  );

  const views = {
    pending: project(columns.pending, false),
    preparing: project(columns.preparing, false),
    ready: project(columns.ready, true),
  };

  const lateCount =
    views.pending.filter((v) => v.late).length + views.preparing.filter((v) => v.late).length;

  const markPending = (orderId: string, active: boolean) => {
    setPendingOrderIds((prev) => {
      const next = new Set(prev);
      if (active) next.add(orderId);
      else next.delete(orderId);
      return next;
    });
  };

  /**
   * Avanza una comanda al siguiente estado.
   *
   * Antes esta mutación no tenía `onError`: un 409 por dos pantallas de cocina
   * tocando a la vez, un 400 o la red caída dejaban el botón re-habilitado, la
   * tarjeta sin moverse y CERO explicación. El cocinero concluía que "la app no
   * funciona" y el plato se quedaba colgado en Pendiente.
   */
  const advanceOrder = (orderId: string, currentStatus: string) => {
    if (pendingOrderIds.has(orderId)) return;

    const newStatus =
      currentStatus === "pending"
        ? "preparing"
        : currentStatus === "preparing"
          ? "ready"
          : currentStatus === "ready"
            ? "served"
            : currentStatus;

    markPending(orderId, true);
    updateOrderStatus.mutate(
      { id: orderId, status: newStatus },
      {
        onSuccess: () => {
          const order = allOrders.find((o: any) => o.id === orderId);
          const num = order?.order_number ?? order?.orderNumber ?? "";
          scheduleUndo({
            orderId,
            from: currentStatus,
            label: `${num} → ${ESTADO_LABEL[newStatus] ?? newStatus}`,
          });
        },
        onError: (err: any) => {
          const code = err?.code ?? err?.error?.code;
          if (code === "CONFLICT" || err?.status === 409) {
            toast.warning("Otra pantalla ya movió esta comanda", {
              description: "Actualizamos el tablero para que veas el estado real.",
            });
          } else {
            toast.error("No se pudo actualizar la comanda", {
              description: err?.message || "Revisa la conexión e inténtalo de nuevo.",
            });
          }
          refetch();
        },
        onSettled: () => markPending(orderId, false),
      },
    );
  };

  /**
   * Devuelve una comanda al paso anterior.
   *
   * El destino sale de `KITCHEN_BACK_TRANSITIONS` (@restai/config), la MISMA
   * tabla que valida el servidor: así el botón nunca ofrece un movimiento que
   * vaya a rechazarse. Un `undefined` aquí significa que ese estado no admite
   * marcha atrás (`completed`, `cancelled`), y el botón sencillamente no existe.
   */
  const goBackOrder = (orderId: string, currentStatus: string) => {
    if (pendingOrderIds.has(orderId)) return;
    const target = KITCHEN_BACK_TRANSITIONS[currentStatus];
    if (!target) return;

    markPending(orderId, true);
    updateOrderStatus.mutate(
      { id: orderId, status: target },
      {
        onError: (err: any) => {
          const code = err?.code ?? err?.error?.code;
          if (code === "CONFLICT" || err?.status === 409) {
            toast.warning("Otra pantalla ya movió esta comanda", {
              description: "Actualizamos el tablero para que veas el estado real.",
            });
          } else {
            toast.error("No se pudo devolver la comanda", {
              description: err?.message || "Revisa la conexión e inténtalo de nuevo.",
            });
          }
          refetch();
        },
        onSettled: () => markPending(orderId, false),
      },
    );
  };

  /** Revierte el último movimiento dentro de la ventana de gracia. */
  const runUndo = () => {
    if (!undo) return;
    const { orderId, from } = undo;
    scheduleUndo(null);
    markPending(orderId, true);
    updateOrderStatus.mutate(
      { id: orderId, status: from },
      {
        onError: (err: any) => {
          toast.error("No se pudo deshacer", {
            description: err?.message || "La comanda ya siguió su curso.",
          });
          refetch();
        },
        onSettled: () => markPending(orderId, false),
      },
    );
  };

  const dismissUndo = () => scheduleUndo(null);

  // Reloj de cabecera. Se refresca con el mismo tic que los cronómetros, así que
  // no añade ningún temporizador propio.
  const nowDate = new Date();
  const clock = `${String(nowDate.getHours()).padStart(2, "0")}:${String(
    nowDate.getMinutes(),
  ).padStart(2, "0")}`;

  return (
    <KitchenContext.Provider
      value={{
        orders,
        columns,
        views,
        advanceOrder,
        goBackOrder,
        handlePrint,
        newOrderIds,
        isLoading,
        error: error as Error | null,
        refetch,
        pendingOrderIds,
        soundEnabled,
        toggleSound,
        needsSoundUnlock: needsUnlock,
        unlockSound: unlockAudio,
        sla,
        setSla,
        lateCount,
        stations,
        station,
        setStation,
        zones,
        zone,
        setZone,
        hiddenCount,
        undo,
        runUndo,
        dismissUndo,
        clock,
      }}
    >
      {children}
    </KitchenContext.Provider>
  );
}
