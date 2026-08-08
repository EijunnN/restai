"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch, ApiError } from "@/lib/fetcher";

/** Mesa tal como la devuelve `GET /api/tables`. El dinero nunca vive aquí. */
/**
 * Resumen de la visita viva de una mesa (lo agrega `GET /api/tables`).
 *
 * Todos los importes en CÉNTIMOS enteros. Llega ya calculado por el servidor
 * para que el plano no tenga que pedir la cuenta mesa por mesa.
 */
export interface TableSessionSummary {
  session_id: string;
  customer_name: string;
  status: "active" | "pending";
  started_at: string;
  /** Comensales declarados por el mozo. NULO = nadie lo dijo, no es cero. */
  guest_count: number | null;
  elapsed_minutes: number;
  order_count: number;
  billed: number;
  paid: number;
  /** Lo que falta por cobrar, con suelo en 0. */
  remaining: number;
}

export interface TableRow {
  id: string;
  branch_id: string;
  organization_id: string;
  space_id: string | null;
  number: number;
  capacity: number;
  qr_code: string;
  /** Código corto dictable, el plan B del comensal que no puede escanear. */
  short_code: string | null;
  status: string;
  position_x: number;
  position_y: number;
  /** Silueta en el plano. Por defecto `square`, que es lo que había antes. */
  shape?: "round" | "square" | "rect" | "bar";
  /** Giro en el plano, en grados [0, 360). */
  rotation?: number;
  created_at: string;
  /**
   * Visita viva de la mesa, o `null` si no hay ninguna.
   *
   * Ojo: una mesa puede figurar `occupied` y traer `null` aquí si alguien forzó
   * el estado sin abrir cuenta. La pantalla trata ese caso como "ocupada sin
   * cuenta" en vez de inventar importes.
   */
  active_session?: TableSessionSummary | null;
}

export interface TablesResponse {
  tables: TableRow[];
  branchSlug: string;
}

/**
 * Saldo pendiente que viaja en el 409 del guard de saldo.
 *
 * Las dos rutas que lo lanzan no lo colocan en el mismo sitio:
 * `POST /tables/:id/free` lo pone en `error.pendingAmount` y
 * `PATCH /tables/sessions/:id/end` en `error.details.pendingAmount`. Leer solo
 * uno de los dos dejaba el diálogo diciendo "S/ 0.00 pendientes", que es peor
 * que no decir nada. Devuelve céntimos, o `null` si el error es de otra cosa.
 */
export function pendingAmountFromError(err: unknown): number | null {
  if (!(err instanceof ApiError) || err.code !== "TABLE_HAS_BALANCE") return null;
  const detail = err.detail as
    | { pendingAmount?: unknown; details?: { pendingAmount?: unknown } }
    | undefined;
  const raw = detail?.pendingAmount ?? detail?.details?.pendingAmount;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

/**
 * `onError` por defecto para las mutaciones cuyo único punto de uso no lo
 * define. Sin esto, crear una mesa con un número repetido o asignar un mozo que
 * ya no pertenece a la sede fallaban EN SILENCIO: el diálogo se quedaba igual y
 * el usuario concluía que la aplicación no funciona.
 *
 * No se pone en las mutaciones que ya avisan en su llamador (liberar, eliminar,
 * cambiar estado), porque react-query ejecuta ambos manejadores y saldrían dos
 * avisos por el mismo fallo.
 */
function notifyError(fallback: string) {
  return (err: unknown) => {
    toast.error(err instanceof Error && err.message ? err.message : fallback);
  };
}

// --- Spaces ---

export function useSpaces() {
  return useQuery({
    queryKey: ["spaces"],
    queryFn: () => apiFetch("/api/spaces"),
  });
}

export function useCreateSpace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; description?: string; floorNumber?: number; sortOrder?: number }) =>
      apiFetch("/api/spaces", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["spaces"] }),
    onError: notifyError("No se pudo crear el espacio"),
  });
}

