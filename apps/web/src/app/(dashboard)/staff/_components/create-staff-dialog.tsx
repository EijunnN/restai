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
} from "@restai/ui/components/dialog";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@restai/ui/components/select";
import { useCreateStaff } from "@/hooks/use-staff";
import { useBranches } from "@/hooks/use-settings";
import { useAuthStore } from "@/stores/auth-store";
import { toast } from "sonner";
import { Check } from "lucide-react";

interface CreateStaffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateStaffDialog({ open, onOpenChange }: CreateStaffDialogProps) {
  const selectedBranchId = useAuthStore((s) => s.selectedBranchId);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "waiter",
    branchIds: selectedBranchId ? [selectedBranchId] : [] as string[],
  });

  const createStaff = useCreateStaff();
  const { data: branchesData } = useBranches();
  const branches = branchesData ?? [];

  const handleCreate = async () => {
    if (!form.name || !form.email || !form.password) {
      toast.error("Completa todos los campos requeridos");
      return;
    }
    try {
      await createStaff.mutateAsync({
        name: form.name,
        email: form.email,
        password: form.password,
        role: form.role,
        branchIds: form.branchIds,
      });
      toast.success("Miembro de staff creado");
      onOpenChange(false);
      setForm({ name: "", email: "", password: "", role: "waiter", branchIds: selectedBranchId ? [selectedBranchId] : [] });
    } catch (err: any) {
      toast.error(err.message || "Error al crear staff");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agregar Miembro de Staff</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Nombre</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Nombre completo"
            />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="email@ejemplo.com"
            />
          </div>
          <div className="space-y-2">
            <Label>Contrasena</Label>
            <Input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="Minimo 8 caracteres"
            />
          </div>
          <div className="space-y-2">
            <Label>Rol</Label>
            <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar rol" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="org_admin">Admin</SelectItem>
                <SelectItem value="branch_manager">Gerente</SelectItem>
                <SelectItem value="cashier">Cajero</SelectItem>
                <SelectItem value="waiter">Mesero</SelectItem>
                <SelectItem value="kitchen">Cocina</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Sedes asignadas *</Label>
            <div className="border rounded-md max-h-40 overflow-y-auto">
              {branches.map((branch) => {
                const isChecked = form.branchIds.includes(branch.id);
                return (
                  <button
                    key={branch.id}
                    type="button"
                    onClick={() =>
                      setForm({
                        ...form,
                        branchIds: isChecked
                          ? form.branchIds.filter((id) => id !== branch.id)
                          : [...form.branchIds, branch.id],
                      })
                    }
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent transition-colors"
                  >
                    <div
                      className={`h-4 w-4 rounded border-2 flex items-center justify-center ${
                        isChecked ? "bg-primary border-primary" : "border-muted-foreground/30"
                      }`}
                    >
                      {isChecked && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                    </div>
                    {branch.name}
                  </button>
                );
              })}
            </div>
            {form.branchIds.length === 0 && (
              <p className="text-xs text-destructive">Selecciona al menos una sede</p>
            )}
          </div>
          <Button
            className="w-full"
            onClick={handleCreate}
            disabled={createStaff.isPending || form.branchIds.length === 0}
          >
            {createStaff.isPending ? "Creando..." : "Crear Miembro"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
