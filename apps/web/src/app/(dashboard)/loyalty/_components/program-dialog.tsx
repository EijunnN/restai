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
import { useCreateProgram, useUpdateProgram } from "@/hooks/use-loyalty";
import { toast } from "sonner";

export function ProgramDialog({
  open,
  onOpenChange,
  editData,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editData?: any;
}) {
  const createProgram = useCreateProgram();
  const updateProgram = useUpdateProgram();
  const isEdit = !!editData;

  const [form, setForm] = useState({
    name: editData?.name || "Programa de Puntos",
    pointsPerCurrencyUnit: editData?.points_per_currency_unit || 1,
    currencyPerPoint: editData?.currency_per_point || 100,
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      name: form.name,
      pointsPerCurrencyUnit: form.pointsPerCurrencyUnit,
      currencyPerPoint: form.currencyPerPoint,
      isActive: true,
    };

    const mutation = isEdit ? updateProgram : createProgram;
    const data = isEdit ? { id: editData.id, ...payload } : payload;

    mutation.mutate(data, {
      onSuccess: () => {
        onOpenChange(false);
        toast.success(isEdit ? "Programa actualizado" : "Programa creado exitosamente");
      },
      onError: (err) => toast.error(`Error: ${(err as Error).message}`),
    });
  }

  // Points simulator
  const exampleSpend = 50;
  const pointsEarned = exampleSpend * form.pointsPerCurrencyUnit;
  const pointValue = form.currencyPerPoint / 100;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar Programa" : "Crear Programa de Fidelizacion"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="prog-name">Nombre del programa</Label>
            <Input id="prog-name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="prog-ppu">Puntos por sol gastado</Label>
            <Input
              id="prog-ppu"
              type="number"
              min={1}
              value={form.pointsPerCurrencyUnit}
              onChange={(e) => setForm((p) => ({ ...p, pointsPerCurrencyUnit: parseInt(e.target.value) || 1 }))}
            />
            <p className="text-xs text-muted-foreground">Cuantos puntos gana el cliente por cada S/ 1.00 gastado</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="prog-cpp">Valor por punto (centimos)</Label>
            <Input
              id="prog-cpp"
              type="number"
              min={1}
              value={form.currencyPerPoint}
              onChange={(e) => setForm((p) => ({ ...p, currencyPerPoint: parseInt(e.target.value) || 100 }))}
            />
            <p className="text-xs text-muted-foreground">Valor en centimos de cada punto al canjear (100 = S/ 1.00)</p>
          </div>

          {/* Simulator */}
          <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
            <p className="text-sm font-medium text-foreground">Vista previa</p>
            <p className="text-xs text-muted-foreground">
              Si tu cliente gasta <span className="font-bold text-foreground">S/ {exampleSpend}.00</span>, gana{" "}
              <span className="font-bold text-primary">{pointsEarned} puntos</span>.
            </p>
            <p className="text-xs text-muted-foreground">
              Con <span className="font-bold text-foreground">100 puntos</span> acumulados, puede canjear{" "}
              <span className="font-bold text-primary">S/ {(100 * pointValue).toFixed(2)}</span> en descuentos.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={createProgram.isPending || updateProgram.isPending}>
              {(createProgram.isPending || updateProgram.isPending) ? "Guardando..." : isEdit ? "Guardar Cambios" : "Crear Programa"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