export function useUpdateSpace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; name?: string; description?: string; floorNumber?: number; sortOrder?: number; isActive?: boolean }) =>
      apiFetch(`/api/spaces/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["spaces"] }),
    onError: notifyError("No se pudo guardar el espacio"),
  });
}

export function useDeleteSpace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/spaces/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["spaces"] }),
  });
}

// --- Tables ---

export function useTables(spaceId?: string) {
  return useQuery<TablesResponse>({
    queryKey: ["tables", spaceId],
    queryFn: () => {
      const params = spaceId ? `?spaceId=${spaceId}` : "";
      return apiFetch<TablesResponse>(`/api/tables${params}`);
    },
  });
}

export function useCreateTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { number: number; capacity?: number; spaceId?: string }) =>
      apiFetch("/api/tables", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tables"] }),
    onError: notifyError("No se pudo crear la mesa"),
  });
}

export function useUpdateTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; capacity?: number; spaceId?: string | null }) =>
      apiFetch(`/api/tables/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tables"] }),
    onError: notifyError("No se pudo guardar la mesa"),
  });
}

export function useDeleteTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/tables/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tables"] }),
  });
}

/**
 * Colocación de una mesa en el plano.
 *
 * Posición, forma y giro viajan juntos porque son la misma operación —dibujar
 * la sala— y comparten permiso (`tables:layout`). El arrastre, que es lo
 * frecuente, manda solo `x` e `y`.
 */
export interface TablePlacement {
  id: string;
  x: number;
  y: number;
  shape?: "round" | "square" | "rect" | "bar";
  rotation?: number;
}

export function useUpdateTablePosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, x, y, shape, rotation }: TablePlacement) =>
      apiFetch(`/api/tables/${id}/position`, {
        method: "PATCH",
        body: JSON.stringify({ x, y, shape, rotation }),
      }),
    onMutate: async ({ id, x, y, shape, rotation }: TablePlacement) => {
      // useTables stores under ["tables", spaceId] (e.g. ["tables", undefined]),
      // so use partial-match operations to hit the real cache key(s).
      await qc.cancelQueries({ queryKey: ["tables"] });
      // Snapshot every matching cache entry so we can roll back exactly.
      const previous = qc.getQueriesData({ queryKey: ["tables"] });
      qc.setQueriesData({ queryKey: ["tables"] }, (old: any) => {
        if (!old?.tables) return old;
        return {
          ...old,
          tables: old.tables.map((t: any) =>
            t.id === id
              ? {
                  ...t,
                  position_x: x,
                  position_y: y,
                  ...(shape ? { shape } : {}),
                  ...(rotation !== undefined ? { rotation } : {}),
                }
              : t,
          ),
        };
      });
      return { previous };
    },
    onError: (err, _vars, context) => {
      // Restore each snapshotted entry by its original key.
      context?.previous?.forEach(([key, data]: [readonly unknown[], unknown]) => {
        qc.setQueryData(key, data);
      });
      // Sin este aviso, la mesa volvía sola a su sitio y el usuario no tenía
      // forma de saber por qué: el caso más común es un mozo arrastrando el
      // plano sin permiso `tables:layout`, que es configuración del local.
      toast.error(
        err instanceof ApiError && err.status === 403
          ? "No tienes permiso para cambiar la distribución del salón"
          : err instanceof Error
            ? `No se pudo guardar la posición: ${err.message}`
            : "No se pudo guardar la posición de la mesa",
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["tables"] }),
  });
}

