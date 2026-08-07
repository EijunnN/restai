"use client";

import { useMemo, useState } from "react";
import { Button } from "@restai/ui/components/button";
import { Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  usePayments,
  usePaymentSummary,
  type Payment,
  type PaymentBucket,
  type PaymentMethod,
} from "@/hooks/use-payments";
import { useAuthStore } from "@/stores/auth-store";
import { hasPermission } from "@/lib/permissions";
import { downloadCsv, csvMoney } from "@/lib/csv";
import { limaTodayRange, formatCivilDate } from "@/lib/date";
import { formatDate, cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { PaymentSummary } from "./_components/payment-summary";
import { PaymentFilters, METHOD_LABELS } from "./_components/payment-filters";
import { PaymentsTable } from "./_components/payments-table";
import { PaymentDialog } from "./_components/payment-dialog";
import { ReceiptDialog } from "./_components/receipt-dialog";
import { InvoiceDialog } from "./_components/invoice-dialog";
import { VoidPaymentDialog } from "./_components/void-payment-dialog";

/** Etiqueta contable de la fila, la misma que ve el usuario en la tabla. */
function estadoLegible(payment: Payment): string {
  if (payment.voided) return "Anulado";
  if (payment.status === "pending") return "Pendiente";
  if (payment.status === "failed") return "Fallido";
  return "Cobrado";
}

export default function PaymentsPage() {
  const user = useAuthStore((s) => s.user);
  const canVoid = hasPermission(user?.role, "payments:void");
  const canCreate = hasPermission(user?.role, "payments:create");
  // Emitir el comprobante exige `invoices:create`: sin esta comprobación el
  // botón se pintaba para todo el mundo y moría en un 403 del servidor.
  const canInvoice = hasPermission(user?.role, "invoices:create");

  // El rango arranca en HOY (día civil de Lima, no del dispositivo) para que la
  // lista y el resumen de arriba hablen exactamente del mismo día.
  const [range, setRange] = useState(() => limaTodayRange());
  const [bucket, setBucket] = useState<PaymentBucket>("all");
  const [method, setMethod] = useState<PaymentMethod | "all">("all");
  const [search, setSearch] = useState("");

  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [receiptDialogOpen, setReceiptDialogOpen] = useState(false);
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);

  const { data, isLoading, isFetching, error, refetch } = usePayments({
    bucket,
    method: method === "all" ? undefined : method,
    startDate: range.start,
    endDate: range.end,
  });
  const {
    data: summary,
    isLoading: summaryLoading,
    error: summaryError,
    refetch: refetchSummary,
  } = usePaymentSummary();

  const payments = useMemo(() => data?.data ?? [], [data]);
  const totals = data?.meta?.totals;

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return payments;
    return payments.filter(
      (p) =>
        (p.order_number ?? "").toLowerCase().includes(term) ||
        (p.reference ?? "").toLowerCase().includes(term) ||
        (p.cashier_name ?? "").toLowerCase().includes(term),
    );
  }, [payments, search]);

  const hasActiveFilters =
    bucket !== "all" || method !== "all" || search.trim().length > 0;

  /**
   * La API devuelve como mucho 100 cobros por consulta. Si el rango tiene más,
   * hay que DECIRLO: exportar 100 filas creyendo que son todas las del mes es
   * un error contable, no un detalle de interfaz.
   */
  const LIMITE_API = 100;
  const listaRecortada = payments.length >= LIMITE_API;

  const openDialog = (payment: Payment, setter: (open: boolean) => void) => {
    setSelectedPayment(payment);
    setter(true);
  };

  const handleExport = () => {
    if (filtered.length === 0) {
      toast.error("No hay cobros que exportar con los filtros actuales");
      return;
    }
    downloadCsv(
      `cobros_${range.start}_${range.end}`,
      [
        { header: "Fecha", value: (p: Payment) => formatDate(p.created_at) },
        { header: "Orden", value: (p: Payment) => p.order_number ?? "" },
        { header: "Método", value: (p: Payment) => METHOD_LABELS[p.method] ?? p.method },
        { header: "Estado", value: (p: Payment) => estadoLegible(p) },
        { header: "Monto (S/)", value: (p: Payment) => csvMoney(p.amount) },
        { header: "Propina (S/)", value: (p: Payment) => csvMoney(p.tip) },
        { header: "Cajero", value: (p: Payment) => p.cashier_name ?? "" },
        { header: "Referencia", value: (p: Payment) => p.reference ?? "" },
        { header: "Motivo de anulación", value: (p: Payment) => p.void_reason ?? "" },
      ],
      filtered,
    );
    if (listaRecortada) {
      toast.warning(
        `Se exportaron ${filtered.length} cobros: son los ${LIMITE_API} más recientes del rango, no todos. Acorta las fechas para exportar el resto.`,
      );
    } else {
      toast.success(`${filtered.length} cobros exportados`);
    }
  };

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Cobros" description="Cobros registrados en esta sede" />
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-destructive/50 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <p className="font-medium text-destructive">No se pudieron cargar los cobros</p>
            <p className="text-sm text-muted-foreground">{(error as Error).message}</p>
          </div>
          <Button variant="outline" className="h-10" onClick={() => refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cobros"
        description={
          isLoading
            ? "Cargando..."
            : `${filtered.length} cobros del ${formatCivilDate(range.start)} al ${formatCivilDate(range.end)}`
        }
        actions={
          <>
            <Button
              variant="outline"
              className="h-10"
              onClick={() => refetch()}
              disabled={isFetching}
              aria-label="Actualizar el listado de cobros"
            >
              <RefreshCw className={cn("mr-2 h-4 w-4", isFetching && "animate-spin")} />
              Actualizar
            </Button>
            {canCreate && (
              <Button className="h-10" onClick={() => setPaymentDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Registrar cobro
              </Button>
            )}
          </>
        }
      />

      {/* Si el resumen falla NO se pintan ceros: un "Total cobrado S/ 0,00"
          falso es peor que no enseñar nada, porque el cajero se lo cree. */}
      {summaryError ? (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-destructive/50 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <p className="font-medium text-destructive">
              No se pudo cargar el resumen del día
            </p>
            <p className="text-sm text-muted-foreground">
              {(summaryError as Error).message}
            </p>
          </div>
          <Button variant="outline" className="h-10" onClick={() => refetchSummary()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Reintentar
          </Button>
        </div>
      ) : (
        <PaymentSummary summary={summary} isLoading={summaryLoading} />
      )}

      <PaymentFilters
        bucket={bucket}
        onBucketChange={setBucket}
        method={method}
        onMethodChange={setMethod}
        startDate={range.start}
        endDate={range.end}
        onRangeChange={setRange}
        search={search}
        onSearchChange={setSearch}
        totals={totals}
        onExport={handleExport}
        exportDisabled={isLoading || filtered.length === 0}
      />

      <PaymentsTable
        payments={filtered}
        isLoading={isLoading}
        canVoid={canVoid}
        canInvoice={canInvoice}
        hasActiveFilters={hasActiveFilters}
        onInvoice={(p) => openDialog(p, setInvoiceDialogOpen)}
        onReceipt={(p) => openDialog(p, setReceiptDialogOpen)}
        onVoid={(p) => openDialog(p, setVoidDialogOpen)}
      />

      {listaRecortada && (
        <p className="text-sm text-muted-foreground">
          Se muestran los {LIMITE_API} cobros más recientes del rango. Para ver
          los anteriores, acorta las fechas. Las cifras de arriba sí cuentan
          todo el rango.
        </p>
      )}

      <PaymentDialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen} />

      <ReceiptDialog
        open={receiptDialogOpen}
        onOpenChange={setReceiptDialogOpen}
        payment={selectedPayment}
      />

      <InvoiceDialog
        open={invoiceDialogOpen}
        onOpenChange={setInvoiceDialogOpen}
        payment={selectedPayment}
      />

      <VoidPaymentDialog
        open={voidDialogOpen}
        onOpenChange={setVoidDialogOpen}
        payment={selectedPayment}
      />
    </div>
  );
}
