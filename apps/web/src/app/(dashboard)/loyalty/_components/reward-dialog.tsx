"use client";

import { useState, useEffect } from "react";
import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
import { Button } from "@restai/ui/components/button";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@restai/ui/components/select";
import { DatePicker } from "@restai/ui/components/date-picker";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@restai/ui/components/dialog";
import { useCreateReward, useUpdateReward } from "@/hooks/use-loyalty";
import { useMenuItems } from "@/hooks/use-menu";
import { toast } from "sonner";

type RewardType = "discount" | "free_item";

const defaultForm = {
  name: "",
  description: "",
  pointsCost: 100,
  rewardType: "discount" as RewardType,
  discountType: "percentage" as "percentage" | "fixed",
  discountValue: 10,
  menuItemId: "",
  stockRemaining: "", // empty = ilimitado
  maxPerCustomer: "", // empty = ilimitado
  startsAt: "",
  expiresAt: "",
};

// Convert an ISO/date string from the API into a YYYY-MM-DD string for DatePicker.
function toDateInputValue(value: any): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function RewardDialog({
  open,
  onOpenChange,
  programId,
  editData,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  programId: string;
  editData?: {
    id: string;
    name: string;
    description?: string | null;
    points_cost: number;
    reward_type?: string | null;
    discount_type: string;
    discount_value: number;
    menu_item_id?: string | null;
    stock_remaining?: number | null;
    max_per_customer?: number | null;
    starts_at?: string | null;
    expires_at?: string | null;
    is_active: boolean;
  } | null;
}) {
  const createReward = useCreateReward();
  const updateReward = useUpdateReward();
  const { data: menuItems } = useMenuItems();
  const isEdit = !!editData;
  const [form, setForm] = useState(defaultForm);

  const menuItemsList: any[] = menuItems ?? [];

  useEffect(() => {
    if (editData) {
      setForm({
        name: editData.name,
        description: editData.description || "",
        pointsCost: editData.points_cost,
        rewardType: (editData.reward_type as RewardType) || "discount",
        discountType: editData.discount_type as "percentage" | "fixed",
        discountValue: editData.discount_value,
        menuItemId: editData.menu_item_id || "",
        stockRemaining: editData.stock_remaining != null ? String(editData.stock_remaining) : "",
        maxPerCustomer: editData.max_per_customer != null ? String(editData.max_per_customer) : "",
        startsAt: toDateInputValue(editData.starts_at),
        expiresAt: toDateInputValue(editData.expires_at),
      });
    } else {
      setForm(defaultForm);
    }
  }, [editData]);

  function buildPayload(): Record<string, any> | null {
    if (!form.name.trim()) {
      toast.error("El nombre es obligatorio");
      return null;
    }

    const isDiscount = form.rewardType === "discount";

    if (!isDiscount && !form.menuItemId) {
      toast.error("Selecciona el producto gratis");
      return null;
    }

    if (isDiscount && form.discountType === "percentage") {
      if (form.discountValue < 1 || form.discountValue > 100) {
        toast.error("El porcentaje debe estar entre 1 y 100");
        return null;
      }
    }
    if (isDiscount && form.discountValue < 1) {
      toast.error("El valor del descuento debe ser mayor a 0");
      return null;
    }

    const parseOptionalInt = (v: string): number | null => {
      const t = v.trim();
      if (t === "") return null;
      const n = parseInt(t, 10);
      return Number.isNaN(n) ? null : n;
    };

    const stockRemaining = parseOptionalInt(form.stockRemaining);
    const maxPerCustomer = parseOptionalInt(form.maxPerCustomer);
    if (stockRemaining != null && stockRemaining < 0) {
      toast.error("El stock no puede ser negativo");
      return null;
    }
    if (maxPerCustomer != null && maxPerCustomer < 1) {
      toast.error("El limite por cliente debe ser mayor o igual a 1");
      return null;
    }

    return {
      name: form.name,
      description: form.description || undefined,
      pointsCost: form.pointsCost,
      rewardType: form.rewardType,
      // discount fields only meaningful for discount rewards
      discountType: isDiscount ? form.discountType : undefined,
      discountValue: isDiscount ? form.discountValue : undefined,
      menuItemId: isDiscount ? null : form.menuItemId,
      stockRemaining,
      maxPerCustomer,
      startsAt: form.startsAt || null,
      expiresAt: form.expiresAt || null,
    };
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = buildPayload();
    if (!payload) return;

    if (isEdit) {
      updateReward.mutate(
        { id: editData!.id, ...payload },
        {
          onSuccess: () => {
            onOpenChange(false);
            toast.success("Recompensa actualizada");
          },
          onError: (err) => toast.error(`Error: ${(err as Error).message}`),
        },
      );
    } else {
      createReward.mutate(
        { programId, ...payload },
        {
          onSuccess: () => {
            setForm(defaultForm);
            onOpenChange(false);
            toast.success("Recompensa creada exitosamente");
          },
          onError: (err) => toast.error(`Error: ${(err as Error).message}`),
        },
      );
    }
  }

  const isPending = createReward.isPending || updateReward.isPending;
  const isDiscount = form.rewardType === "discount";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar Recompensa" : "Crear Recompensa"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rwd-name">Nombre *</Label>
            <Input id="rwd-name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rwd-desc">Descripción</Label>
            <Input id="rwd-desc" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rwd-cost">Costo en puntos</Label>
            <Input id="rwd-cost" type="number" min={1} value={form.pointsCost} onChange={(e) => setForm((p) => ({ ...p, pointsCost: parseInt(e.target.value) || 1 }))} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="rwd-type">Tipo de recompensa</Label>
            <Select value={form.rewardType} onValueChange={(v) => setForm((p) => ({ ...p, rewardType: v as RewardType }))}>
              <SelectTrigger>
                <SelectValue placeholder="Tipo de recompensa" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="discount">Descuento</SelectItem>
                <SelectItem value="free_item">Producto gratis</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isDiscount ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="rwd-dtype">Tipo de descuento</Label>
                <Select value={form.discountType} onValueChange={(v) => setForm((p) => ({ ...p, discountType: v as "percentage" | "fixed" }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Tipo de descuento" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Porcentaje (%)</SelectItem>
                    <SelectItem value="fixed">Monto fijo (centimos)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="rwd-dval">Valor del descuento</Label>
                <Input
                  id="rwd-dval"
                  type="number"
                  min={1}
                  max={form.discountType === "percentage" ? 100 : undefined}
                  value={form.discountValue}
                  onChange={(e) => setForm((p) => ({ ...p, discountValue: parseInt(e.target.value) || 1 }))}
                />
                <p className="text-xs text-muted-foreground">
                  {form.discountType === "percentage" ? "Porcentaje de descuento (1 a 100)" : "Monto en centimos (ej. 500 = S/ 5.00)"}
                </p>
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="rwd-item">Producto gratis *</Label>
              <Select value={form.menuItemId || undefined} onValueChange={(v) => setForm((p) => ({ ...p, menuItemId: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona un producto" />
                </SelectTrigger>
                <SelectContent>
                  {menuItemsList.length === 0 ? (
                    <SelectItem value="__none" disabled>No hay productos disponibles</SelectItem>
                  ) : (
                    menuItemsList.map((item: any) => (
                      <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">El cliente recibe este producto sin costo al canjear</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="rwd-stock">Stock disponible</Label>
              <Input
                id="rwd-stock"
                type="number"
                min={0}
                placeholder="Ilimitado"
                value={form.stockRemaining}
                onChange={(e) => setForm((p) => ({ ...p, stockRemaining: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">Vacio = ilimitado</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rwd-maxpc">Limite por cliente</Label>
              <Input
                id="rwd-maxpc"
                type="number"
                min={1}
                placeholder="Ilimitado"
                value={form.maxPerCustomer}
                onChange={(e) => setForm((p) => ({ ...p, maxPerCustomer: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">Vacio = ilimitado</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Disponible desde</Label>
              <DatePicker
                value={form.startsAt}
                onChange={(v) => setForm((p) => ({ ...p, startsAt: v ?? "" }))}
                placeholder="Seleccionar..."
              />
            </div>
            <div className="space-y-2">
              <Label>Disponible hasta</Label>
              <DatePicker
                value={form.expiresAt}
                onChange={(v) => setForm((p) => ({ ...p, expiresAt: v ?? "" }))}
                placeholder="Seleccionar..."
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={isPending || !form.name}>
              {isPending ? (isEdit ? "Guardando..." : "Creando...") : (isEdit ? "Guardar" : "Crear Recompensa")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Re-export with old name for backward compat
export { RewardDialog as CreateRewardDialog };
