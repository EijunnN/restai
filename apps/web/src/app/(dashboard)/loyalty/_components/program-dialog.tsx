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
    isActive: editData?.is_active ?? true,
    // Empty string = nunca expira
    pointsExpireAfterDays:
      editData?.points_expire_after_days != null
        ? String(editData.points_expire_after_days)
        : "",
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const trimmedDays = form.pointsExpireAfterDays.trim();
    const parsedDays = trimmedDays === "" ? null : parseInt(trimmedDays, 10);
    if (parsedDays != null && (Number.isNaN(parsedDays) || parsedDays < 1)) {
      toast.error("Los dias de expiracion deben ser un numero mayor o igual a 1");
      return;
    }

    const payload = {
      name: form.name,
      pointsPerCurrencyUnit: form.pointsPerCurrencyUnit,
      currencyPerPoint: form.currencyPerPoint,
      isActive: form.isActive,
      pointsExpireAfterDays: parsedDays,
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
          <DialogTitle>{isEdit ? "Editar Programa" : "Crear Programa de Fidelización"}</DialogTitle>
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
          <div className="space-y-2">
            <Label htmlFor="prog-expiry">Puntos expiran a los (dias)</Label>
            <Input
              id="prog-expiry"
              type="number"
              min={1}
              placeholder="Nunca"
              value={form.pointsExpireAfterDays}
              onChange={(e) => setForm((p) => ({ ...p, pointsExpireAfterDays: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">Deja vacio para que los puntos nunca expiren</p>
          </div>

          {/* Active toggle */}
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <Label htmlFor="prog-active" className="cursor-pointer">Programa activo</Label>
              <p className="text-xs text-muted-foreground">Si esta inactivo, los clientes no acumulan puntos</p>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                id="prog-active"
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              {form.isActive ? "Activo" : "Inactivo"}
            </label>
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
