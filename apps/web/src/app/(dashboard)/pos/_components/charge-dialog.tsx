"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@restai/ui/components/button";
import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@restai/ui/components/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@restai/ui/components/select";
import { CheckCircle2, Loader2, Printer, Wallet } from "lucide-react";
import { toast } from "sonner";
import { cn, formatCurrency } from "@/lib/utils";
import { useCreatePayment } from "@/hooks/use-payments";
import { usePrintReceipt } from "@/components/print-ticket";
import type { PosOrderSnapshot } from "../page";

/**
 * Cobro sin salir del POS.
 *
 * Antes, tras crear la orden había que irse a /orders, buscar la fila y abrir el
 * diálogo de cobro: nueve toques repartidos en dos pantallas por cada venta de
 * mostrador. Aquí se cobra la orden recién creada, cuyo total ya conocemos, sin
 * depender del listado de órdenes impagas (que aún no se ha refrescado).
 */

const METHODS = [
  { value: "cash", label: "Efectivo" },
  { value: "card", label: "Tarjeta" },
  { value: "yape", label: "Yape" },
  { value: "plin", label: "Plin" },
  { value: "transfer", label: "Transferencia" },
  { value: "other", label: "Otro" },
] as const;

const METHOD_LABEL: Record<string, string> = Object.fromEntries(
  METHODS.map((m) => [m.value, m.label]),
);

/** "12,50" o "12.50" -> 1250 céntimos. null si no es un importe válido. */
function parseAmountToCents(input: string): number | null {
  const cleaned = input.trim().replace(/\s/g, "").replace(",", ".");
  if (!cleaned) return null;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  return Math.round(parseFloat(cleaned) * 100);
}

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Billetes con los que suele pagar el cliente, por encima del importe debido. */
function cashSuggestions(owed: number): number[] {
  const notes = [1000, 2000, 5000, 10000, 20000];
  const options = new Set<number>([owed]);
  for (const note of notes) {
    if (note >= owed) options.add(note);
  }
  // Redondeo al alza al siguiente múltiplo de 10 soles (p. ej. 43.50 -> 50.00).
  const roundedUp = Math.ceil(owed / 1000) * 1000;
  if (roundedUp > owed) options.add(roundedUp);
  return [...options].sort((a, b) => a - b).slice(0, 4);
}

interface PaymentResult {
  order_number: string;
  order_total: number;
  total_paid: number;
  remaining: number;
  fully_paid: boolean;
  method: string;
  amount: number;
  tip: number;
}

