"use client";
/* eslint-disable react-hooks/todo, react-hooks/set-state-in-effect, react-doctor/no-giant-component */

import { Suspense, use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@restai/ui/components/card";
import { Button } from "@restai/ui/components/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { TableActionButtons } from "@/components/customer/table-action-buttons";
import { useCustomerStore } from "@/stores/customer-store";
import { useWebSocket } from "@/hooks/use-websocket";
import { cn, formatCurrency } from "@/lib/utils";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle,
  ChefHat,
  Clock,
  Loader2,
  Receipt,
  RefreshCcw,
  ShoppingBag,
  Star,
  UtensilsCrossed,
  XCircle,
} from "lucide-react";
import type { WsMessage } from "@restai/types";
import { toast } from "sonner";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  status: string;
}

/** Fila de GET /my-orders (todos los pedidos de la visita). */
interface VisitOrder {
  id: string;
  order_number: string;
  status: string;
  total: number | null;
  created_at: string;
  items: OrderItem[];
}

/** GET /orders/:id — añade el desglose de importes; exige sesión activa. */
interface OrderDetail extends VisitOrder {
  subtotal?: number | null;
  tax?: number | null;
  discount?: number | null;
}

interface WsOrderIdPayload {
  orderId?: string;
}

const steps = [
  { key: "pending", label: "Recibido", icon: Clock },
  { key: "confirmed", label: "Confirmado", icon: CheckCircle },
  { key: "preparing", label: "Preparando", icon: ChefHat },
  { key: "ready", label: "Listo", icon: UtensilsCrossed },
  { key: "served", label: "Servido", icon: CheckCircle },
];

const stepIndex: Record<string, number> = {
  pending: 0,
  confirmed: 1,
  preparing: 2,
  ready: 3,
  served: 4,
  completed: 4,
};

const itemStatusLabels: Record<string, string> = {
  pending: "En cola",
  preparing: "Preparando",
  ready: "Listo",
  served: "Servido",
  cancelled: "Anulado",
};

const itemStatusVariants: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20",
  preparing: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/20",
  ready: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/20",
  served: "bg-muted text-muted-foreground border-border",
  cancelled: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20",
};

const orderStatusLabels: Record<string, string> = {
  pending: "Recibido",
  confirmed: "Confirmado",
  preparing: "Preparando",
  ready: "Listo",
  served: "Servido",
  completed: "Completado",
  cancelled: "Anulado",
};

// La insignia por línea lee order_items.status, que puede ir por detrás del
// pedido. Se muestra el estado MÁS avanzado entre el de la línea y el que
// implica el pedido, para que un pedido servido no enseñe líneas "En cola".
const itemStatusRank: Record<string, number> = {
  pending: 0,
  preparing: 1,
  ready: 2,
  served: 3,
};
const orderToItemStatus: Record<string, string> = {
  pending: "pending",
  confirmed: "pending",
  preparing: "preparing",
  ready: "ready",
  served: "served",
  completed: "served",
};
function effectiveItemStatus(itemStatus: string, orderStatus: string): string {
  if (itemStatus === "cancelled" || orderStatus === "cancelled") return itemStatus;
  const derived = orderToItemStatus[orderStatus] ?? itemStatus;
  return (itemStatusRank[derived] ?? 0) > (itemStatusRank[itemStatus] ?? 0) ? derived : itemStatus;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  // Zona horaria de Lima explícita: un móvil con el reloj en otro huso (o un
  // turista) veía la hora de su pedido desplazada varias horas.
  return date.toLocaleTimeString("es-PE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Lima",
  });
}

function StatusSkeleton() {
  return (
    <div className="space-y-4 p-4" aria-busy="true">
      <div className="h-8 w-40 animate-pulse rounded bg-muted" />
      <div className="h-24 animate-pulse rounded-xl bg-muted" />
      <div className="h-40 animate-pulse rounded-xl bg-muted" />
      <div className="h-32 animate-pulse rounded-xl bg-muted" />
    </div>
  );
}

