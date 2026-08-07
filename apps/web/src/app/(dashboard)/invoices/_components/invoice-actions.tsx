"use client";

import { useState } from "react";
import { Button } from "@restai/ui/components/button";
import {
  Ban,
  Eye,
  FileCode2,
  FileCheck2,
  RefreshCw,
  Search,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  downloadInvoiceCdr,
  downloadInvoiceXml,
  useConsultarEstadoInvoice,
  useDeclararInvoice,
  useResendInvoice,
  type Invoice,
} from "@/hooks/use-invoices";

interface InvoiceActionsProps {
  invoice: Invoice;
  /** El rol tiene `invoices:create`: declarar y reenviar a SUNAT. */
  canManage: boolean;
  /**
   * El rol tiene `invoices:void`: anular ante SUNAT y emitir nota de crédito.
   *
   * Va aparte de `canManage` porque anular un comprobante ya aceptado es una
   * acción fiscal irreversible: el mozo emite la boleta de su mesa, pero no la
   * da de baja.
   */
  canVoid: boolean;
  /** Abre el detalle; se omite cuando ya estamos dentro del detalle. */
  onDetail?: (invoice: Invoice) => void;
  onVoid: (invoice: Invoice) => void;
  /** En el detalle hay sitio para el texto; en la tabla van solo iconos. */
  showLabels?: boolean;
}

/**
 * Acciones de un comprobante.
 *
 * Se comparten entre la fila de la tabla y el diálogo de detalle a propósito:
 * en móvil la tabla oculta columnas, pero el detalle mantiene TODAS las
 * acciones accesibles con su etiqueta escrita.
 */
