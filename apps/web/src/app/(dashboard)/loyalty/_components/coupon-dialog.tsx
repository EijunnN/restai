"use client";

import { useEffect, useState } from "react";
import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
import { Button } from "@restai/ui/components/button";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@restai/ui/components/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@restai/ui/components/dialog";
import { DatePicker } from "@restai/ui/components/date-picker";
import { RefreshCw } from "lucide-react";
import { useCreateCoupon, useUpdateCoupon } from "@/hooks/use-coupons";
import { useMenuItems, useCategories } from "@/hooks/use-menu";
import { toast } from "sonner";

const couponTypeLabels: Record<string, string> = {
  percentage: "Porcentaje de descuento (%)",
  fixed: "Monto fijo de descuento",
  item_free: "Item gratis",
  item_discount: "Descuento en item especifico",
  category_discount: "Descuento en categoria",
  buy_x_get_y: "Compra X lleva Y",
};

function generateCouponCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "REST-";
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function parseSolesToCents(value: string): number {
  const normalizedValue = value.replace(",", ".").trim();

  if (!normalizedValue) {
    return 0;
  }

  const numericValue = Number(normalizedValue);

  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return 0;
  }

  return Math.round(numericValue * 100);
}

function formatCentsToSoles(value: number): string {
  return (value / 100).toFixed(2);
}

// Convert an ISO/date string from the API into a YYYY-MM-DD string for DatePicker.
function toDateInputValue(value: any): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

type FormState = {
  code: string;
  name: string;
  description: string;
  type: string;
  discountValue: number;
  menuItemId: string;
  categoryId: string;
  buyQuantity: number;
  getQuantity: number;
  minOrderAmount: number;
  maxDiscountAmount: number;
  maxUsesTotal: number;
  maxUsesPerCustomer: number;
  startsAt: string;
  expiresAt: string;
};

function emptyForm(): FormState {
  return {
    code: generateCouponCode(),
    name: "",
    description: "",
    type: "percentage",
    discountValue: 10,
    menuItemId: "",
    categoryId: "",
    buyQuantity: 2,
    getQuantity: 1,
    minOrderAmount: 0,
    maxDiscountAmount: 0,
    maxUsesTotal: 0,
    maxUsesPerCustomer: 1,
    startsAt: "",
    expiresAt: "",
  };
}

// Map an existing coupon (snake_case from API) into the editable form state.
function couponToForm(coupon: any): FormState {
  return {
    code: coupon.code ?? "",
    name: coupon.name ?? "",
    description: coupon.description ?? "",
    type: coupon.type ?? "percentage",
    discountValue: coupon.discount_value ?? 0,
    menuItemId: coupon.menu_item_id ?? "",
    categoryId: coupon.category_id ?? "",
    buyQuantity: coupon.buy_quantity ?? 2,
    getQuantity: coupon.get_quantity ?? 1,
    minOrderAmount: coupon.min_order_amount ?? 0,
    maxDiscountAmount: coupon.max_discount_amount ?? 0,
    maxUsesTotal: coupon.max_uses_total ?? 0,
    maxUsesPerCustomer: coupon.max_uses_per_customer ?? 1,
    startsAt: toDateInputValue(coupon.starts_at),
    expiresAt: toDateInputValue(coupon.expires_at),
  };
}