export default function OrderStatusPage({
  params,
}: {
  params: Promise<{ branchSlug: string; tableCode: string }>;
}) {
  // useSearchParams() necesita una frontera de Suspense: el pedido enlazado
  // desde el perfil llega como ?orderId=…, y sin ella la página entera se
  // renderizaría en cliente sin fallback.
  return (
    <Suspense fallback={<StatusSkeleton />}>
      <OrderStatusView params={params} />
    </Suspense>
  );
}

function OrderStatusView({
  params,
}: {
  params: Promise<{ branchSlug: string; tableCode: string }>;
}) {
  "use no memo";
  const { branchSlug, tableCode } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedOrderId = searchParams.get("orderId");

  const storeOrderId = useCustomerStore((s) => s.orderId);
  const storeToken = useCustomerStore((s) => s.token);
  const storeSessionId = useCustomerStore((s) => s.sessionId);

  const [orders, setOrders] = useState<VisitOrder[]>([]);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // NÚMERO de mesa. El segmento `tableCode` de la URL es el qr_code interno
  // ("mi-sede-T7-lx8k2a"): pintarlo tal cual daba "Mesa mi-sede-T7-lx8k2a" en la
  // cabecera. El número real solo lo sirve la carta pública.
  const [tableNumber, setTableNumber] = useState<number | null>(null);

  const getToken = useCallback(() => {
    if (storeToken) return storeToken;
    if (typeof window !== "undefined") return sessionStorage.getItem("customer_token");
    return null;
  }, [storeToken]);

  const getSessionId = useCallback(() => {
    if (storeSessionId) return storeSessionId;
    if (typeof window !== "undefined") return sessionStorage.getItem("customer_session_id");
    return null;
  }, [storeSessionId]);

  /** Todos los pedidos de la visita. Es la fuente de verdad de esta pantalla. */
  const fetchOrders = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setError("Tu sesión de mesa no está activa. Vuelve a escanear el código QR.");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/customer/my-orders`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await res.json();
      if (!result?.success) {
        throw new Error(result?.error?.message || "No pudimos cargar tus pedidos");
      }
      setOrders(Array.isArray(result.data) ? (result.data as VisitOrder[]) : []);
      setError(null);
    } catch (err) {
      // El error NO borra lo ya cargado: un corte de red de un segundo durante
      // un refresco automático hacía desaparecer la lista entera de pedidos y
      // dejaba una pantalla de error donde había información válida.
      setError(err instanceof Error ? err.message : "No pudimos cargar tus pedidos");
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  // Número de mesa desde la carta pública (no exige sesión activa). Si falla, la
  // cabecera se limita a decir "Tu visita": nunca el código interno.
  useEffect(() => {
    let cancelled = false;
    void fetch(`${API_URL}/api/customer/${branchSlug}/${tableCode}/menu`)
      .then((res) => res.json())
      .then((result) => {
        const number = result?.data?.table?.number;
        if (!cancelled && typeof number === "number") setTableNumber(number);
      })
      .catch(() => {
        // Sin número: se usa el texto neutro.
      });
    return () => {
      cancelled = true;
    };
  }, [branchSlug, tableCode]);

  // Selección: primero lo que pide la URL (enlace desde el perfil), luego el
  // último pedido de este dispositivo, y si no, el más reciente de la visita.
  useEffect(() => {
    if (orders.length === 0) {
      setSelectedId(null);
      return;
    }
    const preferred = [requestedOrderId, storeOrderId].find(
      (id) => id && orders.some((o) => o.id === id),
    );
    setSelectedId((current) => {
      if (current && orders.some((o) => o.id === current)) return current;
      return preferred ?? orders[0].id;
    });
  }, [orders, requestedOrderId, storeOrderId]);

  /**
   * Desglose de importes del pedido seleccionado. Solo lo sirve /orders/:id, que
   * exige sesión ACTIVA: si la visita ya se cerró simplemente no hay desglose y
   * se sigue mostrando el total del listado, sin romper la pantalla.
   */
  const fetchDetail = useCallback(
    async (orderId: string) => {
      const token = getToken();
      if (!token) return;
      try {
        const res = await fetch(`${API_URL}/api/customer/orders/${orderId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const result = await res.json();
        if (result?.success) {
          setDetail(result.data as OrderDetail);
          return;
        }
      } catch {
        // Sin desglose: el listado ya trae total, estado y líneas.
      }
      setDetail(null);
    },
    [getToken],
  );

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void fetchDetail(selectedId);
  }, [selectedId, fetchDetail]);

  const refreshAll = useCallback(async () => {
    await fetchOrders();
    if (selectedId) await fetchDetail(selectedId);
  }, [fetchOrders, fetchDetail, selectedId]);

  useWebSocket(
    getSessionId() ? [`session:${getSessionId()}`] : [],
    (msg: WsMessage) => {
      if (msg.type === "auth:success") {
        void refreshAll();
        return;
      }
      // `session:ended` NO se trata aquí: el layout del comensal ya lo escucha
      // globalmente, limpia la sesión y devuelve a la pantalla de entrada.
      // Duplicarlo produciría dos navegaciones en carrera.
      if (
        msg.type !== "order:new" &&
        msg.type !== "order:updated" &&
        msg.type !== "order:item_status" &&
        msg.type !== "order:cancelled"
      ) {
        return;
      }
      // Cualquier movimiento de la visita cambia el acumulado de la mesa, no
      // solo el del pedido abierto: se refresca todo.
      const payload = msg.payload as WsOrderIdPayload;
      if (payload?.orderId || msg.type === "order:new") {
        void refreshAll();
      }
    },
    getToken() || undefined,
  );

  const selected = orders.find((o) => o.id === selectedId) ?? null;

  const handleCancelOrder = useCallback(async () => {
    if (!selected) return;
    const token = getToken();
    if (!token) return;

    try {
      setCancelling(true);
      const res = await fetch(`${API_URL}/api/customer/orders/${selected.id}/cancel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      const result = await res.json();

      if (!result?.success) {
        // 409 = la cocina se adelantó mientras mirábamos la pantalla. Es un
        // resultado normal: se explica y se refresca, no se reintenta.
        const message =
          result?.error?.message || "No pudimos anular el pedido. Avisa al mozo.";
        if (result?.error?.code === "CONFLICT") {
          toast.info(message);
        } else {
          toast.error(message);
        }
        await refreshAll();
        return;
      }

      toast.success("Pedido anulado");
      await refreshAll();
    } catch {
      toast.error("No hay conexión. No pudimos anular el pedido.");
    } finally {
      setCancelling(false);
      setCancelDialogOpen(false);
    }
  }, [selected, getToken, refreshAll]);

  // Acumulado de la visita: lo que el comensal quiere saber ANTES de pedir la
  // cuenta. Los pedidos anulados no suman. Se calcula antes de cualquier retorno
  // temprano porque también se muestra al cerrarse la mesa.
  const liveOrders = orders.filter((o) => o.status !== "cancelled");
  const tableTotal = liveOrders.reduce((sum, o) => sum + (o.total ?? 0), 0);

  if (loading) return <StatusSkeleton />;

  // El error solo se apodera de la pantalla cuando NO hay nada que enseñar. Con
  // pedidos ya cargados se muestra como aviso, sin borrar la información.
  if (error && orders.length === 0) {
    return (
      <div className="space-y-4 p-6 pt-12 text-center">
        <AlertCircle className="mx-auto h-12 w-12 text-destructive" />
        <p role="alert" className="font-medium text-destructive">
          {error}
        </p>
        <div className="space-y-2">
          <Button
            className="h-11 w-full"
            onClick={() => {
              setLoading(true);
              void fetchOrders();
            }}
          >
            <RefreshCcw className="mr-2 h-4 w-4" />
            Reintentar
          </Button>
          <Button
            variant="outline"
            className="h-11 w-full"
            onClick={() => router.push(`/${branchSlug}/${tableCode}/menu`)}
          >
            Volver a la carta
          </Button>
        </div>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="space-y-4 p-6 pt-12 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-muted">
          <ShoppingBag className="h-10 w-10 text-muted-foreground" />
        </div>
        <h1 className="text-xl font-bold">Todavía no has pedido nada</h1>
        <p className="text-sm text-muted-foreground">
          Cuando envíes tu primer pedido aparecerá aquí con su estado en tiempo real.
        </p>
        <Button
          className="h-12 w-full"
          onClick={() => router.push(`/${branchSlug}/${tableCode}/menu`)}
        >
          Ver la carta
        </Button>
      </div>
    );
  }

  const selectedIsCancelled = selected?.status === "cancelled";
  const canCancelSelected = selected?.status === "pending";
  const currentStep = selected ? (stepIndex[selected.status] ?? 0) : 0;

  return (
    <div className="space-y-5 p-4 pb-8">
      <div className="pt-2 text-center">
        <h1 className="text-2xl font-bold">Tus pedidos</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {tableNumber !== null ? `Mesa ${tableNumber}` : "Tu visita"} ·{" "}
          {liveOrders.length} {liveOrders.length === 1 ? "pedido" : "pedidos"}
        </p>
      </div>

      {/* Aviso de refresco fallido: la información sigue en pantalla. */}
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            <p>{error}</p>
            <p className="mt-0.5 text-xs opacity-80">
              Lo que ves puede estar desactualizado.
            </p>
            <Button variant="outline" className="mt-2 h-10" onClick={() => void refreshAll()}>
              Reintentar
            </Button>
          </div>
        </div>
      )}

      {/* Acumulado de la mesa */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex items-center gap-4 p-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <Receipt className="h-6 w-6 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">Total acumulado de la mesa</p>
            <p className="text-2xl font-bold tabular-nums text-primary">
              {formatCurrency(tableTotal)}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Listado de todos los pedidos de la visita */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Pedidos de esta visita</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {orders.map((order) => {
            const isSelected = order.id === selectedId;
            const liveItems = order.items.filter((i) => i.status !== "cancelled");
            return (
              <button
                key={order.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => setSelectedId(order.id)}
                className={cn(
                  "flex min-h-12 w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors",
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "border-border bg-muted/30 hover:bg-muted/50",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">#{order.order_number}</span>
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                        itemStatusVariants[orderToItemStatus[order.status] ?? "pending"] ??
                          "border-border bg-muted text-muted-foreground",
                        order.status === "cancelled" && itemStatusVariants.cancelled,
                      )}
                    >
                      {orderStatusLabels[order.status] ?? order.status}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatTime(order.created_at)} · {liveItems.length}{" "}
                    {liveItems.length === 1 ? "producto" : "productos"}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 text-sm font-semibold tabular-nums",
                    order.status === "cancelled" && "text-muted-foreground line-through",
                  )}
                >
                  {formatCurrency(order.total ?? 0)}
                </span>
              </button>
            );
          })}
        </CardContent>
      </Card>

      {selected && (
        <>
          {/* Seguimiento del pedido seleccionado */}
          {selectedIsCancelled ? (
            <Card>
              <CardContent className="p-5 text-center">
                <XCircle className="mx-auto mb-3 h-12 w-12 text-red-500" />
                <p className="text-lg font-semibold text-red-600 dark:text-red-400">
                  Pedido #{selected.order_number} anulado
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Este pedido no se preparará y no suma al total de la mesa.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  Pedido #{selected.order_number}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-5 pt-0">
                <div className="space-y-1">
                  {steps.map((step, index) => {
                    const isCompleted = index <= currentStep;
                    const isCurrent = index === currentStep;
                    const isLast = index === steps.length - 1;
                    return (
                      <div key={step.key}>
                        <div className="flex items-center gap-4 py-2">
                          <div
                            className={cn(
                              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all",
                              isCurrent
                                ? "bg-primary text-primary-foreground ring-4 ring-primary/20"
                                : isCompleted
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-muted text-muted-foreground",
                            )}
                          >
                            <step.icon className="h-5 w-5" />
                          </div>
                          <div className="flex-1">
                            <p
                              className={cn(
                                "text-sm font-medium",
                                isCompleted ? "text-foreground" : "text-muted-foreground",
                              )}
                            >
                              {step.label}
                            </p>
                            {isCurrent && (
                              <p className="mt-0.5 text-xs font-medium text-primary">
                                Estado actual
                              </p>
                            )}
                          </div>
                          {isCompleted && (
                            <CheckCircle className="h-5 w-5 shrink-0 text-primary" />
                          )}
                        </div>
                        {!isLast && <div className="ml-5 h-3 w-px bg-border" />}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Detalle del pedido seleccionado */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Detalle del pedido #{selected.order_number}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {selected.items.map((item) => {
                const displayStatus = effectiveItemStatus(item.status, selected.status);
                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3"
                  >
                    <p
                      className={cn(
                        "min-w-0 flex-1 text-sm font-medium",
                        displayStatus === "cancelled" && "text-muted-foreground line-through",
                      )}
                    >
                      {item.quantity}x {item.name}
                    </p>
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium",
                        itemStatusVariants[displayStatus] ||
                          "border-border bg-muted text-muted-foreground",
                      )}
                    >
                      {itemStatusLabels[displayStatus] || displayStatus}
                    </span>
                  </div>
                );
              })}

              <div className="mt-2 space-y-1 border-t border-border pt-3">
                {detail?.id === selected.id && detail.subtotal != null && (
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>Subtotal</span>
                    <span className="tabular-nums">{formatCurrency(detail.subtotal)}</span>
                  </div>
                )}
                {detail?.id === selected.id && (detail.discount ?? 0) > 0 && (
                  <div className="flex justify-between text-sm text-green-600 dark:text-green-400">
                    <span>Descuento</span>
                    <span className="tabular-nums">
                      -{formatCurrency(detail.discount ?? 0)}
                    </span>
                  </div>
                )}
                {detail?.id === selected.id && (detail.tax ?? 0) > 0 && (
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>IGV</span>
                    <span className="tabular-nums">{formatCurrency(detail.tax ?? 0)}</span>
                  </div>
                )}
                <div className="flex justify-between pt-1 text-sm font-bold">
                  <span>Total del pedido</span>
                  <span className="tabular-nums">
                    {formatCurrency(selected.total ?? 0)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {canCancelSelected && (
            <Button
              variant="destructive"
              className="h-12 w-full gap-2"
              disabled={cancelling}
              onClick={() => setCancelDialogOpen(true)}
            >
              <XCircle className="h-4 w-4" />
              Anular pedido #{selected.order_number}
            </Button>
          )}
        </>
      )}

      {/* Navegación: nunca dejar al comensal encerrado en una pantalla */}
      <div className="flex gap-3">
        <Button
          variant="outline"
          className="h-12 flex-1 gap-2"
          disabled={refreshing}
          onClick={async () => {
            setRefreshing(true);
            await refreshAll();
            setRefreshing(false);
          }}
        >
          {refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCcw className="h-4 w-4" />
          )}
          {refreshing ? "Actualizando..." : "Actualizar"}
        </Button>
        <Link href={`/${branchSlug}/${tableCode}/menu`} className="flex-1">
          <Button className="h-12 w-full">Pedir más</Button>
        </Link>
      </div>

      <TableActionButtons branchSlug={branchSlug} tableCode={tableCode} />

      <Link href={`/${branchSlug}/${tableCode}/profile`} className="block">
        <Card className="cursor-pointer border-primary/20 bg-primary/5 transition-colors hover:bg-primary/10">
          <CardContent className="flex min-h-12 items-center gap-3 p-4">
            <Star className="h-5 w-5 shrink-0 text-primary" />
            <p className="flex-1 text-sm font-medium">Ver mis puntos y recompensas</p>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </CardContent>
        </Card>
      </Link>

      <ConfirmDialog
        open={cancelDialogOpen}
        onOpenChange={setCancelDialogOpen}
        title={`Anular el pedido #${selected?.order_number ?? ""}`}
        description="Solo se puede anular mientras la cocina no lo haya empezado. Si ya está en preparación, te lo diremos y tendrás que avisar al mozo."
        confirmLabel="Sí, anular pedido"
        cancelLabel="No, mantenerlo"
        loading={cancelling}
        onConfirm={handleCancelOrder}
      />
    </div>
  );
}
