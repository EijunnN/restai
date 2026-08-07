"use client";

import { Card, CardContent } from "@restai/ui/components/card";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { INVOICE_TYPE_LABELS, type Invoice } from "@/hooks/use-invoices";
import { SunatStatusBadge, SunatRejectionReason } from "./sunat-status-badge";
import { InvoiceActions } from "./invoice-actions";

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-muted", className)} />;
}

interface InvoicesTableProps {
  invoices: Invoice[];
  isLoading: boolean;
  canManage: boolean;
  canVoid: boolean;
  hasActiveFilters: boolean;
  onDetail: (invoice: Invoice) => void;
  onVoid: (invoice: Invoice) => void;
}

export function InvoicesTable({
  invoices,
  isLoading,
  canManage,
  canVoid,
  hasActiveFilters,
  onDetail,
  onVoid,
}: InvoicesTableProps) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="p-3 text-left text-sm font-medium text-muted-foreground">
                  Número
                </th>
                <th className="hidden p-3 text-left text-sm font-medium text-muted-foreground sm:table-cell">
                  Tipo
                </th>
                <th className="hidden p-3 text-left text-sm font-medium text-muted-foreground md:table-cell">
                  Cliente
                </th>
                <th className="p-3 text-right text-sm font-medium text-muted-foreground">
                  Total
                </th>
                <th className="hidden p-3 text-left text-sm font-medium text-muted-foreground sm:table-cell">
                  Estado ante SUNAT
                </th>
                <th className="hidden p-3 text-right text-sm font-medium text-muted-foreground lg:table-cell">
                  Emitido
                </th>
                <th className="p-3 text-right text-sm font-medium text-muted-foreground">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b">
                    <td className="p-3"><Skeleton className="h-4 w-28" /></td>
                    <td className="hidden p-3 sm:table-cell"><Skeleton className="h-4 w-16" /></td>
                    <td className="hidden p-3 md:table-cell"><Skeleton className="h-4 w-32" /></td>
                    <td className="p-3"><Skeleton className="ml-auto h-4 w-16" /></td>
                    <td className="hidden p-3 sm:table-cell"><Skeleton className="h-5 w-32" /></td>
                    <td className="hidden p-3 lg:table-cell"><Skeleton className="ml-auto h-4 w-24" /></td>
                    <td className="p-3"><Skeleton className="ml-auto h-10 w-40" /></td>
                  </tr>
                ))
              ) : invoices.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-10 text-center">
                    <p className="text-sm font-medium">
                      {hasActiveFilters
                        ? "Ningún comprobante coincide con estos filtros"
                        : "Todavía no se ha emitido ningún comprobante"}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {hasActiveFilters
                        ? "Prueba a ampliar el rango de fechas o a quitar el filtro de estado."
                        : "Los comprobantes se emiten desde la pantalla de Cobros, con el botón «Comprobante» de cada venta."}
                    </p>
                  </td>
                </tr>
              ) : (
                invoices.map((invoice) => {
                  const anulado = invoice.sunat_status === "voided";
                  return (
                    <tr
                      key={invoice.id}
                      className="border-b transition-colors last:border-0 hover:bg-muted/50"
                    >
                      <td className="p-3 align-top">
                        <p
                          className={cn(
                            "font-medium tabular-nums",
                            anulado && "text-muted-foreground line-through",
                          )}
                        >
                          {invoice.numero_completo}
                        </p>
                        {/* En móvil desaparecen columnas: el resumen no puede
                            desaparecer con ellas. */}
                        <p className="mt-1 text-xs text-muted-foreground sm:hidden">
                          {INVOICE_TYPE_LABELS[invoice.type]} · {invoice.customer_name}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground md:hidden">
                          {formatDate(invoice.created_at)}
                        </p>
                        <div className="mt-1 sm:hidden">
                          <SunatStatusBadge
                            status={invoice.sunat_status}
                            label={invoice.sunat_status_label}
                          />
                        </div>
                      </td>
                      <td className="hidden p-3 align-top text-sm sm:table-cell">
                        {INVOICE_TYPE_LABELS[invoice.type]}
                      </td>
                      <td className="hidden p-3 align-top text-sm md:table-cell">
                        <p>{invoice.customer_name}</p>
                        <p className="text-xs uppercase text-muted-foreground">
                          {invoice.customer_doc_type} {invoice.customer_doc_number}
                        </p>
                      </td>
                      <td
                        className={cn(
                          "p-3 text-right align-top text-sm font-medium tabular-nums",
                          anulado && "text-muted-foreground line-through",
                        )}
                      >
                        {formatCurrency(invoice.total)}
                      </td>
                      <td className="hidden max-w-[18rem] p-3 align-top sm:table-cell">
                        <SunatStatusBadge
                          status={invoice.sunat_status}
                          label={invoice.sunat_status_label}
                        />
                        {(invoice.sunat_status === "rejected" ||
                          invoice.sunat_status === "error") && (
                          <SunatRejectionReason
                            code={invoice.sunat_code}
                            description={invoice.sunat_description}
                            className="mt-1"
                          />
                        )}
                      </td>
                      <td className="hidden p-3 text-right align-top text-sm text-muted-foreground lg:table-cell">
                        {formatDate(invoice.created_at)}
                      </td>
                      <td className="p-3 align-top">
                        <InvoiceActions
                          invoice={invoice}
                          canManage={canManage}
                          canVoid={canVoid}
                          onDetail={onDetail}
                          onVoid={onVoid}
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