export function CreateCouponDialog({
  open,
  onOpenChange,
  editData,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editData?: any;
}) {
  const isEdit = !!editData;
  const createCoupon = useCreateCoupon();
  const updateCoupon = useUpdateCoupon();
  const isPending = isEdit ? updateCoupon.isPending : createCoupon.isPending;
  const { data: menuItemsData } = useMenuItems();
  const { data: categoriesData } = useCategories();
  const menuItems: any[] = menuItemsData ?? [];
  const categories: any[] = categoriesData ?? [];
  const [form, setForm] = useState<FormState>(() =>
    editData ? couponToForm(editData) : emptyForm(),
  );
  const [fixedDiscountInput, setFixedDiscountInput] = useState(() =>
    editData && editData.type === "fixed"
      ? formatCentsToSoles(editData.discount_value ?? 0)
      : formatCentsToSoles(50),
  );

  // Re-sync form whenever the dialog is opened (so prefill stays correct when
  // switching between create and edit, or editing a different coupon).
  useEffect(() => {
    if (!open) return;
    if (editData) {
      setForm(couponToForm(editData));
      setFixedDiscountInput(
        editData.type === "fixed"
          ? formatCentsToSoles(editData.discount_value ?? 0)
          : formatCentsToSoles(50),
      );
    } else {
      setForm(emptyForm());
      setFixedDiscountInput(formatCentsToSoles(50));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editData?.id]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (isEdit) {
      // Code and type are immutable on the backend PATCH; only send mutable fields.
      // description is non-nullable in the update schema, so send a plain string
      // (empty string clears it; never null).
      const payload: any = {
        id: editData.id,
        name: form.name,
        description: form.description,
      };

      if (["percentage", "fixed", "item_discount", "category_discount"].includes(form.type)) {
        payload.discountValue = form.type === "fixed" ? parseSolesToCents(fixedDiscountInput) : form.discountValue;
      }
      if (["item_free", "item_discount"].includes(form.type)) {
        payload.menuItemId = form.menuItemId || null;
      }
      if (form.type === "category_discount") {
        payload.categoryId = form.categoryId || null;
      }
      if (form.type === "buy_x_get_y") {
        payload.buyQuantity = form.buyQuantity;
        payload.getQuantity = form.getQuantity;
      }
      payload.minOrderAmount = form.minOrderAmount > 0 ? form.minOrderAmount : null;
      payload.maxDiscountAmount = form.maxDiscountAmount > 0 ? form.maxDiscountAmount : null;
      payload.maxUsesTotal = form.maxUsesTotal > 0 ? form.maxUsesTotal : null;
      payload.maxUsesPerCustomer = form.maxUsesPerCustomer > 0 ? form.maxUsesPerCustomer : null;
      payload.startsAt = form.startsAt || null;
      payload.expiresAt = form.expiresAt || null;

      updateCoupon.mutate(payload, {
        onSuccess: () => {
          onOpenChange(false);
          toast.success("Cupon actualizado exitosamente");
        },
        onError: (err) => toast.error(`Error: ${(err as Error).message}`),
      });
      return;
    }

    const payload: any = {
      code: form.code,
      name: form.name,
      description: form.description || undefined,
      type: form.type,
    };

    if (["percentage", "fixed", "item_discount", "category_discount"].includes(form.type)) {
      payload.discountValue = form.type === "fixed" ? parseSolesToCents(fixedDiscountInput) : form.discountValue;
    }
    if (["item_free", "item_discount"].includes(form.type) && form.menuItemId) {
      payload.menuItemId = form.menuItemId;
    }
    if (form.type === "category_discount" && form.categoryId) {
      payload.categoryId = form.categoryId;
    }
    if (form.type === "buy_x_get_y") {
      payload.buyQuantity = form.buyQuantity;
      payload.getQuantity = form.getQuantity;
    }
    if (form.minOrderAmount > 0) payload.minOrderAmount = form.minOrderAmount;
    if (form.maxDiscountAmount > 0) payload.maxDiscountAmount = form.maxDiscountAmount;
    if (form.maxUsesTotal > 0) payload.maxUsesTotal = form.maxUsesTotal;
    if (form.maxUsesPerCustomer > 0) payload.maxUsesPerCustomer = form.maxUsesPerCustomer;
    if (form.startsAt) payload.startsAt = form.startsAt;
    if (form.expiresAt) payload.expiresAt = form.expiresAt;

    createCoupon.mutate(payload, {
      onSuccess: () => {
        setForm(emptyForm());
        setFixedDiscountInput(formatCentsToSoles(50));
        onOpenChange(false);
        toast.success("Cupon creado exitosamente");
      },
      onError: (err) => toast.error(`Error: ${(err as Error).message}`),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar Cupon" : "Crear Cupon"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          {/* Code */}
          <div className="space-y-2">
            <Label htmlFor="cpn-code">Código del cupon</Label>
            {isEdit ? (
              <Input id="cpn-code" value={form.code} disabled readOnly />
            ) : (
              <div className="flex gap-2">
                <Input id="cpn-code" value={form.code} onChange={(e) => setForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))} required />
                <Button type="button" variant="outline" size="icon" onClick={() => setForm((p) => ({ ...p, code: generateCouponCode() }))}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            )}
            {isEdit && (
              <p className="text-xs text-muted-foreground">El codigo no se puede modificar.</p>
            )}
          </div>

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="cpn-name">Nombre *</Label>
            <Input id="cpn-name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required placeholder="Ej: 10% en tu primera compra" />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="cpn-desc">Descripción</Label>
            <Input id="cpn-desc" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} placeholder="Descripción opcional" />
          </div>

          {/* Type */}
          <div className="space-y-2">
            <Label htmlFor="cpn-type">Tipo de cupon</Label>
            {isEdit ? (
              <>
                <Input id="cpn-type" value={couponTypeLabels[form.type] ?? form.type} disabled readOnly />
                <p className="text-xs text-muted-foreground">El tipo no se puede modificar.</p>
              </>
            ) : (
              <Select
                value={form.type}
                onValueChange={(v) => {
                  if (v === "fixed") {
                    setFixedDiscountInput(formatCentsToSoles(50));
                  }

                  setForm((p) => ({
                    ...p,
                    type: v,
                    discountValue: v === "fixed" ? 50 : (v === "percentage" || v === "item_discount" || v === "category_discount") ? 10 : 0,
                    menuItemId: "",
                    categoryId: "",
                    buyQuantity: 2,
                    getQuantity: 1,
                  }));
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Tipo de cupon" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">Porcentaje de descuento (%)</SelectItem>
                  <SelectItem value="fixed">Monto fijo de descuento</SelectItem>
                  <SelectItem value="item_free">Item gratis</SelectItem>
                  <SelectItem value="item_discount">Descuento en item especifico</SelectItem>
                  <SelectItem value="category_discount">Descuento en categoria</SelectItem>
                  <SelectItem value="buy_x_get_y">Compra X lleva Y</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Type-specific fields */}
          {form.type === "percentage" && (
            <div className="space-y-2">
              <Label htmlFor="cpn-pct">Porcentaje de descuento</Label>
              <Input id="cpn-pct" type="number" min={1} max={100} value={form.discountValue} onChange={(e) => setForm((p) => ({ ...p, discountValue: parseInt(e.target.value) || 0 }))} />
              <p className="text-xs text-muted-foreground">Ej: 10 = 10% de descuento</p>
            </div>
          )}

          {form.type === "fixed" && (
            <div className="space-y-2">
              <Label htmlFor="cpn-fixed">Monto de descuento (S/)</Label>
              <Input
                id="cpn-fixed"
                type="number"
                min={0.01}
                step={0.01}
                value={fixedDiscountInput}
                onChange={(e) => {
                  const nextValue = e.target.value;

                  setFixedDiscountInput(nextValue);
                  setForm((p) => ({ ...p, discountValue: parseSolesToCents(nextValue) }));
                }}
              />
              <p className="text-xs text-muted-foreground">
                En soles: 0.50 = 50 centimos. Se guarda internamente como centimos.
              </p>
            </div>
          )}

          {(form.type === "item_discount" || form.type === "item_free") && (
            <div className="space-y-2">
              <Label>Item del menu *</Label>
              <Select value={form.menuItemId || "none"} onValueChange={(v) => setForm((p) => ({ ...p, menuItemId: v === "none" ? "" : v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar item..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Seleccionar item...</SelectItem>
                  {menuItems.map((item: any) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name} — S/ {(item.price / 100).toFixed(2)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {form.type === "item_discount" && (
            <div className="space-y-2">
              <Label htmlFor="cpn-dv">Descuento (%)</Label>
              <Input id="cpn-dv" type="number" min={1} max={100} value={form.discountValue} onChange={(e) => setForm((p) => ({ ...p, discountValue: parseInt(e.target.value) || 0 }))} />
            </div>
          )}

          {form.type === "category_discount" && (
            <>
              <div className="space-y-2">
                <Label>Categoría *</Label>
                <Select value={form.categoryId || "none"} onValueChange={(v) => setForm((p) => ({ ...p, categoryId: v === "none" ? "" : v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar categoria..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Seleccionar categoria...</SelectItem>
                    {categories.map((cat: any) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cpn-dv-cat">Descuento (%)</Label>
                <Input id="cpn-dv-cat" type="number" min={1} max={100} value={form.discountValue} onChange={(e) => setForm((p) => ({ ...p, discountValue: parseInt(e.target.value) || 0 }))} />
              </div>
            </>
          )}

          {form.type === "buy_x_get_y" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cpn-bx">Compra (X)</Label>
                <Input id="cpn-bx" type="number" min={1} value={form.buyQuantity} onChange={(e) => setForm((p) => ({ ...p, buyQuantity: parseInt(e.target.value) || 1 }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cpn-gy">Lleva gratis (Y)</Label>
                <Input id="cpn-gy" type="number" min={1} value={form.getQuantity} onChange={(e) => setForm((p) => ({ ...p, getQuantity: parseInt(e.target.value) || 1 }))} />
              </div>
            </div>
          )}

          {/* Common limits */}
          <div className="border-t border-border pt-4 space-y-4">
            <p className="text-sm font-medium text-foreground">Restricciones (opcional)</p>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cpn-min">Pedido minimo (centimos)</Label>
                <Input id="cpn-min" type="number" min={0} value={form.minOrderAmount} onChange={(e) => setForm((p) => ({ ...p, minOrderAmount: parseInt(e.target.value) || 0 }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cpn-maxd">Descuento maximo (centimos)</Label>
                <Input id="cpn-maxd" type="number" min={0} value={form.maxDiscountAmount} onChange={(e) => setForm((p) => ({ ...p, maxDiscountAmount: parseInt(e.target.value) || 0 }))} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cpn-uses">Usos totales (0 = ilimitado)</Label>
                <Input id="cpn-uses" type="number" min={0} value={form.maxUsesTotal} onChange={(e) => setForm((p) => ({ ...p, maxUsesTotal: parseInt(e.target.value) || 0 }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cpn-upc">Usos por cliente</Label>
                <Input id="cpn-upc" type="number" min={1} value={form.maxUsesPerCustomer} onChange={(e) => setForm((p) => ({ ...p, maxUsesPerCustomer: parseInt(e.target.value) || 1 }))} />
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
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button
              type="submit"
              disabled={
                isPending ||
                !form.name ||
                !form.code ||
                (["item_free", "item_discount"].includes(form.type) && !form.menuItemId) ||
                (form.type === "category_discount" && !form.categoryId)
              }
            >
              {isEdit
                ? (isPending ? "Guardando..." : "Guardar Cambios")
                : (isPending ? "Creando..." : "Crear Cupon")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
