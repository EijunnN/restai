"use client";

import { use, useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@restai/ui/components/card";
import { Button } from "@restai/ui/components/button";
import { useCustomerStore } from "@/stores/customer-store";
import { cn, formatCurrency } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@restai/ui/components/dialog";
import {
  Clock,
  CheckCircle,
  ChefHat,
  UtensilsCrossed,
  RefreshCcw,
  Loader2,
  Receipt,
  Bell,
  XCircle,
  Star,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";

interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  status: string;
}

interface OrderData {
  id: string;
  order_number: string;
  status: string;
  items: OrderItem[];
  created_at: string;
  subtotal?: number;
  tax?: number;
  discount?: number;
  total?: number;
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
  cancelled: "Cancelado",
};

const itemStatusVariants: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20",
  preparing: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/20",
  ready: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/20",
  served: "bg-muted text-muted-foreground border-border",
  cancelled: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20",
};

export default function OrderStatusPage({
  params,
}: {
  params: Promise<{ branchSlug: string; tableCode: string }>;
}) {
  const { branchSlug, tableCode } = use(params);

  const storeOrderId = useCustomerStore((s) => s.orderId);
  const storeToken = useCustomerStore((s) => s.token);

  const [order, setOrder] = useState<OrderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const getToken = useCallback(() => {
    if (storeToken) return storeToken;
    if (typeof window !== "undefined") {
      return sessionStorage.getItem("customer_token");
    }
    return null;
  }, [storeToken]);

  const getOrderId = useCallback(() => {
    if (storeOrderId) return storeOrderId;
    if (typeof window !== "undefined") {
      return sessionStorage.getItem("customer_order_id");
    }
    return null;
  }, [storeOrderId]);

  const getSessionId = useCallback(() => {
    const storeSessionId = useCustomerStore.getState().sessionId;
    if (storeSessionId) return storeSessionId;
    if (typeof window !== "undefined") return sessionStorage.getItem("customer_session_id");
    return null;
  }, []);

  const handleTableAction = useCallback(async (action: "request_bill" | "call_waiter") => {
    const token = getToken();
    const sessionId = getSessionId();
    if (!token || !sessionId) return;
    try {
      setActionLoading(action);
      await fetch("http://localhost:3001/api/customer/table-action", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action, tableSessionId: sessionId }),
      });
    } catch {
      // silently fail
    } finally {
      setActionLoading(null);
    }
  }, [getToken, getSessionId]);

  const fetchOrder = useCallback(async () => {
    const orderId = getOrderId();
    const token = getToken();

    if (!orderId || !token) {
      setError("No se encontro la orden. Intenta realizar un nuevo pedido.");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(
        `http://localhost:3001/api/customer/orders/${orderId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const result = await res.json();
      if (!result.success) {
        throw new Error(result.error?.message || "Error al obtener la orden");
      }
      setOrder(result.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado");
    } finally {
      setLoading(false);
    }
  }, [getOrderId, getToken]);

  const handleCancelOrder = useCallback(async () => {
    const orderId = getOrderId();
    const token = getToken();
    if (!orderId || !token) return;

    try {
      setCancelling(true);
      const res = await fetch(
        `http://localhost:3001/api/customer/orders/${orderId}/cancel`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        },
      );
      const result = await res.json();
      if (!result.success) {
        setError(result.error?.message || "No se pudo cancelar el pedido");
        return;
      }
      await fetchOrder();
    } catch {
      setError("Error al cancelar el pedido");
    } finally {
      setCancelling(false);
      setCancelDialogOpen(false);
    }
  }, [getOrderId, getToken, fetchOrder]);

  useEffect(() => {
    fetchOrder();
  }, [fetchOrder]);

  // Show confirmation banner on first load if order is new
  useEffect(() => {
    if (order && order.status === "pending" && !showConfirmation) {
      setShowConfirmation(true);
      const timer = setTimeout(() => setShowConfirmation(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [order?.id]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Cargando tu pedido...</p>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="p-6 mt-12 text-center">
        <p className="text-destructive font-medium mb-4">{error || "Orden no encontrada"}</p>
        <Link href={`/${branchSlug}/${tableCode}/menu`}>
          <Button variant="outline">Volver al Menu</Button>
        </Link>
      </div>
    );
  }

  const currentStep = stepIndex[order.status] ?? 0;
  const isCancelled = order.status === "cancelled";
  // Only allow cancel when the ORDER itself is pending (not just item-level)
  const canCancel = order.status === "pending";

  return (
    <div className="p-4 space-y-5">
      {/* Confirmation banner */}
      {showConfirmation && (
        <div className="rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-4 text-center animate-in fade-in slide-in-from-top-2 duration-300">
          <CheckCircle className="h-8 w-8 text-green-600 dark:text-green-400 mx-auto mb-2" />
          <p className="font-semibold text-green-800 dark:text-green-300">Pedido recibido</p>
          <p className="text-sm text-green-600 dark:text-green-400">Tu orden fue enviada a cocina</p>
        </div>
      )}

      {/* Header */}
      <div className="text-center pt-2">
        <h1 className="text-2xl font-bold">Tu Pedido</h1>
        <p className="text-muted-foreground mt-1">Orden #{order.order_number}</p>
      </div>

      {/* Cancelled banner */}
      {isCancelled ? (
        <Card>
          <CardContent className="p-5 text-center">
            <XCircle className="h-12 w-12 text-red-500 mx-auto mb-3" />
            <p className="font-semibold text-lg text-red-600 dark:text-red-400">Pedido Cancelado</p>
            <p className="text-sm text-muted-foreground mt-1">Este pedido ha sido cancelado</p>
          </CardContent>
        </Card>
      ) : (
        /* Stepper */
        <Card>
          <CardContent className="p-5">
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
                          "flex items-center justify-center h-10 w-10 rounded-full shrink-0 transition-all",
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
                            "font-medium text-sm",
                            isCompleted ? "text-foreground" : "text-muted-foreground",
                          )}
                        >
                          {step.label}
                        </p>
                        {isCurrent && (
                          <p className="text-xs text-primary font-medium mt-0.5">
                            Estado actual
                          </p>
                        )}
                      </div>
                      {isCompleted && (
                        <CheckCircle className="h-5 w-5 text-primary shrink-0" />
                      )}
                    </div>
                    {!isLast && (
                      <div className="ml-5 w-px h-3 bg-border" />
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Items */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Detalle del Pedido</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {order.items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/30"
            >
              <p className="font-medium text-sm">
                {item.quantity}x {item.name}
              </p>
              <span
                className={cn(
                  "text-xs px-2.5 py-1 rounded-full font-medium border",
                  itemStatusVariants[item.status] || "bg-muted text-muted-foreground border-border",
                )}
              >
                {itemStatusLabels[item.status] || item.status}
              </span>
            </div>
          ))}

          {/* Order total summary */}
          {order.total != null && (
            <div className="pt-3 mt-2 border-t border-border space-y-1">
              {order.subtotal != null && (
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Subtotal</span>
                  <span>{formatCurrency(order.subtotal)}</span>
                </div>
              )}
              {order.tax != null && order.tax > 0 && (
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>IGV</span>
                  <span>{formatCurrency(order.tax)}</span>
                </div>
              )}
              {order.discount != null && order.discount > 0 && (
                <div className="flex justify-between text-sm text-green-600 dark:text-green-400">
                  <span>Descuento</span>
                  <span>-{formatCurrency(order.discount)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-sm pt-1">
                <span>Total</span>
                <span>{formatCurrency(order.total)}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Loyalty profile link */}
      <Link href={`/${branchSlug}/${tableCode}/profile`}>
        <Card className="border-primary/20 bg-primary/5 hover:bg-primary/10 transition-colors cursor-pointer">
          <CardContent className="p-4 flex items-center gap-3">
            <Star className="h-5 w-5 text-primary shrink-0" />
            <p className="text-sm font-medium flex-1">Ver mis puntos y recompensas</p>
            <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
          </CardContent>
        </Card>
      </Link>

      {/* Cancel button - only when order status is pending */}
      {canCancel && (
        <Button
          variant="destructive"
          className="w-full gap-2"
          disabled={cancelling}
          onClick={() => setCancelDialogOpen(true)}
        >
          <XCircle className="h-4 w-4" />
          Cancelar Pedido
        </Button>
      )}

      {/* Actions */}
      {!isCancelled && (
        <div className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1"
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true);
              await fetchOrder();
              setRefreshing(false);
            }}
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCcw className="h-4 w-4 mr-2" />
            )}
            {refreshing ? "Actualizando..." : "Actualizar"}
          </Button>
          <Link href={`/${branchSlug}/${tableCode}/menu`} className="flex-1">
            <Button variant="default" className="w-full">
              Pedir Mas
            </Button>
          </Link>
        </div>
      )}

      {/* Table action buttons */}
      {!isCancelled && (
        <div className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1 gap-2"
            disabled={actionLoading !== null}
            onClick={() => handleTableAction("request_bill")}
          >
            <Receipt className="h-4 w-4" />
            {actionLoading === "request_bill" ? "Enviando..." : "Pedir la Cuenta"}
          </Button>
          <Button
            variant="outline"
            className="flex-1 gap-2"
            disabled={actionLoading !== null}
            onClick={() => handleTableAction("call_waiter")}
          >
            <Bell className="h-4 w-4" />
            {actionLoading === "call_waiter" ? "Enviando..." : "Llamar al Mozo"}
          </Button>
        </div>
      )}

      {/* Back to menu after cancellation */}
      {isCancelled && (
        <Link href={`/${branchSlug}/${tableCode}/menu`}>
          <Button variant="default" className="w-full">
            Volver al Menu
          </Button>
        </Link>
      )}

      {/* Cancel confirmation dialog */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar Pedido</DialogTitle>
            <DialogDescription>
              Esta seguro que desea cancelar su pedido? Esta accion no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCancelDialogOpen(false)}
              disabled={cancelling}
            >
              No, mantener pedido
            </Button>
            <Button
              variant="destructive"
              onClick={handleCancelOrder}
              disabled={cancelling}
            >
              {cancelling ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Cancelando...
                </>
              ) : (
                "Si, cancelar pedido"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
