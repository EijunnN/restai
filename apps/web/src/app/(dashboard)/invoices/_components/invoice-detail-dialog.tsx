"use client";

import { Button } from "@restai/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@restai/ui/components/dialog";
import { RefreshCw } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useInvoice, INVOICE_TYPE_LABELS, type Invoice } from "@/hooks/use-invoices";
import { SunatStatusBadge, SunatRejectionReason } from "./sunat-status-badge";
import { InvoiceActions } from "./invoice-actions";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

interface InvoiceDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string | null;
  canManage: boolean;
  canVoid: boolean;
  onVoid: (invoice: Invoice) => void;
}

/**
 * Detalle completo del comprobante.
 *
 * Es también la vía de escape en móvil: la tabla oculta columnas en pantallas
 * pequeñas, pero aquí están TODOS los datos y TODAS las acciones con su nombre
 * escrito.
 */
export function InvoiceDetailDialog({
  open,
  onOpenChange,
  invoiceId,
  canManage,
  canVoid,
  onVoid,
}: InvoiceDetailDialogProps) {
  const { data: invoice, isLoading, error, refetch } = useInvoice(open ? invoiceId : null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {invoice ? invoice.numero_completo : "Comprobante"}
          </DialogTitle>
          <DialogDescription>
            {invoice
              ? `${INVOICE_TYPE_LABELS[invoice.type]} emitida el ${formatDate(invoice.created_at)}`
              : "Cargando los datos del comprobante..."}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-5 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : error ? (
          <div role="alert" className="space-y-3 rounded-lg border border-destructive/50 bg-destructive/5 p-4">
            <p className="text-sm text-destructive">
              No se pudo cargar el comprobante: {(error as Error).message}
            </p>
            <Button variant="outline" className="h-10" onClick={() => refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Reintentar
            </Button>
          </div>
        ) : invoice ? (
          <div className="space-y-4">
            <div className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <SunatStatusBadge
                  status={invoice.sunat_status}
                  label={invoice.sunat_status_label}
                />
                {invoice.sunat_ticket && (
                  <span className="text-xs text-muted-foreground">
                    Ticket {invoice.sunat_ticket}
                  </span>
                )}
              </div>
              {(invoice.sunat_status === "rejected" || invoice.sunat_status === "error") && (
                <SunatRejectionReason
                  code={invoice.sunat_code}
                  description={invoice.sunat_description}
                  className="mt-2"
                />
              )}
              {invoice.sunat_status === "observed" && invoice.sunat_description && (
                <p className="mt-2 text-xs text-amber-600">
                  Observación de SUNAT: {invoice.sunat_description}
                </p>
              )}
            </div>

            <div className="space-y-1 rounded-lg border p-3 text-sm">
              <Row label="Serie" value={invoice.series} />
              <Row label="Correlativo" value={invoice.number} />
              <Row label="Cliente" value={invoice.customer_name} />
              <Row
                label="Documento"
                value={
                  <span className="uppercase">
                    {invoice.customer_doc_type} {invoice.customer_doc_number}
                  </span>
                }
              />
              <Row
                label="Base imponible"
                value={<span className="tabular-nums">{formatCurrency(invoice.subtotal)}</span>}
              />
              <Row label="IGV" value={<span className="tabular-nums">{formatCurrency(invoice.igv)}</span>} />
              <Row
                label="Total"
                value={
                  <span className="font-semibold tabular-nums">
                    {formatCurrency(invoice.total)}
                  </span>
                }
              />
              <Row
                label="Enviado a SUNAT"
                value={invoice.sent_at ? formatDate(invoice.sent_at) : "Todavía no"}
              />
              {invoice.sunat_hash && (
                <Row
                  label="Hash del XML"
                  value={<span className="break-all text-xs">{invoice.sunat_hash}</span>}
                />
              )}
              {invoice.note_motive_description && (
                <Row
                  label="Motivo de la nota"
                  value={
                    <span>
                      {invoice.note_motive_code ? `[${invoice.note_motive_code}] ` : ""}
                      {invoice.note_motive_description}
                    </span>
                  }
                />
              )}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Acciones</p>
              <InvoiceActions
                invoice={invoice}
                canManage={canManage}
                canVoid={canVoid}
                onVoid={(inv) => {
                  onOpenChange(false);
                  onVoid(inv);
                }}
                showLabels
              />
              {!invoice.has_xml && !invoice.has_cdr && (
                <p className="text-xs text-muted-foreground">
                  El XML aparece al declarar el comprobante; la constancia (CDR),
                  cuando SUNAT responde.
                </p>
              )}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