export function useUpdateTableStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiFetch(`/api/tables/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tables"] }),
  });
}

export interface FreeTableResult {
  tableId: string;
  completedOrders: number;
  /** Céntimos perdonados al forzar. 0 cuando la cuenta estaba saldada. */
  forgivenAmount: number;
}

/**
 * Libera la mesa de verdad: cierra la sesión, finaliza los pedidos abiertos y
 * la deja disponible. NO usar `useUpdateTableStatus({status:'available'})`, que
 * solo cambia la columna y deja una sesión huérfana viva.
 *
 * Si la cuenta no está saldada responde 409 TABLE_HAS_BALANCE: hay que enseñar
 * el importe y, solo a quien tenga `payments:void`, ofrecer `force: true`, que
 * perdona el saldo y queda auditado a su nombre.
 */
export function useFreeTable() {
  const qc = useQueryClient();
  return useMutation<FreeTableResult, unknown, { tableId: string; force?: boolean }>({
    mutationFn: ({ tableId, force }) =>
      apiFetch<FreeTableResult>(
        `/api/tables/${tableId}/free${force ? "?force=true" : ""}`,
        { method: "POST" },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tables"] });
      qc.invalidateQueries({ queryKey: ["sessions"] });
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["service-requests"] });
    },
  });
}

/** Línea de un pedido tal como la sirve `GET /tables/:id/active-session`. */
export interface ActiveSessionItem {
  id: string;
  order_id: string;
  name: string;
  quantity: number;
  /** Importe de la línea, en céntimos. */
  total: number;
  paid_at: string | null;
  paid: boolean;
  /** Parte del total del pedido (IGV y descuento repartidos) en céntimos. */
  share: number;
  /**
   * Estado de la línea. HOY el endpoint no lo devuelve; se lee de forma
   * opcional para que una línea anulada nunca llegue a la selección de cobro
   * (`POST /payments/items` la rechaza con 400) en cuanto el servidor lo añada.
   */
  status?: string;
}

export interface ActiveSessionOrder {
  id: string;
  order_number: string;
  status: string;
  total: number;
  subtotal: number;
  created_at: string;
  total_paid: number;
  remaining: number;
  payment_status: "unpaid" | "partial" | "paid";
  items: ActiveSessionItem[];
}

export interface ActiveSessionResponse {
  session: {
    id: string;
    customer_name: string | null;
    customer_phone: string | null;
    status: string;
    started_at: string | null;
  } | null;
  orders: ActiveSessionOrder[];
  /** Todo en céntimos. */
  totals: { total: number; total_paid: number; remaining: number };
}

// Active/pending session for a table + its orders with payment status, for the
// "cobrar desde mesa" dialog. Enabled only while a tableId is provided.
export function useTableActiveSession(tableId: string | null) {
  return useQuery<ActiveSessionResponse>({
    queryKey: ["tables", tableId, "active-session"],
    queryFn: () => apiFetch<ActiveSessionResponse>(`/api/tables/${tableId}/active-session`),
    enabled: !!tableId,
  });
}

// --- Sentar cliente / mover / juntar ---

export interface SeatCustomerResult {
  session: { id: string; table_id: string; customer_name: string | null; status: string };
  token: string;
}

/**
 * Alta asistida: el mozo sienta a un comensal que no escanea el QR.
 *
 * Es lo que debe hacer "Ocupar mesa". Cambiar solo `tables.status` a `occupied`
 * dejaba la mesa sin cuenta: no se le podía cobrar nada desde la mesa y
 * cualquiera podía abrir su QR y sentarse encima.
 */
export function useSeatCustomer() {
  const qc = useQueryClient();
  return useMutation<
    SeatCustomerResult,
    unknown,
    {
      tableId: string;
      customerName: string;
      customerPhone?: string;
      /** Comensales sentados. Se omite cuando el mozo no los declaró. */
      guests?: number;
    }
  >({
    mutationFn: (data) =>
      apiFetch<SeatCustomerResult>("/api/tables/sessions", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tables"] });
      qc.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}

export interface MoveSessionResult {
  sessionId: string;
  /** Token de comensal RENOVADO: el anterior deja de valer en el acto. */
  token: string;
  movedOrders: number;
  source: { id: string; number: number };
  target: { id: string; number: number };
}

/** Mueve la cuenta abierta de una mesa a otra libre ("los de la 5 se pasan a la 8"). */
export function useMoveSession() {
  const qc = useQueryClient();
  return useMutation<MoveSessionResult, unknown, { tableId: string; targetTableId: string }>({
    mutationFn: ({ tableId, targetTableId }) =>
      apiFetch<MoveSessionResult>(`/api/tables/${tableId}/session/move`, {
        method: "POST",
        body: JSON.stringify({ targetTableId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tables"] });
      qc.invalidateQueries({ queryKey: ["sessions"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}

export interface MergeSessionsResult {
  targetSessionId: string;
  target: { id: string; number: number };
  merged: Array<{ tableId: string; tableNumber: number; sessionId: string; movedOrders: number }>;
  totalOrders: number;
}

/** Junta las cuentas de varias mesas en la de destino. No recalcula importes. */
export function useMergeSessions() {
  const qc = useQueryClient();
  return useMutation<MergeSessionsResult, unknown, { tableId: string; sourceTableIds: string[] }>({
    mutationFn: ({ tableId, sourceTableIds }) =>
      apiFetch<MergeSessionsResult>(`/api/tables/${tableId}/session/merge`, {
        method: "POST",
        body: JSON.stringify({ sourceTableIds }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tables"] });
      qc.invalidateQueries({ queryKey: ["sessions"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}

// --- Sessions ---

export function useSessions(status?: string) {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  const qs = params.toString();
  return useQuery({
    queryKey: ["sessions", status],
    queryFn: () => apiFetch(`/api/tables/sessions${qs ? `?${qs}` : ""}`),
  });
}

// --- Pending Sessions ---

export function usePendingSessions() {
  return useQuery({
    queryKey: ["tables", "sessions", "pending"],
    queryFn: () => apiFetch("/api/tables/sessions/pending"),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnReconnect: true,
  });
}

export function useApproveSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/tables/sessions/${id}/approve`, { method: "PATCH" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tables"] });
      qc.invalidateQueries({ queryKey: ["sessions"] });
      qc.invalidateQueries({ queryKey: ["tables", "sessions", "pending"] });
    },
  });
}