export function ChargeDialog({
  open,
  onOpenChange,
  order,
  taxRate,
  businessName,
  ruc,
  address,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Orden recién creada en el POS. */
  order: PosOrderSnapshot | null;
  /** Tasa de IGV de la sede, en centésimas de punto (1800 = 18 %). */
  taxRate: number;
  businessName: string;
  ruc?: string;
  address?: string;
}) {
  const createPayment = useCreatePayment();
  const printReceipt = usePrintReceipt();
  const queryClient = useQueryClient();

  const [method, setMethod] = useState<string>("cash");
  const [amount, setAmount] = useState("");
  const [tip, setTip] = useState("");
  const [reference, setReference] = useState("");
  const [result, setResult] = useState<PaymentResult | null>(null);
  /** Lo que falta por cobrar de esta orden (baja con cada cobro parcial). */
  const [owed, setOwed] = useState(0);
  /** Vuelto entregado en el último cobro en efectivo, congelado al registrarlo. */
  const [changeGiven, setChangeGiven] = useState(0);

  /** Última orden para la que se preparó el formulario. */
  const preparedOrderId = useRef<string | null>(null);

  // El formulario se prepara UNA vez por orden, con el importe debido ya escrito:
  // el caso normal es cobrar el total. Si el diálogo se cierra y se vuelve a abrir
  // con la misma orden NO se reinicia: hacerlo devolvía el pendiente al total y,
  // tras un cobro parcial, el vuelto que se anunciaba al cliente era falso.
  useEffect(() => {
    if (!open || !order) return;
    if (preparedOrderId.current === order.id) return;
    preparedOrderId.current = order.id;
    setMethod("cash");
    setTip("");
    setReference("");
    setResult(null);
    setChangeGiven(0);
    setOwed(order.total);
    setAmount(centsToInput(order.total));
  }, [open, order?.id, order?.total]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!order) return null;

  const amountCents = parseAmountToCents(amount);
  const tipCents = tip.trim() ? parseAmountToCents(tip) : 0;
  /** Lo tecleado por encima del pendiente. En efectivo es vuelto; en el resto, un error de tecleo. */
  const excessCents = amountCents !== null ? Math.max(0, amountCents - owed) : 0;
  /** Vuelto previsto mientras el cajero teclea (solo efectivo). */
  const changePreview = method === "cash" ? excessCents : 0;
  /**
   * Lo que se va a registrar de verdad: NUNCA más de lo debido.
   *
   * El servidor ya recorta el exceso (`effectiveAmount = min(amount, remaining)`),
   * así que anunciar en el botón el importe tecleado era mentirle al cajero: creía
   * haber cobrado 200 y en caja quedaban registrados 100.
   */
  const chargeCents = amountCents === null ? 0 : Math.min(amountCents, owed);
  const amountInvalid = amount.trim().length > 0 && amountCents === null;
  const tipInvalid = tip.trim().length > 0 && tipCents === null;

  const handleCharge = async () => {
    if (amountCents === null || amountCents <= 0) {
      toast.error("Escribe un importe válido para cobrar");
      return;
    }
    if (tipCents === null) {
      toast.error("La propina no es un importe válido");
      return;
    }
    try {
      // En efectivo el cliente entrega billetes: se cobra lo debido y el resto
      // es vuelto. Enviar el billete entero inflaría la recaudación de la caja.
      const res: any = await createPayment.mutateAsync({
        orderId: order.id,
        method,
        amount: chargeCents,
        tip: tipCents,
        reference: reference.trim() || undefined,
      });
      setResult(res as PaymentResult);
      // El vuelto se congela con el importe recibido en ESTE cobro: recalcularlo
      // después dejaría "pendiente" en cero y el vuelto igual a todo lo recibido.
      setChangeGiven(changePreview);
      const remaining = res.remaining ?? 0;
      setOwed(remaining);
      setAmount(centsToInput(remaining));
      // La propina ya se registró con ESTE cobro. Si se dejara escrita, el
      // siguiente cobro parcial de la misma orden la volvería a enviar y la
      // caja acabaría con el doble de propina de la que dejó el cliente.
      // Lo mismo con la referencia: pertenece a la operación ya registrada.
      setTip("");
      setReference("");
      // El saldo de la mesa cambia con el cobro: sin esto, el plano del salón
      // seguía enseñando la cuenta sin pagar (`useCreatePayment` no toca ["tables"]).
      if (order.tableNumber != null) {
        void queryClient.invalidateQueries({ queryKey: ["tables"] });
      }
      toast.success(
        res.fully_paid
          ? `Orden ${res.order_number} cobrada`
          : `Cobro parcial registrado. Faltan ${formatCurrency(remaining)}`,
      );
    } catch (err: any) {
      toast.error(err?.message || "No se pudo registrar el cobro");
    }
  };

  const handlePrintReceipt = () => {
    printReceipt({
      businessName,
      ruc,
      address,
      orderNumber: order.orderNumber,
      createdAt: order.createdAt,
      items: order.items,
      subtotal: order.subtotal,
      discount: order.discount,
      deliveryFee: order.deliveryFee,
      tax: order.tax,
      taxRate,
      total: order.total,
      paymentMethod: result?.method ?? method,
      customerName: order.customerName ?? undefined,
    });
  };

  return (
    <Dialog
      open={open}
      // Con el cobro en vuelo no se cierra por Escape ni tocando fuera: el cajero
      // se quedaría sin saber si el cobro llegó a registrarse.
      onOpenChange={(value) => {
        if (!value && createPayment.isPending) return;
        onOpenChange(value);
      }}
    >
      <DialogContent className="flex max-h-[90vh] max-w-md flex-col overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cobrar orden {order.orderNumber}</DialogTitle>
          <DialogDescription>
            {order.tableNumber != null
              ? `Mesa ${order.tableNumber}`
              : order.type === "delivery"
                ? "Delivery"
                : order.type === "takeout"
                  ? "Para llevar"
                  : "Mostrador"}
            {order.customerName ? ` · ${order.customerName}` : ""}
          </DialogDescription>
        </DialogHeader>

        {result?.fully_paid ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-500" />
            <p className="text-lg font-semibold">Cobro registrado</p>
            <p className="text-sm text-muted-foreground">
              Orden {result.order_number} pagada por completo
              {result.tip > 0 ? ` (propina ${formatCurrency(result.tip)})` : ""}.
            </p>
            {changeGiven > 0 && (
              <p className="text-sm font-medium text-green-600">
                Vuelto: {formatCurrency(changeGiven)}
              </p>
            )}
            <div className="mt-2 flex w-full flex-col gap-2">
              <Button type="button" variant="outline" className="h-12" onClick={handlePrintReceipt}>
                <Printer className="mr-2 h-4 w-4" />
                Imprimir recibo
              </Button>
              <Button type="button" className="h-12" onClick={() => onOpenChange(false)}>
                Cerrar
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-xl border bg-muted/50 p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Total de la orden</span>
                <span className="tabular-nums">{formatCurrency(order.total)}</span>
              </div>
              {result && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Cobrado</span>
                  <span className="tabular-nums">{formatCurrency(result.total_paid)}</span>
                </div>
              )}
              <div className="mt-1 flex items-center justify-between border-t pt-1 text-base font-bold">
                <span>Pendiente</span>
                <span className="tabular-nums text-primary">{formatCurrency(owed)}</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pos-charge-method">Método de pago</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger id="pos-charge-method" className="h-11">
                  <SelectValue placeholder="Método de pago" />
                </SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {method === "cash" && owed > 0 && (
              <div className="grid grid-cols-4 gap-1.5">
                {cashSuggestions(owed).map((option) => (
                  <Button
                    key={option}
                    type="button"
                    variant="outline"
                    className="h-11 px-1 text-xs font-semibold tabular-nums"
                    onClick={() => setAmount(centsToInput(option))}
                  >
                    {formatCurrency(option)}
                  </Button>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="pos-charge-amount">
                  {method === "cash" ? "Recibido (S/)" : "Monto (S/)"}
                </Label>
                <Input
                  id="pos-charge-amount"
                  className={cn("h-11 tabular-nums", amountInvalid && "border-destructive")}
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  aria-invalid={amountInvalid}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pos-charge-tip">Propina (S/)</Label>
                <Input
                  id="pos-charge-tip"
                  className={cn("h-11 tabular-nums", tipInvalid && "border-destructive")}
                  inputMode="decimal"
                  placeholder="0.00"
                  value={tip}
                  onChange={(e) => setTip(e.target.value)}
                  aria-invalid={tipInvalid}
                />
              </div>
            </div>

            {(amountInvalid || tipInvalid) && (
              <p role="alert" className="text-xs font-medium text-destructive">
                Escribe los importes en soles, con un máximo de dos decimales (ej. 24.50).
              </p>
            )}

            {changePreview > 0 && (
              <p className="rounded-lg bg-green-500/10 px-3 py-2 text-sm font-semibold text-green-700 dark:text-green-400">
                Vuelto: {formatCurrency(changePreview)}
              </p>
            )}

            {method !== "cash" && excessCents > 0 && (
              <p
                role="alert"
                className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-400"
              >
                Solo se registrarán {formatCurrency(owed)}: es todo lo que debe esta
                orden. Revisa el importe antes de cobrar.
              </p>
            )}

            {method !== "cash" && (
              <div className="space-y-1.5">
                <Label htmlFor="pos-charge-reference">Referencia (opcional)</Label>
                <Input
                  id="pos-charge-reference"
                  className="h-11"
                  placeholder="Número de operación"
                  value={reference}
                  maxLength={255}
                  onChange={(e) => setReference(e.target.value)}
                />
              </div>
            )}

            {result && !result.fully_paid && (
              <>
                <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  Cobro parcial registrado. Quedan {formatCurrency(owed)} por cobrar de la
                  orden {result.order_number}.
                </p>
                {/*
                  El cliente que paga su parte también quiere su papel: sin este
                  botón, imprimir el recibo solo era posible al saldar la cuenta.
                */}
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 w-full"
                  onClick={handlePrintReceipt}
                >
                  <Printer className="mr-2 h-4 w-4" />
                  Imprimir recibo
                </Button>
              </>
            )}

            <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                className="h-12 flex-1"
                onClick={() => onOpenChange(false)}
                disabled={createPayment.isPending}
              >
                {result ? "Cerrar" : "Cancelar"}
              </Button>
              <Button
                type="button"
                className="h-12 flex-1"
                onClick={handleCharge}
                disabled={createPayment.isPending || chargeCents <= 0}
              >
                {createPayment.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Cobrando…
                  </>
                ) : (
                  <>
                    <Wallet className="mr-2 h-4 w-4" />
                    Cobrar {formatCurrency(chargeCents)}
                  </>
                )}
              </Button>
            </div>

            <p className="text-center text-[11px] text-muted-foreground">
              Método: {METHOD_LABEL[method]}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
