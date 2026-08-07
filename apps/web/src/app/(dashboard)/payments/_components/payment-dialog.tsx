"use client";

import { useState, useEffect } from "react";
import { CheckCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
import { Button } from "@restai/ui/components/button";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@restai/ui/components/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@restai/ui/components/dialog";
import {
  useCreatePayment,
  useUnpaidOrders,
  type CreatePaymentResult,
} from "@/hooks/use-payments";
import { formatCurrency } from "@/lib/utils";
import { METHOD_LABELS } from "./payment-filters";

interface PaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectedOrderId?: string;
}

/** "12,50" o "12.50" -> 1250 céntimos. Devuelve null si no es un importe. */
function parseAmountToCents(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return null;
  if (!/^\d+(\.\d{0,2})?$/.test(normalized)) return null;
  return Math.round(parseFloat(normalized) * 100);
}

/**
 * Registro manual de un cobro.
 *
 * El dinero se maneja en CÉNTIMOS enteros: el importe se teclea en soles y se
 * convierte una sola vez, al enviar.
 */
export function PaymentDialog({
  open,
  onOpenChange,
  preselectedOrderId,
}: PaymentDialogProps) {
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [method, setMethod] = useState("cash");
  const [amount, setAmount] = useState("");
  const [tip, setTip] = useState("");
  const [reference, setReference] = useState("");
  const [result, setResult] = useState<CreatePaymentResult | null>(null);

  const {
    data: unpaidOrders,
    isLoading: ordersLoading,
    error: ordersError,
    refetch: refetchOrders,
  } = useUnpaidOrders();
  const createPayment = useCreatePayment();

  const orders = unpaidOrders ?? [];
  const selectedOrder = orders.find((o) => o.id === selectedOrderId);

  // Selección previa (por ejemplo, al venir desde una orden concreta).
  useEffect(() => {
    if (open && preselectedOrderId) {
      setSelectedOrderId(preselectedOrderId);
    }
  }, [open, preselectedOrderId]);

  // Al elegir una orden se propone cobrar exactamente lo que falta.
  useEffect(() => {
    if (selectedOrder) {
      setAmount((selectedOrder.remaining / 100).toFixed(2));
    }
  }, [selectedOrder]);

  const resetState = () => {
    setSelectedOrderId("");
    setMethod("cash");
    setAmount("");
    setTip("");
    setReference("");
    setResult(null);
  };

  const handleClose = (value: boolean) => {
    if (!value) resetState();
    onOpenChange(value);
  };

  const amountCents = parseAmountToCents(amount);
  const tipCents = tip.trim() ? parseAmountToCents(tip) : 0;
  const amountInvalid = amount.trim().length > 0 && (amountCents === null || amountCents <= 0);
  const tipInvalid = tip.trim().length > 0 && tipCents === null;

  const handleCreate = () => {
    if (!selectedOrderId) {
      toast.error("Elige la orden que vas a cobrar");
      return;
    }
    if (amountCents === null || amountCents <= 0) {
      toast.error("Escribe un importe válido, mayor que cero");
      return;
    }
    if (tipCents === null) {
      toast.error("La propina no es un importe válido");
      return;
    }

    createPayment.mutate(
      {
        orderId: selectedOrderId,
        method,
        amount: amountCents,
        reference: reference.trim() || undefined,
        tip: tipCents,
      },
      {
        onSuccess: (res) => {
          setResult(res);
          toast.success(
            res.fully_paid
              ? `Orden ${res.order_number ?? ""} cobrada por completo`
              : `Cobro parcial registrado. Faltan ${formatCurrency(res.remaining)}`,
          );
        },
        // Sin este aviso el cajero pulsaba "Registrar cobro", no pasaba nada y
        // concluía que la aplicación estaba rota: el fallo llegaba a existir sin
        // que nadie lo viera.
        onError: (error: any) => {
          const code = error?.code;
          if (code === "NOT_FOUND") {
            toast.error("La orden ya no existe o pertenece a otra sede");
            return;
          }
          if (code === "FORBIDDEN") {
            toast.error("No tienes permiso para registrar cobros");
            return;
          }
          toast.error(error?.message || "No se pudo registrar el cobro");
        },
      },
    );
  };

  // En efectivo el cliente entrega billetes: la API cobra como máximo el saldo
  // pendiente y el resto es vuelto, así que se anuncia antes de registrar nada.
  const showChange =
    method === "cash" &&
    !!selectedOrder &&
    amountCents !== null &&
    amountCents > selectedOrder.remaining;
  const changeAmount =
    showChange && selectedOrder && amountCents !== null
      ? amountCents - selectedOrder.remaining
      : 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Registrar cobro</DialogTitle>
          <DialogDescription>
            Solo aparecen las órdenes con saldo pendiente. Los importes van en
            soles.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="flex flex-col items-center gap-4 py-6">
            <CheckCircle className="h-12 w-12 text-green-500" />
            <h3 className="text-lg font-semibold">Cobro registrado</h3>
            <p className="text-center text-sm text-muted-foreground">
              {result.fully_paid
                ? `Orden ${result.order_number ?? ""} completamente pagada`
                : `Cobro parcial. Faltan ${formatCurrency(result.remaining)}`}
            </p>
            <Button className="h-10" onClick={() => handleClose(false)}>
              Cerrar
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              {/* Selector de orden */}
              <div className="space-y-2">
                <Label htmlFor="pay-order">Orden</Label>
                {preselectedOrderId ? (
                  <div className="flex h-10 items-center rounded-md border border-input bg-muted/50 px-3 text-sm">
                    {selectedOrder
                      ? `${selectedOrder.order_number} — Mesa ${selectedOrder.table_number ?? "—"} — ${formatCurrency(selectedOrder.remaining)}`
                      : `Orden ${preselectedOrderId.slice(0, 8)}...`}
                  </div>
                ) : ordersError ? (
                  <div
                    role="alert"
                    className="flex flex-col gap-2 rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="text-destructive">
                      No se pudieron cargar las órdenes por cobrar.
                    </span>
                    <Button
                      variant="outline"
                      className="h-10"
                      onClick={() => refetchOrders()}
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Reintentar
                    </Button>
                  </div>
                ) : ordersLoading ? (
                  <div className="h-10 animate-pulse rounded-md bg-muted" />
                ) : orders.length === 0 ? (
                  <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
                    No hay ninguna orden con saldo pendiente: todo lo servido
                    está cobrado.
                  </p>
                ) : (
                  <Select
                    value={selectedOrderId || undefined}
                    onValueChange={setSelectedOrderId}
                  >
                    <SelectTrigger id="pay-order" className="h-10">
                      <SelectValue placeholder="Seleccionar orden" />
                    </SelectTrigger>
                    <SelectContent>
                      {orders.map((order) => (
                        <SelectItem key={order.id} value={order.id}>
                          {order.order_number} — Mesa{" "}
                          {order.table_number ?? "—"} —{" "}
                          {formatCurrency(order.remaining)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* Resumen de la orden elegida */}
              {selectedOrder && (
                <div className="space-y-1 rounded-lg border bg-muted/50 p-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Orden</span>
                    <span>{selectedOrder.order_number}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Cliente</span>
                    <span>{selectedOrder.customer_name || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total</span>
                    <span className="tabular-nums">
                      {formatCurrency(selectedOrder.total)}
                    </span>
                  </div>
                  {selectedOrder.total_paid > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Ya cobrado</span>
                      <span className="tabular-nums">
                        {formatCurrency(selectedOrder.total_paid)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold">
                    <span>Pendiente</span>
                    <span className="tabular-nums">
                      {formatCurrency(selectedOrder.remaining)}
                    </span>
                  </div>
                </div>
              )}

              {/* Método de pago */}
              <div className="space-y-2">
                <Label htmlFor="pay-method">Método de pago</Label>
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger id="pay-method" className="h-10">
                    <SelectValue placeholder="Seleccionar método" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(METHOD_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Importe y propina */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="pay-amount">Monto (S/)</Label>
                  <Input
                    id="pay-amount"
                    className="h-10"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    aria-invalid={amountInvalid}
                  />
                  {amountInvalid && (
                    <p role="alert" className="text-xs text-destructive">
                      Escribe un importe válido, mayor que cero.
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pay-tip">Propina (S/)</Label>
                  <Input
                    id="pay-tip"
                    className="h-10"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={tip}
                    onChange={(e) => setTip(e.target.value)}
                    aria-invalid={tipInvalid}
                  />
                  {tipInvalid && (
                    <p role="alert" className="text-xs text-destructive">
                      La propina no es un importe válido.
                    </p>
                  )}
                </div>
              </div>

              {showChange && (
                <p className="rounded-md border border-green-500/40 bg-green-500/10 p-3 text-sm font-medium text-green-700 dark:text-green-400">
                  Vuelto: {formatCurrency(changeAmount)}. Se registrarán{" "}
                  {formatCurrency(selectedOrder?.remaining ?? 0)}, que es lo que
                  queda por cobrar.
                </p>
              )}

              {/* Referencia */}
              <div className="space-y-2">
                <Label htmlFor="pay-reference">Referencia</Label>
                <Input
                  id="pay-reference"
                  className="h-10"
                  placeholder="Número de operación, últimos dígitos de la tarjeta..."
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                className="h-10"
                onClick={() => handleClose(false)}
                disabled={createPayment.isPending}
              >
                Cancelar
              </Button>
              <Button
                className="h-10"
                onClick={handleCreate}
                disabled={
                  createPayment.isPending ||
                  !selectedOrderId ||
                  amountCents === null ||
                  amountCents <= 0 ||
                  tipCents === null
                }
              >
                {createPayment.isPending ? "Registrando..." : "Registrar cobro"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
