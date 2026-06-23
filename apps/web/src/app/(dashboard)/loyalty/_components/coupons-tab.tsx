"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
} from "@restai/ui/components/card";
import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
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
import { DatePicker } from "@restai/ui/components/date-picker";
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
  Pencil,
  Layers,
} from "lucide-react";
import {
  useCoupons,
  useDeleteCoupon,
  useUpdateCoupon,
  useCouponAssignments,
  useAssignCoupon,
  useBulkCreateCoupons,
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

// Derive the real status from expires_at (a coupon may be stored as "active"
// but already past its expiry date). Returns one of: active | inactive | expired.
function effectiveCouponStatus(coupon: any): string {
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
    return "expired";
  }
  return coupon.status ?? "inactive";
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

  const customers: any[] = customersData?.customers ?? [];
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

// Convert a "S/" soles string into integer centimos (money is stored as ints).
function parseSolesToCents(value: string): number {
  const normalized = value.replace(",", ".").trim();
  if (!normalized) return 0;
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

type BulkFormState = {
  count: number;
  prefix: string;
  type: string;
  discountValue: number; // percentage points OR centimos (for "fixed")
  fixedInput: string; // soles string mirror for the "fixed" type
  minOrderAmount: number; // centimos
  maxDiscountAmount: number; // centimos
  startsAt: string;
  expiresAt: string;
};

function emptyBulkForm(): BulkFormState {
  return {
    count: 10,
    prefix: "PROMO",
    type: "percentage",
    discountValue: 10,
    fixedInput: "5.00",
    minOrderAmount: 0,
    maxDiscountAmount: 0,
    startsAt: "",
    expiresAt: "",
  };
}

// Normalize the various shapes the bulk endpoint might return into a single
// { count, codes } view-model. `data` is whatever apiFetch unwraps from the
// response's `data` field.
function extractBatch(data: any): { count: number; codes: string[]; batchId?: string } {
  const coupons: any[] = Array.isArray(data?.coupons)
    ? data.coupons
    : Array.isArray(data)
      ? data
      : [];
  const codes: string[] = coupons
    .map((c) => (typeof c === "string" ? c : c?.code))
    .filter(Boolean);
  const count =
    typeof data?.count === "number"
      ? data.count
      : typeof data?.created === "number"
        ? data.created
        : codes.length;
  const batchId = data?.batch_id ?? data?.batchId;
  return { count, codes, batchId };
}

function BulkCouponDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const bulkCreate = useBulkCreateCoupons();
  const [form, setForm] = useState<BulkFormState>(() => emptyBulkForm());
  const [result, setResult] = useState<{ count: number; codes: string[]; batchId?: string } | null>(null);

  // Reset the form (and any previous result) whenever the dialog opens.
  useEffect(() => {
    if (open) {
      setForm(emptyBulkForm());
      setResult(null);
    }
  }, [open]);

  function handleGenerate(e: React.FormEvent) {
    e.preventDefault();

    const payload: any = {
      count: form.count,
      prefix: form.prefix.toUpperCase().trim() || undefined,
      type: form.type,
    };

    if (["percentage", "fixed", "item_discount", "category_discount"].includes(form.type)) {
      payload.discountValue =
        form.type === "fixed" ? parseSolesToCents(form.fixedInput) : form.discountValue;
    }
    if (form.minOrderAmount > 0) payload.minOrderAmount = form.minOrderAmount;
    if (form.maxDiscountAmount > 0) payload.maxDiscountAmount = form.maxDiscountAmount;
    if (form.startsAt) payload.startsAt = form.startsAt;
    if (form.expiresAt) payload.expiresAt = form.expiresAt;

    bulkCreate.mutate(payload, {
      onSuccess: (data: any) => {
        const batch = extractBatch(data);
        setResult(batch);
        toast.success(`${batch.count} cupon(es) generado(s)`);
      },
      onError: (err) => toast.error(`Error: ${(err as Error).message}`),
    });
  }

  function handleCopyAll() {
    if (!result || result.codes.length === 0) return;
    navigator.clipboard.writeText(result.codes.join("\n"));
    toast.success(`${result.codes.length} codigo(s) copiado(s)`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generar lote de cupones</DialogTitle>
        </DialogHeader>

        {result ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-green-200 bg-green-50 dark:border-green-900/40 dark:bg-green-900/20 p-4">
              <p className="text-sm font-medium text-green-800 dark:text-green-300">
                {result.count} cupon(es) generado(s) exitosamente
              </p>
              {result.batchId && (
                <p className="text-xs text-green-700/80 dark:text-green-400/80 mt-1 font-mono">
                  Lote: {result.batchId}
                </p>
              )}
            </div>

            {result.codes.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Codigos generados</Label>
                  <Button type="button" variant="outline" size="sm" onClick={handleCopyAll}>
                    <Copy className="h-3.5 w-3.5 mr-1.5" />
                    Copiar todos
                  </Button>
                </div>
                <div className="max-h-56 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3">
                  <div className="grid grid-cols-2 gap-1.5">
                    {result.codes.map((code) => (
                      <button
                        key={code}
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(code);
                          toast.success(`Codigo "${code}" copiado`);
                        }}
                        className="flex items-center gap-1 font-mono text-xs font-medium text-foreground hover:text-primary transition-colors text-left"
                        title="Copiar codigo"
                      >
                        <Copy className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="truncate">{code}</span>
                      </button>
                    ))}
                  </div>
                </div>
                {result.codes.length < result.count && (
                  <p className="text-xs text-muted-foreground">
                    Mostrando {result.codes.length} de {result.count} codigos.
                  </p>
                )}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setResult(null)}>
                Generar otro lote
              </Button>
              <Button onClick={() => onOpenChange(false)}>Listo</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleGenerate} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="blk-count">Cantidad *</Label>
                <Input
                  id="blk-count"
                  type="number"
                  min={1}
                  max={1000}
                  value={form.count}
                  onChange={(e) => setForm((p) => ({ ...p, count: parseInt(e.target.value) || 0 }))}
                  required
                />
                <p className="text-xs text-muted-foreground">Maximo 1000 por lote</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="blk-prefix">Prefijo</Label>
                <Input
                  id="blk-prefix"
                  value={form.prefix}
                  onChange={(e) => setForm((p) => ({ ...p, prefix: e.target.value.toUpperCase() }))}
                  placeholder="Ej: PROMO"
                />
                <p className="text-xs text-muted-foreground">Ej: PROMO-A1B2</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="blk-type">Tipo de cupon</Label>
              <Select
                value={form.type}
                onValueChange={(v) =>
                  setForm((p) => ({
                    ...p,
                    type: v,
                    discountValue:
                      v === "percentage" || v === "item_discount" || v === "category_discount"
                        ? 10
                        : p.discountValue,
                  }))
                }
              >
                <SelectTrigger id="blk-type">
                  <SelectValue placeholder="Tipo de cupon" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">Porcentaje de descuento (%)</SelectItem>
                  <SelectItem value="fixed">Monto fijo de descuento</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.type === "percentage" && (
              <div className="space-y-2">
                <Label htmlFor="blk-pct">Porcentaje de descuento</Label>
                <Input
                  id="blk-pct"
                  type="number"
                  min={1}
                  max={100}
                  value={form.discountValue}
                  onChange={(e) => setForm((p) => ({ ...p, discountValue: parseInt(e.target.value) || 0 }))}
                />
                <p className="text-xs text-muted-foreground">Ej: 10 = 10% de descuento</p>
              </div>
            )}

            {form.type === "fixed" && (
              <div className="space-y-2">
                <Label htmlFor="blk-fixed">Monto de descuento (S/)</Label>
                <Input
                  id="blk-fixed"
                  type="number"
                  min={0.01}
                  step={0.01}
                  value={form.fixedInput}
                  onChange={(e) => setForm((p) => ({ ...p, fixedInput: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">
                  En soles: 5.00 = S/ 5. Se guarda internamente como centimos.
                </p>
              </div>
            )}

            <div className="border-t border-border pt-4 space-y-4">
              <p className="text-sm font-medium text-foreground">Restricciones (opcional)</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="blk-min">Pedido minimo (centimos)</Label>
                  <Input
                    id="blk-min"
                    type="number"
                    min={0}
                    value={form.minOrderAmount}
                    onChange={(e) => setForm((p) => ({ ...p, minOrderAmount: parseInt(e.target.value) || 0 }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="blk-maxd">Descuento maximo (centimos)</Label>
                  <Input
                    id="blk-maxd"
                    type="number"
                    min={0}
                    value={form.maxDiscountAmount}
                    onChange={(e) => setForm((p) => ({ ...p, maxDiscountAmount: parseInt(e.target.value) || 0 }))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Fecha inicio</Label>
                  <DatePicker
                    value={form.startsAt}
                    onChange={(v) => setForm((p) => ({ ...p, startsAt: v ?? "" }))}
                    placeholder="Seleccionar..."
                  />
                </div>
                <div className="space-y-2">
                  <Label>Fecha fin</Label>
                  <DatePicker
                    value={form.expiresAt}
                    onChange={(v) => setForm((p) => ({ ...p, expiresAt: v ?? "" }))}
                    placeholder="Seleccionar..."
                  />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={bulkCreate.isPending || form.count < 1}>
                {bulkCreate.isPending ? "Generando..." : `Generar ${form.count > 0 ? form.count : ""} cupones`}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function CouponsTab() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  // Status is filtered client-side so the "Expirado" state (derived from
  // expires_at) is honored — the API only knows the stored status column.
  const { data, isLoading, error, refetch } = useCoupons({
    type: typeFilter === "all" ? undefined : typeFilter,
  });
  const deleteCoupon = useDeleteCoupon();
  const updateCoupon = useUpdateCoupon();
  const [showCreate, setShowCreate] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [editCoupon, setEditCoupon] = useState<any>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [assignCouponData, setAssignCouponData] = useState<any>(null);

  const allCoupons: any[] = data ?? [];
  const couponsList: any[] =
    statusFilter === "all"
      ? allCoupons
      : allCoupons.filter((c) => effectiveCouponStatus(c) === statusFilter);

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
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={() => setShowBulk(true)}>
            <Layers className="h-4 w-4 mr-2" />Generar lote
          </Button>
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
            const status = effectiveCouponStatus(coupon);
            const statusInfo = couponStatusLabels[status] || couponStatusLabels.inactive;
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
                        onClick={() => setEditCoupon(coupon)}
                        className="p-1.5 rounded hover:bg-muted"
                        title="Editar cupon"
                      >
                        <Pencil className="h-4 w-4 text-muted-foreground" />
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
                      {statusInfo.label}
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

      <BulkCouponDialog open={showBulk} onOpenChange={setShowBulk} />

      {editCoupon && (
        <CreateCouponDialog
          key={editCoupon.id}
          open={!!editCoupon}
          onOpenChange={(v) => { if (!v) setEditCoupon(null); }}
          editData={editCoupon}
        />
      )}

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
