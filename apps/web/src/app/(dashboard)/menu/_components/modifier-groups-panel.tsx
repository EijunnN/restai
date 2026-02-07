"use client";

import { useState } from "react";
import { Button } from "@restai/ui/components/button";
import { Badge } from "@restai/ui/components/badge";
import {
  Plus,
  Edit,
  Trash2,
  Settings2,
  GripVertical,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useModifierGroups, useDeleteModifierGroup } from "@/hooks/use-menu";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ModifierGroupDialog } from "./modifier-group-dialog";

function Skeleton({ className }: { className?: string }) {
  return (
    <div className={`animate-pulse bg-muted rounded ${className ?? ""}`} />
  );
}

export function ModifierGroupsPanel() {
  const { data: groups, isLoading } = useModifierGroups();
  const deleteGroup = useDeleteModifierGroup();

  const [editGroup, setEditGroup] = useState<any>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<any>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const groupList: any[] = groups ?? [];

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      await deleteGroup.mutateAsync(confirmDelete.id);
      toast.success("Grupo eliminado");
    } catch (err: any) {
      toast.error(err.message || "Error al eliminar");
    }
    setConfirmDelete(null);
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {groupList.length} grupo{groupList.length !== 1 ? "s" : ""} creado
          {groupList.length !== 1 ? "s" : ""}
        </p>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Nuevo grupo
        </Button>
      </div>

      {groupList.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-lg">
          <Settings2 className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground mb-3">
            No hay grupos de modificadores
          </p>
          <p className="text-xs text-muted-foreground mb-4">
            Los modificadores permiten personalizar los productos (tamano,
            extras, salsas, etc.)
          </p>
          <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Crear primer grupo
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {groupList.map((group: any) => {
            const isExpanded = expandedId === group.id;
            const modifiers: any[] = group.modifiers ?? [];
            return (
              <div
                key={group.id}
                className="rounded-lg border border-border bg-card overflow-hidden"
              >
                {/* Group header */}
                <div
                  className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() =>
                    setExpandedId(isExpanded ? null : group.id)
                  }
                >
                  <div className="flex items-center gap-3">
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                    <div>
                      <p className="text-sm font-medium">{group.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[11px] text-muted-foreground">
                          {modifiers.length} opcion
                          {modifiers.length !== 1 ? "es" : ""}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          Min: {group.min_selections} / Max:{" "}
                          {group.max_selections}
                        </span>
                        {group.is_required && (
                          <Badge
                            variant="secondary"
                            className="text-[9px] px-1.5 py-0"
                          >
                            Obligatorio
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div
                    className="flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => setEditGroup(group)}
                    >
                      <Edit className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => setConfirmDelete(group)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>

                {/* Expanded modifiers */}
                {isExpanded && modifiers.length > 0 && (
                  <div className="border-t border-border bg-muted/20 px-4 py-2">
                    <div className="space-y-1">
                      {modifiers.map((mod: any) => (
                        <div
                          key={mod.id}
                          className="flex items-center justify-between py-1.5 text-sm"
                        >
                          <div className="flex items-center gap-2">
                            <GripVertical className="h-3 w-3 text-muted-foreground/50" />
                            <span>{mod.name}</span>
                          </div>
                          <span className="text-muted-foreground">
                            {mod.price > 0
                              ? `+${formatCurrency(mod.price)}`
                              : "Gratis"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {isExpanded && modifiers.length === 0 && (
                  <div className="border-t border-border bg-muted/20 px-4 py-3">
                    <p className="text-xs text-muted-foreground text-center">
                      Sin modificadores. Edita el grupo para agregar opciones.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Dialogs */}
      {createOpen && (
        <ModifierGroupDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
        />
      )}
      {editGroup && (
        <ModifierGroupDialog
          open={!!editGroup}
          onOpenChange={(v) => {
            if (!v) setEditGroup(null);
          }}
          initial={editGroup}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          open={!!confirmDelete}
          onOpenChange={(v) => {
            if (!v) setConfirmDelete(null);
          }}
          title="Eliminar grupo"
          description={`Eliminar "${confirmDelete.name}" y todos sus modificadores? Los productos vinculados perderan este grupo.`}
          onConfirm={handleDelete}
          loading={deleteGroup.isPending}
        />
      )}
    </div>
  );
}
