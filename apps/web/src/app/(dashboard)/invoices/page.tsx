"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@restai/ui/components/button";
import { AlertTriangle, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  fetchInvoicesPage,
  useInvoices,
  usePendingSunat,
  INVOICE_TYPE_LABELS,
  SUNAT_STATUS_LABELS,
  type Invoice,
  type InvoiceType,
  type SunatStatus,
} from "@/hooks/use-invoices";
import { useAuthStore } from "@/stores/auth-store";
import { hasPermission } from "@/lib/permissions";
import { downloadCsv, csvMoney } from "@/lib/csv";
import { limaCurrentMonthRange, formatCivilDate } from "@/lib/date";
import { formatDate, cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { InvoiceFilters } from "./_components/invoice-filters";
import { InvoicesTable } from "./_components/invoices-table";
import { InvoiceDetailDialog } from "./_components/invoice-detail-dialog";
import { VoidInvoiceDialog } from "./_components/void-invoice-dialog";

const PAGE_SIZE = 20;

/** Estados que dejan al local en incumplimiento mientras nadie los resuelva. */
const ESTADOS_SIN_RESOLVER: SunatStatus[] = ["pending", "error", "rejected"];

export default function InvoicesPage() {
  const user = useAuthStore((s) => s.user);
  const canManage = hasPermission(user?.role, "invoices:create");
  // Anular ante SUNAT y emitir notas de credito es una accion fiscal
  // irreversible y tiene su propio verbo: el mozo emite, pero no da de baja.
  const canVoid = hasPermission(user?.role, "invoices:void");

  const [range, setRange] = useState(() => limaCurrentMonthRange());
  const [type, setType] = useState<InvoiceType | "all">("all");
  const [sunatStatus, setSunatStatus] = useState<SunatStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [voidInvoice, setVoidInvoice] = useState<Invoice | null>(null);
  const [voidOpen, setVoidOpen] = useState(false);

  const { data, isLoading, isFetching, error, refetch } = useInvoices({
    type: type === "all" ? undefined : type,
    sunatStatus: sunatStatus === "all" ? undefined : sunatStatus,
    startDate: range.start,
    endDate: range.end,
    page,
    limit: PAGE_SIZE,
  });
  const { data: pendientes, error: pendientesError } = usePendingSunat();

  // Cambiar un filtro con la página 5 abierta devolvía una lista vacía que
  // parecía "no hay nada": cualquier cambio de filtro vuelve a la primera.
  useEffect(() => {
    setPage(1);
  }, [type, sunatStatus, range.start, range.end]);

  const invoices = useMemo(() => data?.data ?? [], [data]);
  const pagination = data?.pagination;

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return invoices;
    return invoices.filter(
      (inv) =>
        inv.numero_completo.toLowerCase().includes(term) ||
        inv.customer_name.toLowerCase().includes(term) ||
        inv.customer_doc_number.toLowerCase().includes(term),
    );
  }, [invoices, search]);

  const hasActiveFilters =
    type !== "all" || sunatStatus !== "all" || search.trim().length > 0;

  const sinResolver = pendientes?.sin_resolver ?? 0;

  /**
   * Exporta TODO el rango filtrado, no solo la página que se está viendo.
   *
   * El CSV acaba en la contabilidad del local: entregar 20 comprobantes de los
   * 300 del mes, con un mensaje de éxito, es peor que no exportar nada. Se
   * recorren las páginas de la API (máximo 100 por consulta) con un tope de
   * seguridad, y si se alcanza se avisa en vez de callar.
   */
  const handleExport = async () => {
    if (exporting) return;
    if ((pagination?.total ?? 0) === 0) {
      toast.error("No hay comprobantes que exportar con los filtros actuales");
      return;
    }

    setExporting(true);
    const LIMITE_API = 100;
    const MAX_PAGINAS = 20;
    const todos: Invoice[] = [];
    let truncado = false;

    try {
      for (let p = 1; p <= MAX_PAGINAS; p++) {
        const lote = await fetchInvoicesPage({
          type: type === "all" ? undefined : type,
          sunatStatus: sunatStatus === "all" ? undefined : sunatStatus,
          startDate: range.start,
          endDate: range.end,
          page: p,
          limit: LIMITE_API,
        });
        todos.push(...lote.data);
        if (p >= lote.pagination.totalPages) break;
        if (p === MAX_PAGINAS) truncado = true;
      }
    } catch (err: any) {
      setExporting(false);
      toast.error(err?.message || "No se pudo preparar la exportación");
      return;
    }

    const term = search.trim().toLowerCase();
    const filas = term
      ? todos.filter(
          (inv) =>
            inv.numero_completo.toLowerCase().includes(term) ||
            inv.customer_name.toLowerCase().includes(term) ||
            inv.customer_doc_number.toLowerCase().includes(term),
        )
      : todos;

    setExporting(false);

    if (filas.length === 0) {
      toast.error("No hay comprobantes que exportar con los filtros actuales");
      return;
    }

    downloadCsv(
      `comprobantes_${range.start}_${range.end}`,
      [
        { header: "Fecha", value: (i: Invoice) => formatDate(i.created_at) },
        { header: "Número", value: (i: Invoice) => i.numero_completo },
        { header: "Tipo", value: (i: Invoice) => INVOICE_TYPE_LABELS[i.type] },
        { header: "Cliente", value: (i: Invoice) => i.customer_name },
        {
          header: "Documento",
          value: (i: Invoice) => `${i.customer_doc_type.toUpperCase()} ${i.customer_doc_number}`,
        },
        { header: "Base imponible (S/)", value: (i: Invoice) => csvMoney(i.subtotal) },
        { header: "IGV (S/)", value: (i: Invoice) => csvMoney(i.igv) },
        { header: "Total (S/)", value: (i: Invoice) => csvMoney(i.total) },
        { header: "Estado SUNAT", value: (i: Invoice) => i.sunat_status_label },
        { header: "Código SUNAT", value: (i: Invoice) => i.sunat_code ?? "" },
        { header: "Respuesta SUNAT", value: (i: Invoice) => i.sunat_description ?? "" },
      ],
      filas,
    );

    if (truncado) {
      toast.warning(
        `Se exportaron ${filas.length} comprobantes, el máximo por descarga. Acorta el rango de fechas para obtener el resto.`,
      );
    } else {
      toast.success(`${filas.length} comprobantes exportados`);
    }
  };

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Comprobantes electrónicos"
          description="Boletas, facturas y notas emitidas en esta sede"
        />
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-destructive/50 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <p className="font-medium text-destructive">
              No se pudieron cargar los comprobantes
            </p>
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
        title="Comprobantes electrónicos"
        description={
          isLoading
            ? "Cargando..."
            : `${pagination?.total ?? 0} comprobantes del ${formatCivilDate(range.start)} al ${formatCivilDate(range.end)}`
        }
        actions={
          <Button
            variant="outline"
            className="h-10"
            onClick={() => refetch()}
            disabled={isFetching}
            aria-label="Actualizar el listado de comprobantes"
          >
            <RefreshCw className={cn("mr-2 h-4 w-4", isFetching && "animate-spin")} />
            Actualizar
          </Button>
        }
      />

      {/* Si el contador falla, decirlo: su ausencia se lee como "todo está
          declarado", que es justo la conclusión equivocada. */}
      {pendientesError && (
        <p
          role="alert"
          className="rounded-xl border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive"
        >
          No se pudo comprobar cuántos comprobantes siguen sin resolver ante
          SUNAT. Revisa la lista de abajo filtrando por estado.
        </p>
      )}

      {/* Contador de pendientes: es la alerta tributaria del módulo. */}
      {sinResolver > 0 && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-amber-500/50 bg-amber-500/10 p-4 sm:flex-row sm:items-center"
        >
          <AlertTriangle className="h-6 w-6 shrink-0 text-amber-600" />
          <div className="flex-1">
            <p className="font-semibold text-amber-700 dark:text-amber-400">
              {sinResolver === 1
                ? "1 comprobante sin resolver ante SUNAT"
                : `${sinResolver} comprobantes sin resolver ante SUNAT`}
            </p>
            <p className="text-sm text-muted-foreground">
              Mientras sigan así, esas ventas no están declaradas. Decláralas o
              reintenta el envío desde cada fila.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {ESTADOS_SIN_RESOLVER.filter((estado) => (pendientes?.por_estado?.[estado] ?? 0) > 0).map(
              (estado) => (
                <Button
                  key={estado}
                  variant={sunatStatus === estado ? "default" : "outline"}
                  size="sm"
                  className="h-10"
                  onClick={() => setSunatStatus(sunatStatus === estado ? "all" : estado)}
                >
                  {SUNAT_STATUS_LABELS[estado]} ({pendientes?.por_estado?.[estado] ?? 0})
                </Button>
              ),
            )}
          </div>
        </div>
      )}

      <InvoiceFilters
        type={type}
        onTypeChange={setType}
        sunatStatus={sunatStatus}
        onStatusChange={setSunatStatus}
        startDate={range.start}
        endDate={range.end}
        onRangeChange={setRange}
        search={search}
        onSearchChange={setSearch}
        onExport={handleExport}
        exportDisabled={isLoading || (pagination?.total ?? 0) === 0}
        exporting={exporting}
      />

      <InvoicesTable
        invoices={filtered}
        isLoading={isLoading}
        canManage={canManage}
        canVoid={canVoid}
        hasActiveFilters={hasActiveFilters}
        onDetail={(invoice) => {
          setDetailId(invoice.id);
          setDetailOpen(true);
        }}
        onVoid={(invoice) => {
          setVoidInvoice(invoice);
          setVoidOpen(true);
        }}
      />

      {pagination && pagination.total > PAGE_SIZE && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Página {pagination.page} de {Math.max(1, pagination.totalPages)} ·{" "}
            {pagination.total} comprobantes
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="h-10"
              disabled={page <= 1 || isFetching}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Anterior
            </Button>
            <Button
              variant="outline"
              className="h-10"
              disabled={page >= (pagination.totalPages ?? 1) || isFetching}
              onClick={() => setPage((p) => p + 1)}
            >
              Siguiente
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <InvoiceDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        invoiceId={detailId}
        canManage={canManage}
        canVoid={canVoid}
        onVoid={(invoice) => {
          setVoidInvoice(invoice);
          setVoidOpen(true);
        }}
      />

      <VoidInvoiceDialog
        open={voidOpen}
        onOpenChange={setVoidOpen}
        invoice={voidInvoice}
      />
    </div>
  );
}