export function useRejectSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/tables/sessions/${id}/reject`, { method: "PATCH" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tables"] });
      qc.invalidateQueries({ queryKey: ["sessions"] });
      qc.invalidateQueries({ queryKey: ["tables", "sessions", "pending"] });
    },
  });
}

/**
 * Termina una sesión activa. Igual que liberar la mesa, responde 409
 * TABLE_HAS_BALANCE si la cuenta no está saldada; `force` exige `payments:void`
 * y queda auditado.
 */
export function useEndSession() {
  const qc = useQueryClient();
  return useMutation<unknown, unknown, { id: string; force?: boolean }>({
    mutationFn: ({ id, force }) =>
      apiFetch(`/api/tables/sessions/${id}/end${force ? "?force=true" : ""}`, {
        method: "PATCH",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tables"] });
      qc.invalidateQueries({ queryKey: ["sessions"] });
      qc.invalidateQueries({ queryKey: ["tables", "sessions", "pending"] });
      qc.invalidateQueries({ queryKey: ["service-requests"] });
    },
  });
}

// --- Table History ---

export function useTableHistory(tableId: string | null, from?: string, to?: string) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  return useQuery({
    queryKey: ["tables", tableId, "history", from, to],
    queryFn: () => apiFetch(`/api/tables/${tableId}/history${qs ? `?${qs}` : ""}`),
    enabled: !!tableId,
  });
}

// --- Table Assignments ---

export function useTableAssignments(tableId: string | null) {
  return useQuery({
    queryKey: ["tables", tableId, "assignments"],
    queryFn: () => apiFetch(`/api/tables/${tableId}/assignments`),
    enabled: !!tableId,
  });
}

export function useAssignWaiter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tableId, userId }: { tableId: string; userId: string }) =>
      apiFetch(`/api/tables/${tableId}/assignments`, {
        method: "POST",
        body: JSON.stringify({ userId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tables"] });
    },
    onError: notifyError("No se pudo asignar el mozo"),
  });
}

export function useRemoveAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tableId, userId }: { tableId: string; userId: string }) =>
      apiFetch(`/api/tables/${tableId}/assignments/${userId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tables"] });
    },
    onError: notifyError("No se pudo quitar la asignación"),
  });
}

