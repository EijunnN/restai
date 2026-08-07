"use client";

import { useState } from "react";
import { Button } from "@restai/ui/components/button";
import { RefreshCw } from "lucide-react";
import { useOrders, useUpdateOrderStatus } from "@/hooks/use-orders";
import { useOrgSettings, useBranchSettings } from "@/hooks/use-settings";
import { usePrintReceipt } from "@/components/print-ticket";
import { apiFetch } from "@/lib/fetcher";
import { useAuthStore } from "@/stores/auth-store";
import { hasAllPermissions } from "@/lib/permissions";
import { PageHeader } from "@/components/page-header";
import { OrderFilters } from "./_components/order-filters";
import { OrdersTable } from "./_components/orders-table";
import { ShiftClockButton } from "../staff/_components/shift-clock-button";
import { PaymentDialog } from "../payments/_components/payment-dialog";

const PAGE_SIZE = 20;

export default function OrdersPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [chargeOrderId, setChargeOrderId] = useState<string | null>(null);

  // Esta pantalla la abre cualquier rol con `orders:read`, cocina incluida, que
  // NO puede cobrar. Cobrar exige las dos cosas: `payments:create` para
  // registrar el cobro y `payments:read` para que el diálogo pueda listar las
  // órdenes con saldo. Sin esta comprobación se pintaba "Cobrar" a la cocina y
  // el diálogo moría en dos 403 seguidos.
  const user = useAuthStore((s) => s.user);
  const puedeCobrar = hasAllPermissions(user?.role, ["payments:create", "payments:read"]);

  const { data, isLoading, error, refetch } = useOrders({ status: statusFilter, page, limit: PAGE_SIZE });
  const updateStatus = useUpdateOrderStatus();
  const { data: orgSettings } = useOrgSettings();
  const { data: branchSettings } = useBranchSettings();
  const printReceipt = usePrintReceipt();
  const updatingOrderId = updateStatus.isPending ? updateStatus.variables?.id ?? null : null;
  const updatingTargetStatus = updateStatus.isPending ? updateStatus.variables?.status ?? null : null;

  const handlePrintReceipt = async (order: any) => {
    try {
      const orderDetail = await apiFetch(`/api/orders/${order.id}`);
      const org = orgSettings as any;
      const branch = branchSettings as any;
      const items = (orderDetail as any)?.items || [];
      printReceipt({
        businessName: org?.name || "Restaurante",
        ruc: org?.settings?.ruc || undefined,
        address: branch?.address || undefined,
        orderNumber: order.order_number || order.id,
        createdAt: order.created_at || new Date().toISOString(),
        items: items.map((i: any) => ({
          name: i.name,
          quantity: i.quantity,
          unit_price: i.unit_price,
          total: i.total,
        })),
        subtotal: order.subtotal ?? 0,
        tax: order.tax ?? 0,
        total: order.total ?? 0,
        customerName: order.customer_name || undefined,
      });
    } catch {
      const org = orgSettings as any;
      printReceipt({
        businessName: org?.name || "Restaurante",
        orderNumber: order.order_number || order.id,
        createdAt: order.created_at || new Date().toISOString(),
        items: [],
        subtotal: order.subtotal ?? 0,
        tax: order.tax ?? 0,
        total: order.total ?? 0,
        customerName: order.customer_name || undefined,
      });
    }
  };

  const orders: any[] = data?.orders ?? [];
  const pagination = data?.pagination ?? { page: 1, limit: PAGE_SIZE, total: 0, totalPages: 1 };

  const handleStatusFilter = (status: string) => {
    setStatusFilter(status);
    setPage(1);
  };

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Órdenes" />
        <div className="p-4 rounded-lg border border-destructive/50 bg-destructive/5 flex items-center justify-between">
          <p className="text-sm text-destructive">Error al cargar ordenes: {(error as Error).message}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Órdenes"
        description="Gestiona y rastrea todas las órdenes"
        actions={<ShiftClockButton />}
      />

      <OrderFilters
        search={search}
        onSearchChange={setSearch}
        statusFilter={statusFilter}
        onStatusFilterChange={handleStatusFilter}
      />

      <OrdersTable
        orders={orders}
        isLoading={isLoading}
        search={search}
        pagination={pagination}
        page={page}
        onPageChange={setPage}
        updateStatusPending={updateStatus.isPending}
        updatingOrderId={updatingOrderId}
        updatingTargetStatus={updatingTargetStatus}
        activeChargeOrderId={chargeOrderId}
        onUpdateStatus={(id, status) => updateStatus.mutate({ id, status })}
        onPrintReceipt={handlePrintReceipt}
        onCharge={puedeCobrar ? (order) => setChargeOrderId(order.id) : undefined}
      />

      {/* El diálogo se MONTA solo al pulsar "Cobrar". Estando siempre montado,
          sus hooks se ejecutaban aunque estuviera cerrado y disparaban
          GET /api/payments/unpaid-orders en cada carga de la pantalla: un 403
          garantizado para quien entra aquí sin `payments:read`. */}
      {chargeOrderId && (
        <PaymentDialog
          open
          onOpenChange={(v) => { if (!v) setChargeOrderId(null); }}
          preselectedOrderId={chargeOrderId}
        />
      )}
    </div>
  );
}
