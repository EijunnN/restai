"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@restai/ui/components/dialog";
import { Button } from "@restai/ui/components/button";
import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@restai/ui/components/select";
import {
  Loader2,
  Receipt,
  CheckCircle,
  Wallet,
  Check,
  RefreshCw,
  Ban,
} from "lucide-react";
import { toast } from "sonner";
import { cn, formatCurrency } from "@/lib/utils";
import {
  useTableActiveSession,
  useFreeTable,
  type ActiveSessionItem,
  type ActiveSessionOrder,
  type ActiveSessionResponse,
  type TableRow,
} from "@/hooks/use-tables";
import { useCreateItemPayment } from "@/hooks/use-payments";
import { apiFetch } from "@/lib/fetcher";
import { useAuthStore } from "@/stores/auth-store";
import { hasPermission } from "@/lib/permissions";

const orderStatusLabels: Record<string, string> = {
  pending: "En cola",
  confirmed: "Confirmado",
  preparing: "Preparando",
  ready: "Listo",
  served: "Servido",
  completed: "Completado",
  cancelled: "Cancelado",
};

const paymentStatusMeta: Record<string, { label: string; className: string }> = {
  unpaid: { label: "Sin pagar", className: "bg-red-500/15 text-red-700 dark:text-red-400" },
  partial: { label: "Parcial", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  paid: { label: "Pagado", className: "bg-green-500/15 text-green-700 dark:text-green-400" },
};

/**
 * Convierte lo que teclea el cajero (soles con decimales) a CÉNTIMOS enteros,
 * que es la única unidad de dinero que viaja a la API. Devuelve `null` si el
 * campo está vacío o no es un número: sin esto, un `NaN` se colaba en el cuerpo
 * de la petición como `null` y el cobro salía sin propina y sin aviso.
 */
function toCents(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseFloat(trimmed.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

/** Una línea anulada ("86") ya no forma parte del importe: no se puede cobrar. */
function isCancelled(item: ActiveSessionItem): boolean {
  return item.status === "cancelled";
}

interface CobrarDialogProps {
  table: TableRow | null;
  onClose: () => void;
}

export function CobrarDialog({ table, onClose }: CobrarDialogProps) {
  const open = !!table;
  const qc = useQueryClient();
  const {
    data,
    isLoading,
    isError,
    error: loadError,
    refetch,
  } = useTableActiveSession(table?.id ?? null);
  const itemPayment = useCreateItemPayment();
  const freeTable = useFreeTable();
  // Liberar la mesa exige `tables:update`, que el cajero no tiene. Intentarlo
  // igualmente le pintaba un error rojo tras CADA cobro completo, como si el
  // pago hubiera fallado.
  const role = useAuthStore((state) => state.user?.role);
  const canFreeTable = hasPermission(role, "tables:update");

  const [chargingOrderId, setChargingOrderId] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [method, setMethod] = useState("cash");
  const [received, setReceived] = useState("");
  const [tip, setTip] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);

  const session = data?.session ?? null;
  const orders: ActiveSessionOrder[] = data?.orders ?? [];
  const totals = data?.totals ?? { total: 0, total_paid: 0, remaining: 0 };

  const resetForm = () => {
    setChargingOrderId(null);
    setSelectedItems(new Set());
    setMethod("cash");
    setReceived("");
    setTip("");
    setReference("");
    setError(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  /** Líneas cobrables: ni pagadas ni anuladas. */
  const chargeableItems = (order: ActiveSessionOrder): ActiveSessionItem[] =>
    (order.items ?? []).filter((it) => !it.paid && !isCancelled(it));

  // Start charging an order: select all of its still-unpaid items by default.
  const startCharge = (order: ActiveSessionOrder) => {
    setChargingOrderId(order.id);
    setSelectedItems(new Set(chargeableItems(order).map((it) => it.id)));
    setMethod("cash");
    setReceived("");
    setTip("");
    setReference("");
    setError(null);
  };

  const toggleItem = (itemId: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const chargingOrder = orders.find((o) => o.id === chargingOrderId);
  const unpaidItems = chargingOrder ? chargeableItems(chargingOrder) : [];
  const selectedUnpaid = unpaidItems.filter((i) => selectedItems.has(i.id));
  const allUnpaidSelected = unpaidItems.length > 0 && selectedUnpaid.length === unpaidItems.length;
  // Owed = exact remaining when paying everything left (no rounding leftover),
  // else the sum of the selected items' shares. Server recomputes authoritatively.
  const owed = chargingOrder
    ? allUnpaidSelected
      ? chargingOrder.remaining
      : selectedUnpaid.reduce((s, i) => s + (i.share || 0), 0)
    : 0;

  const receivedCents = toCents(received);
  const tipCents = toCents(tip) ?? 0;
  const changeAmount =
    receivedCents != null && receivedCents > owed ? receivedCents - owed : 0;
  const insufficient = receivedCents != null && receivedCents < owed;
  const canRegister = selectedUnpaid.length > 0 && owed > 0 && !insufficient;

  const submitPayment = async () => {
    if (!chargingOrder || !canRegister || !table) return;
    setError(null);
    try {
      await itemPayment.mutateAsync({
        orderId: chargingOrder.id,
        itemIds: selectedUnpaid.map((i) => i.id),
        method,
        reference: reference || undefined,
        tip: tipCents,
      });

      // Re-read live balance for this table.
      const refreshed = await apiFetch<ActiveSessionResponse>(
        `/api/tables/${table.id}/active-session`,
      );
      qc.setQueryData(["tables", table.id, "active-session"], refreshed);

      const remaining = refreshed?.totals?.remaining ?? 0;
      const hadOrders = (refreshed?.orders?.length ?? 0) > 0;

      // Mesa saldada → se libera sola (completa pedidos, puntos e inventario).
      if (hadOrders && remaining <= 0) {
        if (!canFreeTable) {
          toast.success(
            `Cuenta de la mesa ${table.number} saldada. La libera el personal de sala.`,
          );
          handleClose();
          return;
        }
        try {
          await freeTable.mutateAsync({ tableId: table.id });
          toast.success(`Mesa ${table.number} cobrada y liberada`);
        } catch (freeError) {
          // El cobro SÍ se registró: eso no se puede perder de vista. Lo único
          // que falló es liberar la mesa, y hay que decirlo o el mozo creerá
          // que la mesa quedó libre y sentará a otro cliente encima.
          toast.success("Pago registrado");
          toast.error(
            freeError instanceof Error
              ? `No se pudo liberar la mesa: ${freeError.message}`
              : "El pago se registró, pero la mesa no se pudo liberar",
          );
        }
        handleClose();
        return;
      }

      toast.success("Pago registrado");
      resetForm();
    } catch (e) {
      // Sin el aviso visible, un cobro rechazado (línea anulada, orden cerrada,
      // caja sin abrir) parecía no haber hecho nada y el cajero volvía a pulsar.
      const message = e instanceof Error ? e.message : "No se pudo registrar el pago";
      setError(message);
      toast.error(message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" aria-hidden="true" />
            Cobrar — Mesa {table?.number}
          </DialogTitle>
          <DialogDescription>
            {session
              ? `Sesión de ${session.customer_name || "Cliente"}`
              : "Pedidos y cobro de la mesa"}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3" aria-busy="true">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : isError ? (
          <div
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/50 bg-destructive/5 p-4"
            role="alert"
          >
            <p className="text-sm text-destructive">
              No se pudo cargar la cuenta de la mesa
              {loadError instanceof Error ? `: ${loadError.message}` : "."}
            </p>
            <Button variant="outline" className="h-10" onClick={() => refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
              Reintentar
            </Button>
          </div>
        ) : !session ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Esta mesa no tiene una cuenta abierta. Usa «Sentar» para abrirle una al
            cliente.
          </p>
        ) : orders.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            La mesa aún no tiene pedidos.
          </p>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => {
              const pm = paymentStatusMeta[order.payment_status] || paymentStatusMeta.unpaid!;
              const isCharging = chargingOrderId === order.id;
              const orderUnpaid = chargeableItems(order);
              return (
                <div key={order.id} className="rounded-lg border bg-card">
                  <div className="flex items-start justify-between gap-2 p-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold">#{order.order_number}</p>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                          {orderStatusLabels[order.status] || order.status}
                        </span>
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", pm.className)}>
                          {pm.label}
                        </span>
                      </div>
                      {/* Líneas: las pagadas y las anuladas quedan fuera del cobro */}
                      <ul className="mt-2 space-y-1">
                        {order.items.map((it) => {
                          const cancelled = isCancelled(it);
                          const checked = selectedItems.has(it.id);
                          const selectable = isCharging && !it.paid && !cancelled;
                          return (
                            <li key={it.id}>
                              <button
                                type="button"
                                disabled={!selectable}
                                aria-pressed={selectable ? checked : undefined}
                                onClick={() => selectable && toggleItem(it.id)}
                                className={cn(
                                  "flex min-h-10 w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm",
                                  selectable && "hover:bg-muted/60",
                                  (it.paid || cancelled) && "opacity-60",
                                )}
                              >
                                {cancelled ? (
                                  <span className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
                                    <Ban className="h-4 w-4" aria-hidden="true" />
                                  </span>
                                ) : it.paid ? (
                                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-green-600 dark:text-green-400">
                                    <CheckCircle className="h-4 w-4" aria-hidden="true" />
                                  </span>
                                ) : isCharging ? (
                                  <span
                                    className={cn(
                                      "flex h-5 w-5 shrink-0 items-center justify-center rounded border",
                                      checked
                                        ? "border-primary bg-primary text-primary-foreground"
                                        : "border-muted-foreground/40",
                                    )}
                                  >
                                    {checked && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                                  </span>
                                ) : (
                                  <span className="h-5 w-5 shrink-0" />
                                )}
                                <span
                                  className={cn(
                                    "flex-1",
                                    (it.paid || cancelled) && "line-through",
                                  )}
                                >
                                  {it.quantity}x {it.name}
                                  {cancelled && (
                                    <span className="ml-1 text-xs text-muted-foreground">
                                      (anulado)
                                    </span>
                                  )}
                                </span>
                                <span className="shrink-0 text-muted-foreground">
                                  {formatCurrency(cancelled ? 0 : (it.share ?? 0))}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-bold">{formatCurrency(order.total)}</p>
                      {order.total_paid > 0 && order.remaining > 0 && (
                        <p className="text-[11px] text-muted-foreground">
                          Pagado {formatCurrency(order.total_paid)}
                        </p>
                      )}
                      {order.remaining > 0 ? (
                        <p className="text-[11px] text-red-600 dark:text-red-400">
                          Falta {formatCurrency(order.remaining)}
                        </p>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] text-green-600 dark:text-green-400">
                          <CheckCircle className="h-3 w-3" aria-hidden="true" /> Pagado
                        </span>
                      )}
                    </div>
                  </div>

                  {orderUnpaid.length > 0 && !isCharging && (
                    <div className="border-t px-3 py-2">
                      <Button
                        variant="outline"
                        className="h-10 w-full"
                        onClick={() => startCharge(order)}
                      >
                        <Receipt className="mr-2 h-4 w-4" aria-hidden="true" />
                        Cobrar este pedido
                      </Button>
                    </div>
                  )}

                  {isCharging && (
                    <div className="space-y-3 border-t bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground">
                        Marca los productos que paga este cliente.
                      </p>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">A cobrar (selección)</span>
                        <span className="font-bold">{formatCurrency(owed)}</span>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`method-${order.id}`}>Método de pago</Label>
                        <Select value={method} onValueChange={setMethod}>
                          <SelectTrigger id={`method-${order.id}`} className="h-10">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="cash">Efectivo</SelectItem>
                            <SelectItem value="card">Tarjeta</SelectItem>
                            <SelectItem value="yape">Yape</SelectItem>
                            <SelectItem value="plin">Plin</SelectItem>
                            <SelectItem value="transfer">Transferencia</SelectItem>
                            <SelectItem value="other">Otro</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label htmlFor={`rec-${order.id}`}>Monto recibido (S/)</Label>
                          <Input
                            id={`rec-${order.id}`}
                            className="h-10"
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            value={received}
                            onChange={(e) => setReceived(e.target.value)}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`tip-${order.id}`}>Propina (S/)</Label>
                          <Input
                            id={`tip-${order.id}`}
                            className="h-10"
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            value={tip}
                            onChange={(e) => setTip(e.target.value)}
                          />
                        </div>
                      </div>
                      {changeAmount > 0 && (
                        <p className="text-sm font-medium text-green-600 dark:text-green-400">
                          Vuelto: {formatCurrency(changeAmount)}
                        </p>
                      )}
                      {insufficient && (
                        <p className="text-xs text-amber-600 dark:text-amber-400" role="alert">
                          El monto recibido es menor que lo seleccionado.
                        </p>
                      )}
                      <div className="space-y-1.5">
                        <Label htmlFor={`ref-${order.id}`}>Referencia</Label>
                        <Input
                          id={`ref-${order.id}`}
                          className="h-10"
                          placeholder="N.º de operación, etc."
                          value={reference}
                          onChange={(e) => setReference(e.target.value)}
                        />
                      </div>
                      {error && (
                        <p className="text-sm text-destructive" role="alert">
                          {error}
                        </p>
                      )}
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          className="h-10 flex-1"
                          onClick={resetForm}
                          disabled={itemPayment.isPending}
                        >
                          Cancelar
                        </Button>
                        <Button
                          className="h-10 flex-1"
                          onClick={() => void submitPayment()}
                          disabled={itemPayment.isPending || !canRegister}
                        >
                          {itemPayment.isPending && (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                          )}
                          {itemPayment.isPending ? "Registrando..." : `Cobrar ${formatCurrency(owed)}`}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Totales */}
            <div className="space-y-1 rounded-lg border bg-muted/40 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total</span>
                <span className="font-medium">{formatCurrency(totals.total)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pagado</span>
                <span className="font-medium text-green-600 dark:text-green-400">
                  {formatCurrency(totals.total_paid)}
                </span>
              </div>
              <div className="flex justify-between border-t pt-1 font-bold">
                <span>Pendiente</span>
                <span className={totals.remaining > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}>
                  {formatCurrency(totals.remaining)}
                </span>
              </div>
            </div>

            <p className="text-center text-[11px] text-muted-foreground">
              Al saldar el total (pendiente en S/ 0), la mesa se libera
              automáticamente y los pedidos se completan.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
