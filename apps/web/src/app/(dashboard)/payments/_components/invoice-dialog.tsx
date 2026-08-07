"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
import { Button } from "@restai/ui/components/button";
import { Badge } from "@restai/ui/components/badge";
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
import { CheckCircle2, Receipt, Send } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";
import {
  useCreateInvoice,
  useDeclararInvoice,
  INVOICE_TYPE_LABELS,
  type Invoice,
} from "@/hooks/use-invoices";
import type { Payment } from "@/hooks/use-payments";

type DocType = "dni" | "ruc" | "ce";

interface InvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: Payment | null;
}

/** Mismas reglas que valida la API, para no gastar un viaje en un error obvio. */
function docNumberError(docType: DocType, value: string): string | null {
  if (!value) return "Ingresa el número de documento";
  if (docType === "dni" && !/^\d{8}$/.test(value)) return "El DNI son 8 dígitos";
  if (docType === "ruc") {
    if (!/^\d{11}$/.test(value)) return "El RUC son 11 dígitos";
    if (!value.startsWith("10") && !value.startsWith("20")) {
      return "El RUC debe empezar con 10 o 20";
    }
  }
  if (docType === "ce" && (value.length < 9 || value.length > 12)) {
    return "El carné de extranjería tiene entre 9 y 12 caracteres";
  }
  return null;
}

/**
 * Emisión del comprobante electrónico de una venta ya cobrada.
 *
 * Al terminar se muestran SERIE y CORRELATIVO: antes el diálogo se cerraba en
 * silencio, el cajero creía que no había pasado nada, volvía a pulsar y recibía
 * un 409 que parecía un fallo del sistema cuando en realidad el comprobante ya
 * estaba emitido.
 */
