"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@restai/ui/components/card";
import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
import { Badge } from "@restai/ui/components/badge";
import { Button } from "@restai/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@restai/ui/components/dialog";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@restai/ui/components/select";
import { Search, UserPlus, Mail, Clock, RefreshCw, LogIn, LogOut, Pencil, UserX, UserCheck, Eye, EyeOff, KeyRound } from "lucide-react";
import { useStaffList, useCreateStaff, useUpdateStaff, useChangePassword, useShifts, useCreateShift, useEndShift } from "@/hooks/use-staff";
import { useAuthStore } from "@/stores/auth-store";
import { formatDate } from "@/lib/utils";
import { toast } from "sonner";

const roleLabels: Record<string, string> = {
  org_admin: "Admin",
  branch_manager: "Gerente",
  cashier: "Cajero",
  waiter: "Mesero",
  kitchen: "Cocina",
};

const roleBadgeVariant: Record<string, "default" | "secondary" | "outline"> = {
  org_admin: "default",
  branch_manager: "default",
  cashier: "secondary",
  waiter: "secondary",
  kitchen: "outline",
};

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className ?? ""}`} />;
}

export default function StaffPage() {
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<any>(null);
  const [passwordMember, setPasswordMember] = useState<any>(null);
  const [newPassword, setNewPassword] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const { data, isLoading, error, refetch } = useStaffList(showInactive);
  const { data: shiftsData, isLoading: shiftsLoading } = useShifts();
  const createStaff = useCreateStaff();
  const updateStaff = useUpdateStaff();
  const changePassword = useChangePassword();
  const createShift = useCreateShift();
  const endShift = useEndShift();
  const currentUser = useAuthStore((s) => s.user);
  const selectedBranchId = useAuthStore((s) => s.selectedBranchId);

  // Create form state
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "waiter",
  });

  // Edit form state
  const [editForm, setEditForm] = useState({
    name: "",
    role: "waiter",
  });

  const staff: any[] = data ?? [];
  const shifts: any[] = shiftsData ?? [];
  const activeShifts = shifts.filter((s: any) => !s.end_time);

  const filteredStaff = staff.filter(
    (member: any) =>
      member.name.toLowerCase().includes(search.toLowerCase()) ||
      (member.email || "").toLowerCase().includes(search.toLowerCase()),
  );

  const activeCount = staff.filter((m: any) => m.isActive).length;

  // Check if current user has an active shift
  const myActiveShift = activeShifts.find((s: any) => s.user_id === currentUser?.id);

  const handleCreateStaff = async () => {
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
        branchIds: selectedBranchId ? [selectedBranchId] : [],
      });
      toast.success("Miembro de staff creado");
      setDialogOpen(false);
      setForm({ name: "", email: "", password: "", role: "waiter" });
    } catch (err: any) {
      toast.error(err.message || "Error al crear staff");
    }
  };

  const handleOpenEdit = (member: any) => {
    setEditingMember(member);
    setEditForm({ name: member.name, role: member.role });
    setEditDialogOpen(true);
  };

  const handleEditStaff = async () => {
    if (!editingMember || !editForm.name) {
      toast.error("El nombre es requerido");
      return;
    }
    try {
      await updateStaff.mutateAsync({
        id: editingMember.id,
        name: editForm.name,
        role: editForm.role,
      });
      toast.success("Staff actualizado");
      setEditDialogOpen(false);
      setEditingMember(null);
    } catch (err: any) {
      toast.error(err.message || "Error al actualizar staff");
    }
  };

  const handleOpenPassword = (member: any) => {
    setPasswordMember(member);
    setNewPassword("");
    setPasswordDialogOpen(true);
  };

  const handleChangePassword = async () => {
    if (!passwordMember || newPassword.length < 8) {
      toast.error("La contraseña debe tener al menos 8 caracteres");
      return;
    }
    try {
      await changePassword.mutateAsync({ id: passwordMember.id, password: newPassword });
      toast.success(`Contraseña de ${passwordMember.name} actualizada`);
      setPasswordDialogOpen(false);
      setPasswordMember(null);
      setNewPassword("");
    } catch (err: any) {
      toast.error(err.message || "Error al cambiar contraseña");
    }
  };

  const handleToggleActive = async (member: any) => {
    try {
      await updateStaff.mutateAsync({
        id: member.id,
        isActive: !member.isActive,
      });
      toast.success(member.isActive ? "Staff desactivado" : "Staff activado");
    } catch (err: any) {
      toast.error(err.message || "Error al cambiar estado");
    }
  };

  const handleStartShift = async () => {
    try {
      await createShift.mutateAsync({});
      toast.success("Turno iniciado");
    } catch (err: any) {
      toast.error(err.message || "Error al iniciar turno");
    }
  };

  const handleEndShift = async (shiftId: string) => {
    try {
      await endShift.mutateAsync(shiftId);
      toast.success("Turno finalizado");
    } catch (err: any) {
      toast.error(err.message || "Error al finalizar turno");
    }
  };

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Staff</h1>
        </div>
        <div className="p-4 rounded-lg border border-destructive/50 bg-destructive/5 flex items-center justify-between">
          <p className="text-sm text-destructive">Error al cargar staff: {(error as Error).message}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Staff</h1>
          <p className="text-muted-foreground">
            {isLoading ? "Cargando..." : `${activeCount} miembros activos`}
          </p>
        </div>
        <div className="flex gap-2">
          {myActiveShift ? (
            <Button
              variant="outline"
              onClick={() => handleEndShift(myActiveShift.id)}
              disabled={endShift.isPending}
            >
              <LogOut className="h-4 w-4 mr-2" />
              Finalizar Turno
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={handleStartShift}
              disabled={createShift.isPending}
            >
              <LogIn className="h-4 w-4 mr-2" />
              Iniciar Turno
            </Button>
          )}
          <Button onClick={() => setDialogOpen(true)}>
            <UserPlus className="h-4 w-4 mr-2" />
            Agregar Staff
          </Button>
        </div>
      </div>

      {/* Search + inactive filter */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre o email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button
          variant={showInactive ? "secondary" : "outline"}
          size="icon"
          onClick={() => setShowInactive(!showInactive)}
          title={showInactive ? "Ocultar inactivos" : "Mostrar inactivos"}
        >
          {showInactive ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div>
                      <Skeleton className="h-4 w-24 mb-1" />
                      <Skeleton className="h-3 w-32" />
                    </div>
                  </div>
                  <Skeleton className="h-5 w-14 rounded-full" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredStaff.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          {search ? "No se encontraron miembros" : "No hay miembros de staff"}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredStaff.map((member: any) => {
            const branches: any[] = member.branches || [];
            const isInactive = !member.isActive;
            return (
              <Card key={member.id} className={isInactive ? "opacity-60" : undefined}>
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`h-10 w-10 rounded-full flex items-center justify-center ${isInactive ? "bg-muted" : "bg-primary/10"}`}>
                        <span className={`text-sm font-bold ${isInactive ? "text-muted-foreground" : "text-primary"}`}>
                          {member.name
                            .split(" ")
                            .map((n: string) => n[0])
                            .join("")
                            .slice(0, 2)}
                        </span>
                      </div>
                      <div>
                        <p className="font-medium text-sm">{member.name}</p>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Mail className="h-3 w-3" />
                          {member.email}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant={roleBadgeVariant[member.role] || "outline"}>
                        {roleLabels[member.role] || member.role}
                      </Badge>
                      {isInactive && (
                        <Badge variant="destructive" className="text-[10px]">
                          Inactivo
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      Sedes: {branches.length > 0 ? branches.map((b) => b.name).join(", ") : "Sin asignar"}
                    </p>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handleOpenEdit(member)}
                        title="Editar"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handleOpenPassword(member)}
                        title="Cambiar contraseña"
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handleToggleActive(member)}
                        disabled={updateStaff.isPending}
                        title={member.isActive ? "Desactivar" : "Activar"}
                      >
                        {member.isActive ? (
                          <UserX className="h-3.5 w-3.5 text-destructive" />
                        ) : (
                          <UserCheck className="h-3.5 w-3.5 text-green-600" />
                        )}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Active Shifts */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Turnos Activos
          </CardTitle>
        </CardHeader>
        <CardContent>
          {shiftsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-lg border">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
            </div>
          ) : activeShifts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No hay turnos activos
            </p>
          ) : (
            <div className="space-y-3">
              {activeShifts.map((shift: any) => (
                <div
                  key={shift.id}
                  className="flex items-center justify-between p-3 rounded-lg border"
                >
                  <div>
                    <p className="font-medium text-sm">{shift.user_name}</p>
                    <p className="text-xs text-muted-foreground">
                      Inicio: {formatDate(shift.start_time)}
                    </p>
                  </div>
                  {shift.user_id === currentUser?.id && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEndShift(shift.id)}
                      disabled={endShift.isPending}
                    >
                      <LogOut className="h-3 w-3 mr-1" />
                      Salir
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Staff Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
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
            <Button
              className="w-full"
              onClick={handleCreateStaff}
              disabled={createStaff.isPending}
            >
              {createStaff.isPending ? "Creando..." : "Crear Miembro"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Staff Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
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
              onClick={handleEditStaff}
              disabled={updateStaff.isPending}
            >
              {updateStaff.isPending ? "Guardando..." : "Guardar Cambios"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Change Password Dialog */}
      <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cambiar Contraseña</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {passwordMember && (
              <p className="text-sm text-muted-foreground">
                Cambiar contraseña de <span className="font-medium text-foreground">{passwordMember.name}</span>
              </p>
            )}
            <div className="space-y-2">
              <Label>Nueva Contraseña</Label>
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
              onClick={handleChangePassword}
              disabled={changePassword.isPending || newPassword.length < 8}
            >
              {changePassword.isPending ? "Cambiando..." : "Cambiar Contraseña"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
