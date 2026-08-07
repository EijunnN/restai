"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@restai/ui/components/button";
import { Label } from "@restai/ui/components/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@restai/ui/components/dialog";
import { AlertTriangle, CheckCircle2, FileWarning, Receipt } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  useVoidPayment,
  type Payment,
  type VoidPaymentResult,
} from "@/hooks/use-payments";
import { METHOD_LABELS } from "./payment-filters";

/** La API exige 5 caracteres como mínimo; se valida antes de enviar. */
const MIN_REASON = 5;

const INVOICE_TYPE_LABELS: Record<string, string> = {
  boleta: "boleta",
  factura: "factura",
  nota_credito: "nota de crédito",
  nota_debito: "nota de débito",
};

interface VoidPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: Payment | null;
}

/**
 * Anulación de un cobro mal registrado.
 *
 * Hasta ahora un importe mal tecleado quedaba grabado para siempre y solo se
 * salía tocando la base de datos. El motivo es obligatorio porque es lo único
 * que explica el descuadre cuando alguien revise la caja meses después.
 */
export function VoidPaymentDialog({
  open,
  onOpenChange,
  payment,
}: VoidPaymentDialogProps) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<VoidPaymentResult | null>(null);

  const voidPayment = useVoidPayment();

  // Cada cobro empieza con el formulario limpio: reutilizar el motivo del
  // anterior es exactamente lo que hace inútil una traza de auditoría.
  useEffect(() => {
    if (open) {
      setReason("");
      setTouched(false);
      setResult(null);
      setConfirmOpen(false);
    }
  }, [open, payment?.id]);

  const trimmedReason = reason.trim();
  const reasonIsValid = trimmedReason.length >= MIN_REASON;

  const handleContinue = () => {
    setTouched(true);
    if (!reasonIsValid) return;
    setConfirmOpen(true);
  };

  const handleConfirm = () => {
    if (!payment || !reasonIsValid) return;
    voidPayment.mutate(
      { id: payment.id, reason: trimmedReason },
      {
        onSuccess: (data) => {
          setConfirmOpen(false);
          setResult(data);
          toast.success(`Cobro de ${formatCurrency(data.amount)} anulado`);
        },
        onError: (error: any) => {
          setConfirmOpen(false);
          const code = error?.code;
          if (code === "CONFLICT") {
            toast.error("Este cobro ya había sido anulado por otra persona");
          } else if (code === "FORBIDDEN") {
            toast.error("No tienes permiso para anular cobros");
          } else {
            toast.error(error?.message || "No se pudo anular el cobro");
          }
        },
      },
    );
  };

  if (!payment) return null;

  const invoice = result?.invoice ?? null;
  const invoiceLabel = invoice
    ? `${INVOICE_TYPE_LABELS[invoice.type] ?? invoice.type} ${invoice.series}-${String(
        invoice.number,
      ).padStart(8, "0")}`
    : null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          {result ? (
            /* ── Resultado: qué acaba de pasar y qué falta por hacer ───── */
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  Cobro anulado
                </DialogTitle>
                <DialogDescription>
                  Se anularon {formatCurrency(result.amount)} de la orden{" "}
                  {result.order_number ?? "—"}. El registro no se borra: queda con
                  tu nombre, la fecha y el motivo.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3 text-sm">
                <div className="rounded-lg border bg-muted/40 p-3">
                  <div className="flex justify-between py-0.5">
                    <span className="text-muted-foreground">Saldo pendiente de la orden</span>
                    <span className="font-semibold tabular-nums">
                      {formatCurrency(result.remaining)}
                    </span>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span className="text-muted-foreground">Productos liberados</span>
                    <span className="font-semibold tabular-nums">
                      {result.items_released}
                    </span>
                  </div>
                </div>

                {result.invoice_needs_credit_note && (
                  <div
                    role="alert"
                    className="flex gap-3 rounded-lg border border-red-500/50 bg-red-500/10 p-3"
                  >
                    <FileWarning className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
                    <div className="space-y-2">
                      <p className="font-semibold text-red-600">
                        Anular el cobro NO anula el comprobante
                      </p>
                      <p>
                        Se anuló el cobro, pero la {invoiceLabel} sigue emitida ante
                        SUNAT. Hay que emitir una nota de crédito: mientras no se
                        haga, el local sigue declarando una venta que ya no existe.
                      </p>
                      <Button
                        size="sm"
                        className="h-10"
                        onClick={() => {
                          onOpenChange(false);
                          router.push("/invoices");
                        }}
                      >
                        <Receipt className="mr-2 h-4 w-4" />
                        Ir a comprobantes
                      </Button>
                    </div>
                  </div>
                )}

                {result.order_needs_review && (
                  <div
                    role="alert"
                    className="flex gap-3 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3"
                  >
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                    <div>
                      <p className="font-semibold text-amber-600">
                        La orden necesita revisión
                      </p>
                      <p>
                        Ya estaba cerrada y ahora vuelve a tener saldo. El stock
                        descontado y los puntos otorgados al cliente NO se revierten
                        solos: revísalos a mano.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button className="h-10" onClick={() => onOpenChange(false)}>
                  Entendido
                </Button>
              </DialogFooter>
            </>
          ) : (
            /* ── Formulario: motivo obligatorio ────────────────────────── */
            <>
              <DialogHeader>
                <DialogTitle>Anular cobro</DialogTitle>
                <DialogDescription>
                  El cobro no se borra: se marca como anulado y deja de contar como
                  dinero cobrado. La orden recuperará su saldo pendiente.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                  <div className="flex justify-between py-0.5">
                    <span className="text-muted-foreground">Orden</span>
                    <span className="font-medium">{payment.order_number ?? "—"}</span>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span className="text-muted-foreground">Método</span>
                    <span className="font-medium">
                      {METHOD_LABELS[payment.method] ?? payment.method}
                    </span>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span className="text-muted-foreground">Importe</span>
                    <span className="font-semibold tabular-nums">
                      {formatCurrency(payment.amount)}
                    </span>
                  </div>
                  {payment.tip > 0 && (
                    <div className="flex justify-between py-0.5">
                      <span className="text-muted-foreground">Propina</span>
                      <span className="tabular-nums">{formatCurrency(payment.tip)}</span>
                    </div>
                  )}
                  {payment.cashier_name && (
                    <div className="flex justify-between py-0.5">
                      <span className="text-muted-foreground">Cobró</span>
                      <span>{payment.cashier_name}</span>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="void-reason">Motivo de la anulación</Label>
                  <textarea
                    id="void-reason"
                    rows={3}
                    value={reason}
                    onBlur={() => setTouched(true)}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={500}
                    aria-invalid={touched && !reasonIsValid}
                    aria-describedby="void-reason-help"
                    placeholder="Ej. se cobró S/ 120 en lugar de S/ 12 por error de tecleo"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                  <p id="void-reason-help" className="text-xs text-muted-foreground">
                    Mínimo {MIN_REASON} caracteres. Quedará en la auditoría junto a tu
                    nombre. {trimmedReason.length}/500
                  </p>
                  {touched && !reasonIsValid && (
                    <p role="alert" className="text-xs text-destructive">
                      Escribe un motivo de al menos {MIN_REASON} caracteres.
                    </p>
                  )}
                </div>
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  className="h-10"
                  onClick={() => onOpenChange(false)}
                  disabled={voidPayment.isPending}
                >
                  Cancelar
                </Button>
                <Button
                  variant="destructive"
                  className="h-10"
                  onClick={handleContinue}
                  disabled={voidPayment.isPending}
                >
                  Anular cobro
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="¿Anular este cobro?"
        description={
          `Se anularán ${formatCurrency(payment.amount)} de la orden ${payment.order_number ?? "—"}. ` +
          "La operación queda registrada con tu nombre y no se puede deshacer. " +
          "Si la venta ya tiene comprobante emitido, tendrás que emitir además una nota de crédito."
        }
        confirmLabel="Sí, anular cobro"
        loading={voidPayment.isPending}
        onConfirm={handleConfirm}
      />
    </>
  );
}
