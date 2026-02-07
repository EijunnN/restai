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
import { useCreateReward } from "@/hooks/use-loyalty";
import { toast } from "sonner";

export function CreateRewardDialog({
  open,
  onOpenChange,
  programId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  programId: string;
}) {
  const createReward = useCreateReward();
  const [form, setForm] = useState({
    name: "",
    description: "",
    pointsCost: 100,
    discountType: "percentage" as "percentage" | "fixed",
    discountValue: 10,
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createReward.mutate(
      {
        programId,
        name: form.name,
        description: form.description || undefined,
        pointsCost: form.pointsCost,
        discountType: form.discountType,
        discountValue: form.discountValue,
      },
      {
        onSuccess: () => {
          setForm({ name: "", description: "", pointsCost: 100, discountType: "percentage", discountValue: 10 });
          onOpenChange(false);
          toast.success("Recompensa creada exitosamente");
        },
        onError: (err) => toast.error(`Error: ${(err as Error).message}`),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Crear Recompensa</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rwd-name">Nombre *</Label>
            <Input id="rwd-name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rwd-desc">Descripcion</Label>
            <Input id="rwd-desc" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rwd-cost">Costo en puntos</Label>
            <Input id="rwd-cost" type="number" min={1} value={form.pointsCost} onChange={(e) => setForm((p) => ({ ...p, pointsCost: parseInt(e.target.value) || 1 }))} />
          </div>
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
            <Input id="rwd-dval" type="number" min={1} value={form.discountValue} onChange={(e) => setForm((p) => ({ ...p, discountValue: parseInt(e.target.value) || 1 }))} />
            <p className="text-xs text-muted-foreground">
              {form.discountType === "percentage" ? "Porcentaje de descuento (ej. 10 = 10%)" : "Monto en centimos (ej. 500 = S/ 5.00)"}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={createReward.isPending || !form.name}>
              {createReward.isPending ? "Creando..." : "Crear Recompensa"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