export function InvoiceActions({
  invoice,
  canManage,
  canVoid,
  onDetail,
  onVoid,
  showLabels = false,
}: InvoiceActionsProps) {
  const declarar = useDeclararInvoice();
  const resend = useResendInvoice();
  const estado = useConsultarEstadoInvoice();
  const [downloading, setDownloading] = useState<"xml" | "cdr" | null>(null);

  const busy = declarar.isPending || resend.isPending || estado.isPending;

  /** Todos los errores de SUNAT llegan con la descripción literal del rechazo. */
  const reportError = (error: any, fallback: string) => {
    if (error?.code === "INVOICE_PENDING_TICKET") {
      toast.warning(
        "SUNAT ya está procesando este comprobante. Usa «Consultar estado» en vez de volver a declararlo.",
      );
      return;
    }
    if (error?.code === "INVOICE_ALREADY_ACCEPTED") {
      toast.info("SUNAT ya había aceptado este comprobante.");
      return;
    }
    toast.error(error?.message || fallback);
  };

  const handleDeclarar = () => {
    declarar.mutate(invoice.id, {
      onSuccess: (data) => {
        toast.success(
          data.invoice
            ? `${data.invoice.numero_completo}: ${data.invoice.sunat_status_label}`
            : "Comprobante declarado ante SUNAT",
        );
      },
      onError: (error) => reportError(error, "SUNAT no aceptó el comprobante"),
    });
  };

  const handleResend = () => {
    resend.mutate(invoice.id, {
      onSuccess: (data) => {
        toast.success(
          data.accion === "consulta_ticket"
            ? `SUNAT resolvió el ticket: ${data.invoice?.sunat_status_label ?? "consultado"}`
            : `${invoice.numero_completo}: ${data.invoice?.sunat_status_label ?? "reenviado"}`,
        );
      },
      onError: (error) => reportError(error, "No se pudo reenviar el comprobante"),
    });
  };

  const handleEstado = () => {
    estado.mutate(invoice.id, {
      onSuccess: (data) => {
        toast.success(
          data.invoice
            ? `${data.invoice.numero_completo}: ${data.invoice.sunat_status_label}`
            : "Estado consultado en SUNAT",
        );
      },
      onError: (error) => reportError(error, "No se pudo consultar el estado en SUNAT"),
    });
  };

  const handleDownload = async (kind: "xml" | "cdr") => {
    setDownloading(kind);
    try {
      if (kind === "xml") await downloadInvoiceXml(invoice);
      else await downloadInvoiceCdr(invoice);
      toast.success(kind === "xml" ? "XML descargado" : "CDR descargado");
    } catch (error: any) {
      toast.error(error?.message || "No se pudo descargar el archivo");
    } finally {
      setDownloading(null);
    }
  };

  const puedeAnular = canVoid && invoice.sunat_status !== "voided";
  const puedeDeclarar = canManage && invoice.sunat_status === "pending";
  const puedeConsultar = invoice.sunat_status === "sent" || !!invoice.sunat_ticket;
  const puedeReintentar =
    canManage && invoice.puede_reenviar && invoice.sunat_status !== "pending";

  const iconOnly = !showLabels;
  const btn = (extra?: string) => cn("h-10", iconOnly ? "w-10 p-0" : "px-3", extra);

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1",
        showLabels ? "justify-start" : "justify-end",
      )}
    >
      {onDetail && (
        <Button
          variant="ghost"
          size="sm"
          className={btn()}
          onClick={() => onDetail(invoice)}
          aria-label={`Ver el detalle de ${invoice.numero_completo}`}
          title="Ver detalle"
        >
          <Eye className={cn("h-4 w-4", !iconOnly && "mr-2")} />
          {!iconOnly && "Ver detalle"}
        </Button>
      )}

      <Button
        variant="ghost"
        size="sm"
        className={btn()}
        disabled={!invoice.has_xml || downloading === "xml"}
        onClick={() => handleDownload("xml")}
        aria-label={`Descargar el XML de ${invoice.numero_completo}`}
        title={
          invoice.has_xml
            ? "Descargar XML firmado"
            : "Todavía no hay XML: el comprobante no se ha firmado ni enviado"
        }
      >
        <FileCode2 className={cn("h-4 w-4", !iconOnly && "mr-2")} />
        {!iconOnly && "Descargar XML"}
      </Button>

      <Button
        variant="ghost"
        size="sm"
        className={btn()}
        disabled={!invoice.has_cdr || downloading === "cdr"}
        onClick={() => handleDownload("cdr")}
        aria-label={`Descargar el CDR de ${invoice.numero_completo}`}
        title={
          invoice.has_cdr
            ? "Descargar la constancia de recepción"
            : "SUNAT todavía no ha devuelto la constancia de recepción"
        }
      >
        <FileCheck2 className={cn("h-4 w-4", !iconOnly && "mr-2")} />
        {!iconOnly && "Descargar CDR"}
      </Button>

      {puedeDeclarar && (
        <Button
          variant="default"
          size="sm"
          className={cn("h-10 px-3")}
          disabled={busy}
          onClick={handleDeclarar}
          aria-label={`Declarar ${invoice.numero_completo} ante SUNAT`}
        >
          <Send className="mr-2 h-4 w-4" />
          {declarar.isPending ? "Declarando..." : "Declarar"}
        </Button>
      )}

      {puedeReintentar && (
        <Button
          variant="outline"
          size="sm"
          className="h-10 px-3"
          disabled={busy}
          onClick={handleResend}
          aria-label={`Reintentar el envío de ${invoice.numero_completo}`}
        >
          <RefreshCw className={cn("mr-2 h-4 w-4", resend.isPending && "animate-spin")} />
          {resend.isPending ? "Reintentando..." : "Reintentar"}
        </Button>
      )}

      {puedeConsultar && (
        <Button
          variant="outline"
          size="sm"
          className={btn()}
          disabled={busy}
          onClick={handleEstado}
          aria-label={`Consultar el estado de ${invoice.numero_completo} en SUNAT`}
          title="Consultar estado en SUNAT"
        >
          <Search className={cn("h-4 w-4", !iconOnly && "mr-2")} />
          {!iconOnly && (estado.isPending ? "Consultando..." : "Consultar estado")}
        </Button>
      )}

      {puedeAnular && (
        <Button
          variant="ghost"
          size="sm"
          className={btn("text-destructive hover:bg-destructive/10 hover:text-destructive")}
          onClick={() => onVoid(invoice)}
          aria-label={`Anular ${invoice.numero_completo}`}
          title="Anular comprobante"
        >
          <Ban className={cn("h-4 w-4", !iconOnly && "mr-2")} />
          {!iconOnly && "Anular"}
        </Button>
      )}
    </div>
  );
}
