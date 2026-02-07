"use client";

import { useState } from "react";
import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
import { Button } from "@restai/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@restai/ui/components/dialog";
import { useCreateTier, useUpdateTier } from "@/hooks/use-loyalty";
import { toast } from "sonner";

export function TierDialog({
  open,
  onOpenChange,
  programId,
  editData,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  programId: string;
  editData?: any;
}) {
  const createTier = useCreateTier();
  const updateTier = useUpdateTier();
  const isEdit = !!editData;

  const [form, setForm] = useState({
    name: editData?.name || "",
    minPoints: editData?.min_points || 0,
    multiplier: editData?.multiplier || 100,
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isEdit) {
      updateTier.mutate(
        { id: editData.id, name: form.name, minPoints: form.minPoints, multiplier: form.multiplier },
        {
          onSuccess: () => { onOpenChange(false); toast.success("Nivel actualizado"); },
          onError: (err) => toast.error(`Error: ${(err as Error).message}`),
        },
      );
    } else {
      createTier.mutate(
        { programId, name: form.name, minPoints: form.minPoints, multiplier: form.multiplier },
        {
          onSuccess: () => { setForm({ name: "", minPoints: 0, multiplier: 100 }); onOpenChange(false); toast.success("Nivel creado"); },
          onError: (err) => toast.error(`Error: ${(err as Error).message}`),
        },
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar Nivel" : "Crear Nivel"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tier-name">Nombre del nivel</Label>
            <Input id="tier-name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required placeholder="Ej: Diamante" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tier-min">Puntos minimos</Label>
            <Input id="tier-min" type="number" min={0} value={form.minPoints} onChange={(e) => setForm((p) => ({ ...p, minPoints: parseInt(e.target.value) || 0 }))} />
            <p className="text-xs text-muted-foreground">Puntos necesarios para alcanzar este nivel</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tier-mult">Multiplicador (%)</Label>
            <Input id="tier-mult" type="number" min={100} value={form.multiplier} onChange={(e) => setForm((p) => ({ ...p, multiplier: parseInt(e.target.value) || 100 }))} />
            <p className="text-xs text-muted-foreground">100 = 1x, 150 = 1.5x, 200 = 2x puntos</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={createTier.isPending || updateTier.isPending || !form.name}>
              {(createTier.isPending || updateTier.isPending) ? "Guardando..." : isEdit ? "Guardar" : "Crear Nivel"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
