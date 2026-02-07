"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
} from "@restai/ui/components/card";
import { Input } from "@restai/ui/components/input";
import { Button } from "@restai/ui/components/button";
import { Badge } from "@restai/ui/components/badge";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@restai/ui/components/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@restai/ui/components/dialog";
import {
  Plus,
  RefreshCw,
  CheckCircle2,
  Trash2,
  Ticket,
  Copy,
  Tag,
  Send,
  Search,
} from "lucide-react";
import {
  useCoupons,
  useDeleteCoupon,
  useUpdateCoupon,
  useCouponAssignments,
  useAssignCoupon,
} from "@/hooks/use-coupons";
import { useLoyaltyCustomers } from "@/hooks/use-loyalty";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import { CreateCouponDialog } from "./coupon-dialog";

const couponTypeLabels: Record<string, string> = {
  percentage: "Porcentaje",
  fixed: "Monto fijo",
  item_free: "Item gratis",
  item_discount: "Descuento en item",
  category_discount: "Descuento en categoria",
  buy_x_get_y: "Compra X lleva Y",
};

const couponStatusLabels: Record<string, { label: string; color: string }> = {
  active: { label: "Activo", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" },
  inactive: { label: "Inactivo", color: "bg-gray-100 text-gray-800 dark:bg-gray-700/40 dark:text-gray-300" },
  expired: { label: "Expirado", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
};

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className ?? ""}`} />;
}

function AssignCouponDialog({
  open,
  onOpenChange,
  coupon,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  coupon: any;
}) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const assignCoupon = useAssignCoupon();

  const { data: customersData, isLoading: customersLoading } = useLoyaltyCustomers(debouncedSearch || undefined);
  const { data: assignmentsData } = useCouponAssignments(coupon?.id || "");

  const customers: any[] = customersData ?? [];
  const assignments: any[] = assignmentsData ?? [];
  const assignedCustomerIds = new Set(assignments.map((a: any) => a.customer_id));

  function handleSearch(val: string) {
    setSearch(val);
    if (timer) clearTimeout(timer);
    const t = setTimeout(() => setDebouncedSearch(val), 300);
    setTimer(t);
  }

  function toggleCustomer(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function handleAssign() {
    if (selectedIds.length === 0) return;
    assignCoupon.mutate(
      { couponId: coupon.id, customerIds: selectedIds },
      {
        onSuccess: () => {
          setSelectedIds([]);
          toast.success(`Cupon asignado a ${selectedIds.length} cliente(s)`);
          onOpenChange(false);
        },
        onError: (err) => toast.error(`Error: ${(err as Error).message}`),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Asignar Cupon: {coupon?.code}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar clientes..."
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Already assigned */}
          {assignments.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">
                Ya asignados ({assignments.length}):
              </p>
              <div className="flex flex-wrap gap-1">
                {assignments.map((a: any) => (
                  <span
                    key={a.id}
                    className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground"
                  >
                    {a.customer_name || "Sin nombre"}
                    {a.seen_at && " (visto)"}
                    {a.used_at && " (usado)"}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Customer list */}
          <div className="max-h-60 overflow-y-auto border border-border rounded-lg">
            {customersLoading ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                Cargando...
              </div>
            ) : customers.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                {debouncedSearch ? "Sin resultados" : "No hay clientes"}
              </div>
            ) : (
              customers.map((cust: any) => {
                const alreadyAssigned = assignedCustomerIds.has(cust.id);
                const isSelected = selectedIds.includes(cust.id);
                return (
                  <button
                    key={cust.id}
                    disabled={alreadyAssigned}
                    onClick={() => toggleCustomer(cust.id)}
                    className={`w-full flex items-center justify-between p-3 text-left border-b border-border last:border-0 transition-colors ${
                      alreadyAssigned
                        ? "opacity-50 cursor-not-allowed bg-muted/30"
                        : isSelected
                          ? "bg-primary/10"
                          : "hover:bg-muted/50"
                    }`}
                  >
                    <div>
                      <p className="text-sm font-medium">{cust.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {cust.phone || cust.email || "Sin contacto"}
                      </p>
                    </div>
                    {alreadyAssigned ? (
                      <span className="text-xs text-muted-foreground">Asignado</span>
                    ) : isSelected ? (
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                    ) : null}
                  </button>
                );
              })
            )}
          </div>

          {selectedIds.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {selectedIds.length} cliente(s) seleccionado(s)
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleAssign}
            disabled={assignCoupon.isPending || selectedIds.length === 0}
          >
            {assignCoupon.isPending
              ? "Asignando..."
              : `Asignar (${selectedIds.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CouponsTab() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const { data, isLoading, error, refetch } = useCoupons({
    status: statusFilter === "all" ? undefined : statusFilter,
    type: typeFilter === "all" ? undefined : typeFilter,
  });
  const deleteCoupon = useDeleteCoupon();
  const updateCoupon = useUpdateCoupon();
  const [showCreate, setShowCreate] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [assignCouponData, setAssignCouponData] = useState<any>(null);

  const couponsList: any[] = data ?? [];

  function handleCopyCode(code: string) {
    navigator.clipboard.writeText(code);
    toast.success(`Codigo "${code}" copiado`);
  }

  function handleToggleStatus(coupon: any) {
    const newStatus = coupon.status === "active" ? "inactive" : "active";
    updateCoupon.mutate(
      { id: coupon.id, status: newStatus },
      {
        onSuccess: () => toast.success(`Cupon ${newStatus === "active" ? "activado" : "desactivado"}`),
        onError: (err) => toast.error(`Error: ${(err as Error).message}`),
      },
    );
  }

  function handleDelete() {
    if (!deleteConfirm) return;
    deleteCoupon.mutate(deleteConfirm.id, {
      onSuccess: () => { setDeleteConfirm(null); toast.success("Cupon eliminado"); },
      onError: (err) => toast.error(`Error: ${(err as Error).message}`),
    });
  }

  function formatCouponValue(coupon: any): string {
    switch (coupon.type) {
      case "percentage": return `${coupon.discount_value}% off`;
      case "fixed": return `${formatCurrency(coupon.discount_value)} off`;
      case "item_free": return "Item gratis";
      case "item_discount": return `${coupon.discount_value}% en item`;
      case "category_discount": return `${coupon.discount_value}% en categoria`;
      case "buy_x_get_y": return `${coupon.buy_quantity}x${coupon.get_quantity}`;
      default: return "-";
    }
  }

  if (error) {
    return (
      <div className="p-4 rounded-lg border border-destructive/50 bg-destructive/10 flex items-center justify-between">
        <p className="text-sm text-destructive">Error al cargar cupones: {(error as Error).message}</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />Reintentar
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters + Create */}
      <div className="flex flex-wrap gap-2 items-center">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Todos los estados" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            <SelectItem value="active">Activos</SelectItem>
            <SelectItem value="inactive">Inactivos</SelectItem>
            <SelectItem value="expired">Expirados</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Todos los tipos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los tipos</SelectItem>
            <SelectItem value="percentage">Porcentaje</SelectItem>
            <SelectItem value="fixed">Monto fijo</SelectItem>
            <SelectItem value="item_free">Item gratis</SelectItem>
            <SelectItem value="item_discount">Descuento en item</SelectItem>
            <SelectItem value="category_discount">Descuento en categoria</SelectItem>
            <SelectItem value="buy_x_get_y">Compra X lleva Y</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-2" />Crear Cupon
          </Button>
        </div>
      </div>

      {/* Coupon cards */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}><CardContent className="p-5"><Skeleton className="h-24 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : couponsList.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Ticket className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-1">No hay cupones creados</p>
            <p className="text-xs text-muted-foreground">Crea cupones de descuento para tus clientes</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {couponsList.map((coupon: any) => {
            const statusInfo = couponStatusLabels[coupon.status] || couponStatusLabels.inactive;
            const isExpired = coupon.expires_at && new Date(coupon.expires_at) < new Date();
            return (
              <Card key={coupon.id} className="relative overflow-hidden">
                {/* Coupon-style dashed border top */}
                <div className="border-b-2 border-dashed border-border" />
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <button
                          onClick={() => handleCopyCode(coupon.code)}
                          className="flex items-center gap-1 font-mono text-sm font-bold text-primary hover:text-primary/80 transition-colors"
                        >
                          <Copy className="h-3 w-3" />
                          {coupon.code}
                        </button>
                      </div>
                      <p className="font-medium text-foreground text-sm">{coupon.name}</p>
                      {coupon.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">{coupon.description}</p>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => setAssignCouponData(coupon)}
                        className="p-1.5 rounded hover:bg-muted"
                        title="Asignar a clientes"
                      >
                        <Send className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      </button>
                      <button
                        onClick={() => handleToggleStatus(coupon)}
                        className="p-1.5 rounded hover:bg-muted"
                        title={coupon.status === "active" ? "Desactivar" : "Activar"}
                      >
                        <CheckCircle2 className={`h-4 w-4 ${coupon.status === "active" ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`} />
                      </button>
                      <button onClick={() => setDeleteConfirm({ id: coupon.id, name: coupon.name })} className="p-1.5 rounded hover:bg-muted">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusInfo.color}`}>
                      {isExpired ? "Expirado" : statusInfo.label}
                    </span>
                    <Badge variant="secondary" className="text-xs">
                      <Tag className="h-3 w-3 mr-1" />
                      {couponTypeLabels[coupon.type] || coupon.type}
                    </Badge>
                    <Badge variant="outline" className="text-xs font-bold">
                      {formatCouponValue(coupon)}
                    </Badge>
                  </div>

                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      Usos: {coupon.current_uses}{coupon.max_uses_total ? `/${coupon.max_uses_total}` : " (ilim.)"}
                    </span>
                    {coupon.min_order_amount > 0 && (
                      <span>Min: {formatCurrency(coupon.min_order_amount)}</span>
                    )}
                  </div>

                  {(coupon.starts_at || coupon.expires_at) && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      {coupon.starts_at && (
                        <span>Desde: {new Date(coupon.starts_at).toLocaleDateString("es-PE")} </span>
                      )}
                      {coupon.expires_at && (
                        <span>Hasta: {new Date(coupon.expires_at).toLocaleDateString("es-PE")}</span>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <CreateCouponDialog open={showCreate} onOpenChange={setShowCreate} />

      {assignCouponData && (
        <AssignCouponDialog
          open={!!assignCouponData}
          onOpenChange={(v) => { if (!v) setAssignCouponData(null); }}
          coupon={assignCouponData}
        />
      )}

      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={(v) => { if (!v) setDeleteConfirm(null); }}
        title="Eliminar cupon"
        description={`Estas seguro de eliminar el cupon ${deleteConfirm?.name}?`}
        onConfirm={handleDelete}
        loading={deleteCoupon.isPending}
      />
    </div>
  );
}
