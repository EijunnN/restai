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
import { Loader2, Receipt, CheckCircle, Wallet, Check } from "lucide-react";
import { toast } from "sonner";
import { cn, formatCurrency } from "@/lib/utils";
import { useTableActiveSession, useFreeTable } from "@/hooks/use-tables";
import { useCreateItemPayment } from "@/hooks/use-payments";
import { apiFetch } from "@/lib/fetcher";

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

interface CobrarDialogProps {
  table: any | null;
  onClose: () => void;
}

export function CobrarDialog({ table, onClose }: CobrarDialogProps) {
  const open = !!table;
  const qc = useQueryClient();
  const { data, isLoading } = useTableActiveSession(table?.id ?? null);
  const itemPayment = useCreateItemPayment();
  const freeTable = useFreeTable();

  const [chargingOrderId, setChargingOrderId] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [method, setMethod] = useState("cash");
  const [received, setReceived] = useState("");
  const [tip, setTip] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);

  const session = (data as any)?.session ?? null;
  const orders: any[] = (data as any)?.orders ?? [];
  const totals = (data as any)?.totals ?? { total: 0, total_paid: 0, remaining: 0 };

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

  // Start charging an order: select all of its still-unpaid items by default.
  const startCharge = (order: any) => {
    const unpaidIds = (order.items || [])
      .filter((it: any) => !it.paid)
      .map((it: any) => it.id);
    setChargingOrderId(order.id);
    setSelectedItems(new Set(unpaidIds));
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
  const unpaidItems: any[] = chargingOrder ? chargingOrder.items.filter((i: any) => !i.paid) : [];
  const selectedUnpaid = unpaidItems.filter((i) => selectedItems.has(i.id));
  const allUnpaidSelected = unpaidItems.length > 0 && selectedUnpaid.length === unpaidItems.length;
  // Owed = exact remaining when paying everything left (no rounding leftover),
  // else the sum of the selected items' shares. Server recomputes authoritatively.
  const owed = chargingOrder
    ? allUnpaidSelected
      ? chargingOrder.remaining
      : selectedUnpaid.reduce((s, i) => s + (i.share || 0), 0)
    : 0;

  const receivedCents = received.trim() ? Math.round(parseFloat(received) * 100) : null;
  const changeAmount =
    receivedCents != null && receivedCents > owed ? receivedCents - owed : 0;
  const insufficient = receivedCents != null && receivedCents < owed;
  const canRegister = selectedUnpaid.length > 0 && owed > 0 && !insufficient;

  const submitPayment = async () => {
    if (!chargingOrder || !canRegister) return;
    setError(null);
    try {
      await itemPayment.mutateAsync({
        orderId: chargingOrder.id,
        itemIds: selectedUnpaid.map((i) => i.id),
        method,
        reference: reference || undefined,
        tip: tip ? Math.round(parseFloat(tip) * 100) : 0,
      });

      // Re-read live balance for this table.
      const refreshed: any = await apiFetch(`/api/tables/${table?.id}/active-session`);
      qc.setQueryData(["tables", table?.id, "active-session"], refreshed);

      const remaining = refreshed?.totals?.remaining ?? 0;
      const hadOrders = (refreshed?.orders?.length ?? 0) > 0;

      // Whole table settled → free it (also completes orders + loyalty/inventory).
      if (hadOrders && remaining <= 0) {
        try {
          await freeTable.mutateAsync(table?.id);
          toast.success(`Mesa ${table?.number} cobrada y liberada`);
        } catch {
          toast.success("Pago registrado");
        }
        handleClose();
        return;
      }

      toast.success("Pago registrado");
      resetForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo registrar el pago");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Cobrar — Mesa {table?.number}
          </DialogTitle>
          <DialogDescription>
            {session
              ? `Sesión de ${session.customer_name || "Cliente"}`
              : "Pedidos y cobro de la mesa"}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !session ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Esta mesa no tiene una sesión activa.
          </p>
        ) : orders.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            La mesa aún no tiene pedidos.
          </p>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => {
              const pm = paymentStatusMeta[order.payment_status] || paymentStatusMeta.unpaid;
              const isCharging = chargingOrderId === order.id;
              const orderUnpaid = (order.items || []).filter((i: any) => !i.paid);
              return (
                <div key={order.id} className="rounded-lg border bg-card">
                  <div className="flex items-start justify-between gap-2 p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-sm">#{order.order_number}</p>
                        <span className="text-[10px] rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                          {orderStatusLabels[order.status] || order.status}
                        </span>
                        <span className={cn("text-[10px] rounded-full px-2 py-0.5 font-medium", pm.className)}>
                          {pm.label}
                        </span>
                      </div>
                      {/* Items — paid ones shown done, the rest selectable while charging */}
                      <ul className="mt-2 space-y-1">
                        {order.items.map((it: any) => {
                          const checked = selectedItems.has(it.id);
                          const selectable = isCharging && !it.paid;
                          return (
                            <li key={it.id}>
                              <button
                                type="button"
                                disabled={!selectable}
                                onClick={() => selectable && toggleItem(it.id)}
                                className={cn(
                                  "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs",
                                  selectable && "hover:bg-muted/60",
                                  it.paid && "opacity-60",
                                )}
                              >
                                {it.paid ? (
                                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-green-600 dark:text-green-400">
                                    <CheckCircle className="h-3.5 w-3.5" />
                                  </span>
                                ) : isCharging ? (
                                  <span
                                    className={cn(
                                      "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                                      checked
                                        ? "border-primary bg-primary text-primary-foreground"
                                        : "border-muted-foreground/40",
                                    )}
                                  >
                                    {checked && <Check className="h-3 w-3" />}
                                  </span>
                                ) : (
                                  <span className="h-4 w-4 shrink-0" />
                                )}
                                <span className={cn("flex-1", it.paid && "line-through")}>
                                  {it.quantity}x {it.name}
                                </span>
                                <span className="shrink-0 text-muted-foreground">
                                  {formatCurrency(it.share ?? 0)}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold text-sm">{formatCurrency(order.total)}</p>
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
                          <CheckCircle className="h-3 w-3" /> Pagado
                        </span>
                      )}
                    </div>
                  </div>

                  {orderUnpaid.length > 0 && !isCharging && (
                    <div className="border-t px-3 py-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        onClick={() => startCharge(order)}
                      >
                        <Receipt className="h-4 w-4 mr-2" />
                        Cobrar
                      </Button>
                    </div>
                  )}

                  {isCharging && (
                    <div className="border-t p-3 space-y-3 bg-muted/30">
                      <p className="text-xs text-muted-foreground">
                        Marca los productos que paga este cliente.
                      </p>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">A cobrar (selección)</span>
                        <span className="font-bold">{formatCurrency(owed)}</span>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Método de pago</Label>
                        <Select value={method} onValueChange={setMethod}>
                          <SelectTrigger>
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
                            type="number"
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
                            type="number"
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
                        <p className="text-xs text-amber-600 dark:text-amber-400">
                          El monto recibido es menor a lo seleccionado.
                        </p>
                      )}
                      <div className="space-y-1.5">
                        <Label htmlFor={`ref-${order.id}`}>Referencia</Label>
                        <Input
                          id={`ref-${order.id}`}
                          placeholder="N° de operación, etc."
                          value={reference}
                          onChange={(e) => setReference(e.target.value)}
                        />
                      </div>
                      {error && <p className="text-sm text-destructive">{error}</p>}
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          className="flex-1"
                          onClick={resetForm}
                          disabled={itemPayment.isPending}
                        >
                          Cancelar
                        </Button>
                        <Button
                          className="flex-1"
                          onClick={submitPayment}
                          disabled={itemPayment.isPending || !canRegister}
                        >
                          {itemPayment.isPending ? "Registrando..." : `Cobrar ${formatCurrency(owed)}`}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Totals */}
            <div className="rounded-lg border bg-muted/40 p-3 space-y-1 text-sm">
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
              <div className="flex justify-between font-bold border-t pt-1">
                <span>Pendiente</span>
                <span className={totals.remaining > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}>
                  {formatCurrency(totals.remaining)}
                </span>
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground text-center">
              Al saldar el total (pendiente en S/ 0), la mesa se libera
              automáticamente y los pedidos se completan.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
