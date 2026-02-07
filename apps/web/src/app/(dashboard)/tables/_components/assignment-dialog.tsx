"use client";

import { useState } from "react";
import { Button } from "@restai/ui/components/button";
import { Label } from "@restai/ui/components/label";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@restai/ui/components/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@restai/ui/components/dialog";
import { UserMinus } from "lucide-react";
import { useTableAssignments, useAssignWaiter, useRemoveAssignment } from "@/hooks/use-tables";
import { useStaffList } from "@/hooks/use-staff";

interface AssignmentDialogProps {
  table: any | null;
  onClose: () => void;
}

export function AssignmentDialog({ table, onClose }: AssignmentDialogProps) {
  const [assignKey, setAssignKey] = useState(0);
  const { data: assignmentsData } = useTableAssignments(table?.id);
  const assignWaiter = useAssignWaiter();
  const removeAssignment = useRemoveAssignment();
  const { data: staffData } = useStaffList();

  const waiters: any[] = (staffData ?? []).filter((s: any) => ["waiter", "branch_manager", "org_admin"].includes(s.role));
  const assignments: any[] = assignmentsData ?? [];

  return (
    <Dialog open={!!table} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Asignar Mozos - Mesa {table?.number}
          </DialogTitle>
          <DialogDescription>
            Gestiona los mozos asignados a esta mesa
          </DialogDescription>
        </DialogHeader>
        {table && (
          <div className="space-y-4">
            {/* Current assignments */}
            <div>
              <Label className="text-sm mb-2 block">Mozos asignados</Label>
              {assignments.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">Ningun mozo asignado</p>
              ) : (
                <div className="space-y-2">
                  {assignments.map((a: any) => (
                    <div
                      key={a.id}
                      className="flex items-center justify-between p-2 rounded-lg border"
                    >
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary">
                          {a.user_name?.charAt(0)?.toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{a.user_name}</p>
                          <p className="text-xs text-muted-foreground">{a.user_role}</p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                        disabled={removeAssignment.isPending}
                        onClick={() => removeAssignment.mutate({ tableId: table.id, userId: a.user_id })}
                      >
                        <UserMinus className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Add waiter */}
            <div>
              <Label className="text-sm mb-2 block">Agregar mozo</Label>
              <Select
                key={assignKey}
                onValueChange={(userId) => {
                  assignWaiter.mutate(
                    { tableId: table.id, userId },
                    { onSuccess: () => setAssignKey((k) => k + 1) }
                  );
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar mozo..." />
                </SelectTrigger>
                <SelectContent>
                  {waiters
                    .filter((w: any) => !assignments.some((a: any) => a.user_id === w.id))
                    .map((w: any) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.name} ({w.role})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