export function InvoiceDialog({ open, onOpenChange, payment }: InvoiceDialogProps) {
  const router = useRouter();
  const [type, setType] = useState<"boleta" | "factura">("boleta");
  const [customerName, setCustomerName] = useState("");
  const [docType, setDocType] = useState<DocType>("dni");
  const [docNumber, setDocNumber] = useState("");
  const [touched, setTouched] = useState(false);
  const [issued, setIssued] = useState<Invoice | null>(null);

  const createInvoice = useCreateInvoice();
  const declarar = useDeclararInvoice();

  useEffect(() => {
    if (open) {
      setType("boleta");
      setCustomerName("");
      setDocType("dni");
      setDocNumber("");
      setTouched(false);
      setIssued(null);
    }
  }, [open, payment?.id]);

  // La factura solo admite RUC: cambiar el tipo debe arrastrar el documento,
  // o el cajero rellena un DNI que la API rechazará al final del formulario.
  const handleTypeChange = (value: string) => {
    const next = value as "boleta" | "factura";
    setType(next);
    if (next === "factura") {
      setDocType("ruc");
    } else if (docType === "ruc") {
      setDocType("dni");
    }
    setDocNumber("");
  };

  const docError = docNumberError(docType, docNumber);
  const nameError = customerName.trim().length === 0 ? "Ingresa el nombre o la razón social" : null;
  const formIsValid = !docError && !nameError;

  const handleCreate = () => {
    setTouched(true);
    if (!payment || !formIsValid) return;

    createInvoice.mutate(
      {
        orderId: payment.order_id,
        type,
        customerName: customerName.trim(),
        customerDocType: docType,
        customerDocNumber: docNumber.trim(),
      },
      {
        onSuccess: (invoice) => {
          setIssued(invoice);
          toast.success(`Comprobante ${invoice.numero_completo} emitido`);
        },
        onError: (error: any) => {
          if (error?.code === "INVOICE_EXISTS") {
            toast.error(
              "Esta venta ya tiene un comprobante emitido. Búscalo en Comprobantes: no hace falta emitir otro.",
            );
            return;
          }
          if (error?.code === "ORDER_NOT_PAID") {
            toast.error("La orden debe estar totalmente pagada antes de emitir el comprobante");
            return;
          }
          toast.error(error?.message || "No se pudo emitir el comprobante");
        },
      },
    );
  };

  const handleDeclarar = () => {
    if (!issued) return;
    declarar.mutate(issued.id, {
      onSuccess: (data) => {
        const actualizado = data.invoice;
        if (actualizado) setIssued(actualizado);
        toast.success(
          actualizado
            ? `${actualizado.numero_completo}: ${actualizado.sunat_status_label}`
            : "Comprobante declarado ante SUNAT",
        );
      },
      onError: (error: any) => {
        if (error?.code === "INVOICE_PENDING_TICKET") {
          toast.warning(
            "SUNAT ya lo está procesando. Consulta su estado desde la pantalla de Comprobantes.",
          );
          return;
        }
        // Un 422 trae la descripción literal del rechazo de SUNAT.
        toast.error(error?.message || "SUNAT no aceptó el comprobante");
      },
    });
  };

  if (!payment) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        {issued ? (
          /* ── Emitido: serie y correlativo bien visibles ──────────────── */
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                Comprobante emitido
              </DialogTitle>
              <DialogDescription>
                Guarda este número: es el que identifica la venta ante SUNAT.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="rounded-xl border bg-muted/40 p-4 text-center">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  {INVOICE_TYPE_LABELS[issued.type]}
                </p>
                <p className="mt-1 text-3xl font-bold tabular-nums">
                  {issued.numero_completo}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Serie {issued.series} · Correlativo {issued.number}
                </p>
              </div>

              <div className="space-y-1 rounded-lg border p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Cliente</span>
                  <span className="text-right font-medium">{issued.customer_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Documento</span>
                  <span className="uppercase">
                    {issued.customer_doc_type} {issued.customer_doc_number}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total</span>
                  <span className="font-semibold tabular-nums">
                    {formatCurrency(issued.total)}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-muted-foreground">Estado ante SUNAT</span>
                  <Badge
                    variant={
                      issued.sunat_status === "accepted" || issued.sunat_status === "observed"
                        ? "secondary"
                        : issued.sunat_status === "rejected" || issued.sunat_status === "error"
                          ? "destructive"
                          : "outline"
                    }
                  >
                    {issued.sunat_status_label}
                  </Badge>
                </div>
              </div>

              {issued.sunat_status === "pending" && (
                <p className="text-sm text-muted-foreground">
                  El comprobante existe, pero todavía no se ha declarado. Puedes
                  declararlo ahora o hacerlo después desde Comprobantes.
                </p>
              )}
            </div>

            <DialogFooter className="flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                className="h-10"
                onClick={() => {
                  onOpenChange(false);
                  router.push("/invoices");
                }}
              >
                <Receipt className="mr-2 h-4 w-4" />
                Ver comprobantes
              </Button>
              {issued.sunat_status === "pending" && (
                <Button className="h-10" onClick={handleDeclarar} disabled={declarar.isPending}>
                  <Send className="mr-2 h-4 w-4" />
                  {declarar.isPending ? "Declarando..." : "Declarar ante SUNAT"}
                </Button>
              )}
              <Button variant="secondary" className="h-10" onClick={() => onOpenChange(false)}>
                Cerrar
              </Button>
            </DialogFooter>
          </>
        ) : (
          /* ── Formulario ─────────────────────────────────────────────── */
          <>
            <DialogHeader>
              <DialogTitle>Emitir comprobante</DialogTitle>
              <DialogDescription>
                Orden {payment.order_number ?? "—"} · {formatCurrency(payment.amount)} cobrados.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="invoice-type">Tipo de comprobante</Label>
                <Select value={type} onValueChange={handleTypeChange}>
                  <SelectTrigger id="invoice-type" className="h-10">
                    <SelectValue placeholder="Seleccionar tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="boleta">Boleta de venta</SelectItem>
                    <SelectItem value="factura">Factura (exige RUC)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="invoice-customer">
                  {type === "factura" ? "Razón social" : "Nombre del cliente"}
                </Label>
                <Input
                  id="invoice-customer"
                  className="h-10"
                  placeholder={type === "factura" ? "Empresa S.A.C." : "Nombre y apellidos"}
                  value={customerName}
                  onBlur={() => setTouched(true)}
                  onChange={(e) => setCustomerName(e.target.value)}
                  aria-invalid={touched && !!nameError}
                />
                {touched && nameError && (
                  <p role="alert" className="text-xs text-destructive">
                    {nameError}
                  </p>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="invoice-doc-type">Tipo de documento</Label>
                  <Select
                    value={docType}
                    onValueChange={(value) => {
                      setDocType(value as DocType);
                      setDocNumber("");
                    }}
                    disabled={type === "factura"}
                  >
                    <SelectTrigger id="invoice-doc-type" className="h-10">
                      <SelectValue placeholder="Tipo de documento" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dni">DNI</SelectItem>
                      <SelectItem value="ruc">RUC</SelectItem>
                      <SelectItem value="ce">Carné de extranjería</SelectItem>
                    </SelectContent>
                  </Select>
                  {type === "factura" && (
                    <p className="text-xs text-muted-foreground">
                      La factura solo se emite con RUC.
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invoice-doc-number">Número de documento</Label>
                  <Input
                    id="invoice-doc-number"
                    className="h-10"
                    inputMode={docType === "ce" ? "text" : "numeric"}
                    placeholder={
                      docType === "dni" ? "12345678" : docType === "ruc" ? "20123456789" : "AB1234567"
                    }
                    maxLength={docType === "dni" ? 8 : docType === "ruc" ? 11 : 12}
                    value={docNumber}
                    onBlur={() => setTouched(true)}
                    onChange={(e) => {
                      const raw = e.target.value;
                      // DNI y RUC son estrictamente numéricos: filtrar aquí evita
                      // un rechazo del servidor por un espacio o un guion.
                      setDocNumber(
                        docType === "ce" ? raw.trim() : raw.replace(/\D/g, ""),
                      );
                    }}
                    aria-invalid={touched && !!docError}
                  />
                  {touched && docError && (
                    <p role="alert" className="text-xs text-destructive">
                      {docError}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" className="h-10" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button className="h-10" onClick={handleCreate} disabled={createInvoice.isPending}>
                {createInvoice.isPending ? "Emitiendo..." : "Emitir comprobante"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
