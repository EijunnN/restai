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
import { useChangePassword } from "@/hooks/use-staff";
import { toast } from "sonner";

interface PasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: any | null;
}

export function PasswordDialog({ open, onOpenChange, member }: PasswordDialogProps) {
  const [newPassword, setNewPassword] = useState("");
  const changePassword = useChangePassword();

  const handleChange = async () => {
    if (!member || newPassword.length < 8) {
      toast.error("La contrasena debe tener al menos 8 caracteres");
      return;
    }
    try {
      await changePassword.mutateAsync({ id: member.id, password: newPassword });
      toast.success(`Contrasena de ${member.name} actualizada`);
      onOpenChange(false);
      setNewPassword("");
    } catch (err: any) {
      toast.error(err.message || "Error al cambiar contrasena");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cambiar Contrasena</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {member && (
            <p className="text-sm text-muted-foreground">
              Cambiar contrasena de <span className="font-medium text-foreground">{member.name}</span>
            </p>
          )}
          <div className="space-y-2">
            <Label>Nueva Contrasena</Label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Minimo 8 caracteres"
            />
            {newPassword.length > 0 && newPassword.length < 8 && (
              <p className="text-xs text-destructive">Debe tener al menos 8 caracteres</p>
            )}
          </div>
          <Button
            className="w-full"
            onClick={handleChange}
            disabled={changePassword.isPending || newPassword.length < 8}
          >
            {changePassword.isPending ? "Cambiando..." : "Cambiar Contrasena"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
