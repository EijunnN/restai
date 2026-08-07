"use client";

import { useEffect, useState } from "react";
import { Button } from "@restai/ui/components/button";
import { Label } from "@restai/ui/components/label";
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
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  useVoidInvoice,
  INVOICE_TYPE_LABELS,
  type Invoice,
  type SunatActionResult,
} from "@/hooks/use-invoices";
import { SunatStatusBadge } from "./sunat-status-badge";

/** La API exige entre 3 y 250 caracteres. */
const MIN_MOTIVO = 3;
const MAX_MOTIVO = 250;

type Via = "auto" | "baja" | "nota_credito";

const VIA_LABELS: Record<string, string> = {
  baja: "comunicación de baja",
  nota_credito: "nota de crédito",
  local: "anulación local (nunca llegó a SUNAT)",
};

interface VoidInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: Invoice | null;
}

/**
 * Anulación de un comprobante ya emitido.
 *
 * El servidor decide la vía correcta: comunicación de baja para una factura
 * aceptada dentro de plazo, nota de crédito para una boleta o una factura
 * fuera de plazo, y anulación local si nunca llegó a SUNAT. Aquí solo se pide
 * el motivo y, para quien sepa lo que hace, se permite forzar la vía.
 */
export function VoidInvoiceDialog({ open, onOpenChange, invoice }: VoidInvoiceDialogProps) {
  const [motivo, setMotivo] = useState("");
  const [via, setVia] = useState<Via>("auto");
  const [touched, setTouched] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<SunatActionResult | null>(null);

  const voidInvoice = useVoidInvoice();

  useEffect(() => {
    if (open) {
      setMotivo("");
      setVia("auto");
      setTouched(false);
      setConfirmOpen(false);
      setResult(null);
    }
  }, [open, invoice?.id]);

  const trimmed = motivo.trim();
  const motivoIsValid = trimmed.length >= MIN_MOTIVO;

  const handleContinue = () => {
    setTouched(true);
    if (!motivoIsValid) return;
    setConfirmOpen(true);
  };

  const handleConfirm = () => {
    if (!invoice || !motivoIsValid) return;
    voidInvoice.mutate(
      { id: invoice.id, motivo: trimmed, via: via === "auto" ? undefined : via },
      {
        onSuccess: (data) => {
          setConfirmOpen(false);
          setResult(data);
          toast.success(`${invoice.numero_completo} anulado`);
        },
        onError: (error: any) => {
          setConfirmOpen(false);
          if (error?.code === "INVOICE_ALREADY_VOIDED") {
            toast.error("Este comprobante ya estaba anulado");
            return;
          }
          if (error?.code === "INVOICE_NOT_DECLARED") {
            toast.error(
              "SUNAT no ha aceptado el comprobante: decláralo o reintenta el envío antes de anularlo",
            );
            return;
          }
          // Un 422 trae la descripción literal del rechazo de SUNAT.
          toast.error(error?.message || "SUNAT no aceptó la anulación");
        },
      },
    );
  };

  if (!invoice) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          {result ? (
            /* ── Resultado ───────────────────────────────────────────── */
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  Comprobante anulado
                </DialogTitle>
                <DialogDescription>
                  Se anuló {invoice.numero_completo} por{" "}
                  {VIA_LABELS[result.via ?? ""] ?? "la vía que correspondía"}.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3 text-sm">
                {result.motivo_via && (
                  <p className="text-muted-foreground">{result.motivo_via}</p>
                )}

                {result.nota && (
                  <div className="rounded-lg border bg-muted/40 p-3">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">
                      Nota de crédito emitida
                    </p>
                    <p className="mt-1 text-xl font-bold tabular-nums">
                      {result.nota.numero_completo}
                    </p>
                    <div className="mt-2">
                      <SunatStatusBadge
                        status={result.nota.sunat_status}
                        label={result.nota.sunat_status_label}
                      />
                    </div>
                  </div>
                )}

                {result.invoice && (
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <span className="text-muted-foreground">Estado del comprobante</span>
                    <SunatStatusBadge
                      status={result.invoice.sunat_status}
                      label={result.invoice.sunat_status_label}
                    />
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
            /* ── Formulario ──────────────────────────────────────────── */
            <>
              <DialogHeader>
                <DialogTitle>Anular comprobante</DialogTitle>
                <DialogDescription>
                  {INVOICE_TYPE_LABELS[invoice.type]} {invoice.numero_completo} ·{" "}
                  {invoice.customer_name} · {formatCurrency(invoice.total)}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="invoice-motivo">Motivo de la anulación</Label>
                  <textarea
                    id="invoice-motivo"
                    rows={3}
                    value={motivo}
                    maxLength={MAX_MOTIVO}
                    onBlur={() => setTouched(true)}
                    onChange={(e) => setMotivo(e.target.value)}
                    aria-invalid={touched && !motivoIsValid}
                    aria-describedby="invoice-motivo-help"
                    placeholder="Ej. el cliente entregó un RUC equivocado"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                  <p id="invoice-motivo-help" className="text-xs text-muted-foreground">
                    Mínimo {MIN_MOTIVO} caracteres. Viaja a SUNAT dentro de la baja o
                    de la nota de crédito. {trimmed.length}/{MAX_MOTIVO}
                  </p>
                  {touched && !motivoIsValid && (
                    <p role="alert" className="text-xs text-destructive">
                      Escribe un motivo de al menos {MIN_MOTIVO} caracteres.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="invoice-via">Vía de anulación</Label>
                  <Select value={via} onValueChange={(value) => setVia(value as Via)}>
                    <SelectTrigger id="invoice-via" className="h-10">
                      <SelectValue placeholder="Automática" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Automática (recomendada)</SelectItem>
                      <SelectItem value="baja">Comunicación de baja</SelectItem>
                      <SelectItem value="nota_credito">Nota de crédito</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    En automático se elige la vía que exige SUNAT según el tipo de
                    comprobante, su estado y el plazo. Cámbialo solo si sabes por qué.
                  </p>
                </div>
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  className="h-10"
                  onClick={() => onOpenChange(false)}
                  disabled={voidInvoice.isPending}
                >
                  Cancelar
                </Button>
                <Button
                  variant="destructive"
                  className="h-10"
                  onClick={handleContinue}
                  disabled={voidInvoice.isPending}
                >
                  Anular comprobante
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`¿Anular ${invoice.numero_completo}?`}
        description={
          "La anulación se comunica a SUNAT y no se puede deshacer. " +
          "Si el comprobante ya fue aceptado, se emitirá una nota de crédito o una comunicación de baja, " +
          "que consume su propio correlativo."
        }
        confirmLabel="Sí, anular"
        loading={voidInvoice.isPending}
        onConfirm={handleConfirm}
      />
    </>
  );
}
