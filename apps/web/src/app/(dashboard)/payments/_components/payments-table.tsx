"use client";

import { Card, CardContent } from "@restai/ui/components/card";
import { Badge } from "@restai/ui/components/badge";
import { Button } from "@restai/ui/components/button";
import {
  DollarSign,
  CreditCard,
  Smartphone,
  Banknote,
  FileText,
  Printer,
  Ban,
  Clock,
} from "lucide-react";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import type { Payment, PaymentMethod } from "@/hooks/use-payments";
import { METHOD_LABELS } from "./payment-filters";

const METHOD_ICONS: Record<PaymentMethod, React.ReactNode> = {
  cash: <Banknote className="h-4 w-4" />,
  card: <CreditCard className="h-4 w-4" />,
  yape: <Smartphone className="h-4 w-4" />,
  plin: <Smartphone className="h-4 w-4" />,
  transfer: <DollarSign className="h-4 w-4" />,
  other: <DollarSign className="h-4 w-4" />,
};

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-muted", className)} />;
}

/**
 * Estado contable de la fila.
 *
 * Un cobro anulado y uno pendiente de delivery NO son dinero en caja, pero
 * hasta ahora se pintaban igual que un cobro real: la lista sumaba más que el
 * resumen del mismo día y nadie sabía cuál de las dos cifras era la buena.
 */
function StatusBadge({ payment }: { payment: Payment }) {
  if (payment.voided) {
    return (
      <Badge variant="destructive" className="gap-1">
        <Ban className="h-3 w-3" />
        Anulado
      </Badge>
    );
  }
  if (payment.status === "pending") {
    return (
      <Badge variant="outline" className="gap-1 border-amber-500/60 text-amber-600">
        <Clock className="h-3 w-3" />
        Pendiente
      </Badge>
    );
  }
  if (payment.status === "failed") {
    return <Badge variant="outline">Fallido</Badge>;
  }
  return (
    <Badge variant="secondary" className="text-green-700 dark:text-green-400">
      Cobrado
    </Badge>
  );
}

interface PaymentsTableProps {
  payments: Payment[];
  isLoading: boolean;
  onInvoice: (payment: Payment) => void;
  onReceipt: (payment: Payment) => void;
  onVoid: (payment: Payment) => void;
  /** Solo se pinta "Anular" si el rol tiene `payments:void`. */
  canVoid: boolean;
  /** Solo se pinta "Comprobante" si el rol tiene `invoices:create`. */
  canInvoice: boolean;
  /** Para distinguir "no hay cobros" de "no hay cobros con estos filtros". */
  hasActiveFilters: boolean;
}

