"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@restai/ui/components/card";
import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
import { Button } from "@restai/ui/components/button";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@restai/ui/components/select";
import { cn } from "@/lib/utils";
import { useBranchSettings, useUpdateBranch } from "@/hooks/use-settings";
import { toast } from "sonner";

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className ?? ""}`} />;
}

const TIMEZONES = [
  "America/Lima",
  "America/Bogota",
  "America/Mexico_City",
  "America/Buenos_Aires",
  "America/Santiago",
  "America/Sao_Paulo",
  "America/New_York",
];

export function BranchTab() {
  const { data: branchData, isLoading: branchLoading } = useBranchSettings();
  const updateBranch = useUpdateBranch();

  const [branchForm, setBranchForm] = useState({
    name: "",
    address: "",
    phone: "",
    taxRate: "18.00",
    timezone: "America/Lima",
    currency: "PEN",
    inventoryEnabled: false,
    waiterTableAssignmentEnabled: false,
  });

  useEffect(() => {
    if (branchData) {
      setBranchForm({
        name: branchData.name || "",
        address: branchData.address || "",
        phone: branchData.phone || "",
        taxRate: ((branchData.tax_rate || 1800) / 100).toFixed(2),
        timezone: branchData.timezone || "America/Lima",
        currency: branchData.currency || "PEN",
        inventoryEnabled: branchData.settings?.inventory_enabled ?? false,
        waiterTableAssignmentEnabled: branchData.settings?.waiter_table_assignment_enabled ?? false,
      });
    }
  }, [branchData]);

  const handleBranchSave = async () => {
    try {
      const taxRateNum = Math.round(parseFloat(branchForm.taxRate) * 100);
      await updateBranch.mutateAsync({
        name: branchForm.name,
        address: branchForm.address,
        phone: branchForm.phone,
        taxRate: taxRateNum,
        timezone: branchForm.timezone,
        currency: branchForm.currency,
        inventoryEnabled: branchForm.inventoryEnabled,
        waiterTableAssignmentEnabled: branchForm.waiterTableAssignmentEnabled,
      });
      toast.success("Sede actualizada correctamente");
    } catch (err: any) {
      toast.error(err.message || "Error al actualizar sede");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sede Actual</CardTitle>
        <CardDescription>
          Configuracion de la sede seleccionada
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {branchLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="branchName">Nombre de la Sede</Label>
                <Input
                  id="branchName"
                  value={branchForm.name}
                  onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="branchPhone">Telefono</Label>
                <Input
                  id="branchPhone"
                  value={branchForm.phone}
                  onChange={(e) => setBranchForm({ ...branchForm, phone: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="branchAddress">Direccion</Label>
              <Input
                id="branchAddress"
                value={branchForm.address}
                onChange={(e) => setBranchForm({ ...branchForm, address: e.target.value })}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Zona Horaria</Label>
                <Select value={branchForm.timezone} onValueChange={(v) => setBranchForm({ ...branchForm, timezone: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona zona horaria" />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map((tz) => (
                      <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Moneda</Label>
                <Select value={branchForm.currency} onValueChange={(v) => setBranchForm({ ...branchForm, currency: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona moneda" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PEN">PEN (Soles)</SelectItem>
                    <SelectItem value="USD">USD (Dolares)</SelectItem>
                    <SelectItem value="EUR">EUR (Euros)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="branchTaxRate">IGV (%)</Label>
              <Input
                id="branchTaxRate"
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={branchForm.taxRate}
                onChange={(e) => setBranchForm({ ...branchForm, taxRate: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Ingresa el porcentaje (ej: 18.00 para 18%)
              </p>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <p className="text-sm font-medium">Control de Inventario</p>
                <p className="text-xs text-muted-foreground">
                  Activa el seguimiento de stock y recetas
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={branchForm.inventoryEnabled}
                onClick={() => setBranchForm({ ...branchForm, inventoryEnabled: !branchForm.inventoryEnabled })}
                className={cn(
                  "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                  branchForm.inventoryEnabled ? "bg-primary" : "bg-muted"
                )}
              >
                <span
                  className={cn(
                    "pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform",
                    branchForm.inventoryEnabled ? "translate-x-5" : "translate-x-0"
                  )}
                />
              </button>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <p className="text-sm font-medium">Asignacion de mozos a mesas</p>
                <p className="text-xs text-muted-foreground">
                  Permite asignar mozos especificos a cada mesa
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={branchForm.waiterTableAssignmentEnabled}
                onClick={() => setBranchForm({ ...branchForm, waiterTableAssignmentEnabled: !branchForm.waiterTableAssignmentEnabled })}
                className={cn(
                  "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                  branchForm.waiterTableAssignmentEnabled ? "bg-primary" : "bg-muted"
                )}
              >
                <span
                  className={cn(
                    "pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform",
                    branchForm.waiterTableAssignmentEnabled ? "translate-x-5" : "translate-x-0"
                  )}
                />
              </button>
            </div>
            <Button onClick={handleBranchSave} disabled={updateBranch.isPending}>
              {updateBranch.isPending ? "Guardando..." : "Guardar Cambios"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
