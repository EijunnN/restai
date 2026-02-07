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
import { Search, UserPlus, Mail, Clock, RefreshCw, LogIn, LogOut } from "lucide-react";
import { useStaffList, useCreateStaff, useShifts, useCreateShift, useEndShift } from "@/hooks/use-staff";
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
  const { data, isLoading, error, refetch } = useStaffList();
  const { data: shiftsData, isLoading: shiftsLoading } = useShifts();
  const createStaff = useCreateStaff();
  const createShift = useCreateShift();
  const endShift = useEndShift();
  const currentUser = useAuthStore((s) => s.user);
  const selectedBranchId = useAuthStore((s) => s.selectedBranchId);

  // Form state
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
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
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nombre o email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
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
            return (
              <Card key={member.id}>
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                        <span className="text-sm font-bold text-primary">
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
                      {!member.isActive && (
                        <Badge variant="destructive" className="text-[10px]">
                          Inactivo
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t">
                    <p className="text-xs text-muted-foreground">
                      Sedes: {branches.length > 0 ? branches.map((b) => b.name).join(", ") : "Sin asignar"}
                    </p>
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
    </div>
  );
}
