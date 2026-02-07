"use client";

import { useState, useEffect } from "react";
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
import { useUpdateStaff } from "@/hooks/use-staff";
import { toast } from "sonner";

interface EditStaffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: any | null;
}

export function EditStaffDialog({ open, onOpenChange, member }: EditStaffDialogProps) {
  const [editForm, setEditForm] = useState({ name: "", role: "waiter" });
  const updateStaff = useUpdateStaff();

  useEffect(() => {
    if (member) {
      setEditForm({ name: member.name, role: member.role });
    }
  }, [member]);

  const handleEdit = async () => {
    if (!member || !editForm.name) {
      toast.error("El nombre es requerido");
      return;
    }
    try {
      await updateStaff.mutateAsync({
        id: member.id,
        name: editForm.name,
        role: editForm.role,
      });
      toast.success("Staff actualizado");
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Error al actualizar staff");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar Staff</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Nombre</Label>
            <Input
              value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              placeholder="Nombre completo"
            />
          </div>
          <div className="space-y-2">
            <Label>Rol</Label>
            <Select value={editForm.role} onValueChange={(v) => setEditForm({ ...editForm, role: v })}>
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
          <Button
            className="w-full"
            onClick={handleEdit}
            disabled={updateStaff.isPending}
          >
            {updateStaff.isPending ? "Guardando..." : "Guardar Cambios"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
