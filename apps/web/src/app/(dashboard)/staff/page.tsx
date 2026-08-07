"use client";

import { useState } from "react";
import { Button } from "@restai/ui/components/button";
import { RefreshCw, UserPlus } from "lucide-react";
import { useStaffList, useUpdateStaff, useShifts, useEndShift } from "@/hooks/use-staff";
import { useAuthStore } from "@/stores/auth-store";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { StaffGrid } from "./_components/staff-grid";
import { ShiftsSection } from "./_components/shifts-section";
import { ShiftClockButton } from "./_components/shift-clock-button";
import { CreateStaffDialog } from "./_components/create-staff-dialog";
import { EditStaffDialog } from "./_components/edit-staff-dialog";
import { PasswordDialog } from "./_components/password-dialog";

export default function StaffPage() {
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<any>(null);
  const [passwordMember, setPasswordMember] = useState<any>(null);

  const { data, isLoading, error, refetch } = useStaffList(showInactive);
  const { data: shiftsData, isLoading: shiftsLoading } = useShifts();
  const updateStaff = useUpdateStaff();
  const endShift = useEndShift();
  const currentUser = useAuthStore((s) => s.user);

  const staff: any[] = data ?? [];
  const shifts: any[] = shiftsData ?? [];
  const activeCount = staff.filter((m: any) => m.isActive).length;

  const handleEndShift = async (shiftId: string) => {
    try {
      await endShift.mutateAsync(shiftId);
      toast.success("Turno finalizado");
    } catch (err: any) {
      toast.error(err.message || "Error al finalizar turno");
    }
  };

  const handleToggleActive = async (member: any) => {
    try {
      await updateStaff.mutateAsync({
        id: member.id,
        isActive: !member.isActive,
      });
      toast.success(member.isActive ? "Empleado desactivado" : "Empleado activado");
    } catch (err: any) {
      toast.error(err.message || "Error al cambiar estado");
    }
  };

  const handleOpenEdit = (member: any) => {
    setEditingMember(member);
    setEditDialogOpen(true);
  };

  const handleOpenPassword = (member: any) => {
    setPasswordMember(member);
    setPasswordDialogOpen(true);
  };

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Personal</h1>
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
      <PageHeader
        title="Personal"
        description={isLoading ? "Cargando..." : `${activeCount} miembros activos`}
        actions={
          <>
            {/* Un solo control de fichaje en toda la aplicación: el mismo que
                ve el mozo en Órdenes, para que no haya dos comportamientos. */}
            <ShiftClockButton />
            <Button onClick={() => setDialogOpen(true)}>
              <UserPlus className="h-4 w-4 mr-2" />
              Agregar empleado
            </Button>
          </>
        }
      />

      <StaffGrid
        staff={staff}
        isLoading={isLoading}
        search={search}
        onSearchChange={setSearch}
        showInactive={showInactive}
        onToggleInactive={() => setShowInactive(!showInactive)}
        onEdit={handleOpenEdit}
        onPassword={handleOpenPassword}
        onToggleActive={handleToggleActive}
        updatePending={updateStaff.isPending}
      />

      <ShiftsSection
        shifts={shifts}
        isLoading={shiftsLoading}
        currentUserId={currentUser?.id}
        onEndShift={handleEndShift}
        endShiftPending={endShift.isPending}
      />

      <CreateStaffDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      <EditStaffDialog open={editDialogOpen} onOpenChange={setEditDialogOpen} member={editingMember} />
      <PasswordDialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen} member={passwordMember} />
    </div>
  );
}