export function PaymentsTable({
  payments,
  isLoading,
  onInvoice,
  onReceipt,
  onVoid,
  canVoid,
  canInvoice,
  hasActiveFilters,
}: PaymentsTableProps) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="p-3 text-left text-sm font-medium text-muted-foreground">
                  Orden
                </th>
                <th className="hidden p-3 text-left text-sm font-medium text-muted-foreground sm:table-cell">
                  Método
                </th>
                <th className="p-3 text-right text-sm font-medium text-muted-foreground">
                  Monto
                </th>
                <th className="hidden p-3 text-right text-sm font-medium text-muted-foreground md:table-cell">
                  Propina
                </th>
                <th className="hidden p-3 text-left text-sm font-medium text-muted-foreground lg:table-cell">
                  Cajero
                </th>
                <th className="hidden p-3 text-left text-sm font-medium text-muted-foreground xl:table-cell">
                  Referencia
                </th>
                <th className="hidden p-3 text-right text-sm font-medium text-muted-foreground lg:table-cell">
                  Fecha
                </th>
                <th className="hidden p-3 text-left text-sm font-medium text-muted-foreground sm:table-cell">
                  Estado
                </th>
                <th className="p-3 text-center text-sm font-medium text-muted-foreground">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b">
                    <td className="p-3"><Skeleton className="h-4 w-24" /></td>
                    <td className="hidden p-3 sm:table-cell"><Skeleton className="h-4 w-16" /></td>
                    <td className="p-3"><Skeleton className="ml-auto h-4 w-16" /></td>
                    <td className="hidden p-3 md:table-cell"><Skeleton className="ml-auto h-4 w-12" /></td>
                    <td className="hidden p-3 lg:table-cell"><Skeleton className="h-4 w-20" /></td>
                    <td className="hidden p-3 xl:table-cell"><Skeleton className="h-4 w-20" /></td>
                    <td className="hidden p-3 lg:table-cell"><Skeleton className="ml-auto h-4 w-24" /></td>
                    <td className="hidden p-3 sm:table-cell"><Skeleton className="h-6 w-20" /></td>
                    <td className="p-3"><Skeleton className="mx-auto h-10 w-24" /></td>
                  </tr>
                ))
              ) : payments.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-10 text-center">
                    <p className="text-sm font-medium">
                      {hasActiveFilters
                        ? "Ningún cobro coincide con estos filtros"
                        : "Todavía no hay cobros registrados"}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {hasActiveFilters
                        ? "Prueba a ampliar el rango de fechas o a quitar el filtro de método."
                        : "Los cobros aparecerán aquí en cuanto se registre el primero del turno."}
                    </p>
                  </td>
                </tr>
              ) : (
                payments.map((payment) => {
                  const voided = payment.voided;
                  return (
                    <tr
                      key={payment.id}
                      className={cn(
                        "border-b transition-colors last:border-0 hover:bg-muted/50",
                        voided && "bg-destructive/5",
                      )}
                    >
                      <td className="p-3 align-top">
                        <p className={cn("text-sm font-medium", voided && "line-through")}>
                          {payment.order_number ?? "—"}
                        </p>
                        {/* En móvil desaparecen columnas: el resumen no puede
                            desaparecer con ellas. */}
                        <p className="mt-1 text-xs text-muted-foreground sm:hidden">
                          {METHOD_LABELS[payment.method] ?? payment.method}
                          {" · "}
                          {formatDate(payment.created_at)}
                        </p>
                        <div className="mt-1 sm:hidden">
                          <StatusBadge payment={payment} />
                        </div>
                        {voided && payment.void_reason && (
                          <p className="mt-1 max-w-[22rem] text-xs text-destructive">
                            Motivo: {payment.void_reason}
                          </p>
                        )}
                      </td>
                      <td className="hidden p-3 align-top text-sm sm:table-cell">
                        <Badge variant="secondary" className="gap-1">
                          {METHOD_ICONS[payment.method]}
                          {METHOD_LABELS[payment.method] ?? payment.method}
                        </Badge>
                      </td>
                      <td
                        className={cn(
                          "p-3 text-right align-top text-sm font-medium tabular-nums",
                          voided && "text-muted-foreground line-through",
                        )}
                      >
                        {formatCurrency(payment.amount)}
                      </td>
                      <td className="hidden p-3 text-right align-top text-sm tabular-nums text-muted-foreground md:table-cell">
                        {payment.tip > 0 ? formatCurrency(payment.tip) : "—"}
                      </td>
                      <td className="hidden p-3 align-top text-sm text-muted-foreground lg:table-cell">
                        {payment.cashier_name ?? "—"}
                      </td>
                      <td className="hidden p-3 align-top text-sm text-muted-foreground xl:table-cell">
                        {payment.reference || "—"}
                      </td>
                      <td className="hidden p-3 text-right align-top text-sm text-muted-foreground lg:table-cell">
                        {formatDate(payment.created_at)}
                      </td>
                      <td className="hidden p-3 align-top sm:table-cell">
                        <StatusBadge payment={payment} />
                      </td>
                      <td className="p-3 align-top">
                        <div className="flex flex-wrap items-center justify-center gap-1">
                          {canInvoice && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-10"
                              onClick={() => onInvoice(payment)}
                              disabled={voided}
                              title={
                                voided
                                  ? "No se emite comprobante de un cobro anulado"
                                  : "Emitir comprobante electrónico"
                              }
                            >
                              <FileText className="mr-1 h-4 w-4" />
                              Comprobante
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-10 w-10 p-0"
                            onClick={() => onReceipt(payment)}
                            aria-label={`Imprimir recibo de la orden ${payment.order_number ?? ""}`}
                            title="Imprimir recibo"
                          >
                            <Printer className="h-4 w-4" />
                          </Button>
                          {canVoid && !voided && payment.status === "completed" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-10 w-10 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => onVoid(payment)}
                              aria-label={`Anular el cobro de la orden ${payment.order_number ?? ""}`}
                              title="Anular cobro"
                            >
                              <Ban className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
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
