"use client";

import { useState } from "react";
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
import { RefreshCw } from "lucide-react";
import { useCreateCoupon } from "@/hooks/use-coupons";
import { toast } from "sonner";

function generateCouponCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "REST-";
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function CreateCouponDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createCoupon = useCreateCoupon();
  const [form, setForm] = useState({
    code: generateCouponCode(),
    name: "",
    description: "",
    type: "percentage" as string,
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
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: any = {
      code: form.code,
      name: form.name,
      description: form.description || undefined,
      type: form.type,
    };

    if (["percentage", "fixed", "item_discount", "category_discount"].includes(form.type)) {
      payload.discountValue = form.discountValue;
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
        setForm({
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
        });
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
          <DialogTitle>Crear Cupon</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          {/* Code */}
          <div className="space-y-2">
            <Label htmlFor="cpn-code">Codigo del cupon</Label>
            <div className="flex gap-2">
              <Input id="cpn-code" value={form.code} onChange={(e) => setForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))} required />
              <Button type="button" variant="outline" size="icon" onClick={() => setForm((p) => ({ ...p, code: generateCouponCode() }))}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="cpn-name">Nombre *</Label>
            <Input id="cpn-name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required placeholder="Ej: 10% en tu primera compra" />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="cpn-desc">Descripcion</Label>
            <Input id="cpn-desc" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} placeholder="Descripcion opcional" />
          </div>

          {/* Type */}
          <div className="space-y-2">
            <Label htmlFor="cpn-type">Tipo de cupon</Label>
            <Select value={form.type} onValueChange={(v) => setForm((p) => ({ ...p, type: v }))}>
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
              <Label htmlFor="cpn-fixed">Monto de descuento (centimos)</Label>
              <Input id="cpn-fixed" type="number" min={1} value={form.discountValue} onChange={(e) => setForm((p) => ({ ...p, discountValue: parseInt(e.target.value) || 0 }))} />
              <p className="text-xs text-muted-foreground">En centimos: 500 = S/ 5.00</p>
            </div>
          )}

          {(form.type === "item_discount" || form.type === "category_discount") && (
            <div className="space-y-2">
              <Label htmlFor="cpn-dv">Descuento (%)</Label>
              <Input id="cpn-dv" type="number" min={1} max={100} value={form.discountValue} onChange={(e) => setForm((p) => ({ ...p, discountValue: parseInt(e.target.value) || 0 }))} />
            </div>
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
                <Label htmlFor="cpn-start">Fecha inicio</Label>
                <Input id="cpn-start" type="datetime-local" value={form.startsAt} onChange={(e) => setForm((p) => ({ ...p, startsAt: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cpn-end">Fecha fin</Label>
                <Input id="cpn-end" type="datetime-local" value={form.expiresAt} onChange={(e) => setForm((p) => ({ ...p, expiresAt: e.target.value }))} />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={createCoupon.isPending || !form.name || !form.code}>
              {createCoupon.isPending ? "Creando..." : "Crear Cupon"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