/** Mesas asignadas al usuario actual. Alimenta el filtro "Solo mis mesas". */
export function useMyAssignedTables(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["tables", "my-assignments"],
    queryFn: () => apiFetch<{ table_id: string; table_number: number }[]>("/api/tables/my-assignments"),
    enabled: options?.enabled ?? true,
  });
}


// --- Mobiliario del plano ---

/**
 * Elemento fijo de la sala: cocina, barra, escalera, baños, entrada.
 *
 * No es una mesa: no se ocupa, no se cobra y no tiene QR. Es lo que hace que el
 * plano se parezca al local y no a un diagrama de rectángulos.
 */
export interface SpaceFixture {
  id: string;
  space_id: string;
  kind: "kitchen" | "bar" | "stairs" | "restroom" | "entrance" | "wall" | "plant" | "other";
  label: string | null;
  position_x: number;
  position_y: number;
  width: number;
  height: number;
  rotation: number;
}

export function useSpaceFixtures(spaceId?: string | null) {
  return useQuery<SpaceFixture[]>({
    queryKey: ["space-fixtures", spaceId ?? "all"],
    queryFn: () =>
      apiFetch<SpaceFixture[]>(
        spaceId ? `/api/spaces/fixtures?spaceId=${spaceId}` : "/api/spaces/fixtures",
      ),
    // El mobiliario se coloca una vez y se mira siempre: no tiene sentido
    // volver a pedirlo con cada refresco de la sala.
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateFixture() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      spaceId: string;
      kind: SpaceFixture["kind"];
      label?: string;
      x: number;
      y: number;
      width: number;
      height: number;
      rotation?: number;
    }) =>
      apiFetch<SpaceFixture>("/api/spaces/fixtures", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["space-fixtures"] }),
    onError: notifyError("No se pudo añadir el elemento al plano"),
  });
}

export function useUpdateFixture() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      kind?: SpaceFixture["kind"];
      label?: string;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      rotation?: number;
    }) =>
      apiFetch<SpaceFixture>(`/api/spaces/fixtures/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    // Se mueve arrastrando, así que el caché se actualiza al vuelo para que el
    // elemento no vuelva de un salto a su sitio anterior.
    onMutate: async ({ id, x, y }) => {
      await qc.cancelQueries({ queryKey: ["space-fixtures"] });
      const previous = qc.getQueriesData({ queryKey: ["space-fixtures"] });
      if (x !== undefined || y !== undefined) {
        qc.setQueriesData({ queryKey: ["space-fixtures"] }, (old: any) => {
          if (!Array.isArray(old)) return old;
          return old.map((f: SpaceFixture) =>
            f.id === id
              ? {
                  ...f,
                  ...(x !== undefined ? { position_x: x } : {}),
                  ...(y !== undefined ? { position_y: y } : {}),
                }
              : f,
          );
        });
      }
      return { previous };
    },
    onError: (err, _vars, context: any) => {
      context?.previous?.forEach(([key, data]: [readonly unknown[], unknown]) => {
        qc.setQueryData(key, data);
      });
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "No se pudo mover el elemento del plano",
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["space-fixtures"] }),
  });
}

export function useDeleteFixture() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/spaces/fixtures/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["space-fixtures"] }),
    onError: notifyError("No se pudo eliminar el elemento del plano"),
  });
}
