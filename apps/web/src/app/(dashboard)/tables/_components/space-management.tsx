"use client";

import { useState } from "react";
import { Button } from "@restai/ui/components/button";
import { Card, CardContent } from "@restai/ui/components/card";
import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@restai/ui/components/dialog";
import { Edit2, Trash2, LayoutGrid } from "lucide-react";
import { useCreateSpace, useUpdateSpace } from "@/hooks/use-tables";

// --- Space Info Card ---

interface SpaceInfoCardProps {
  space: any;
  tableCount: number;
  onEdit: () => void;
  onDelete: () => void;
}

export function SpaceInfoCard({ space, tableCount, onEdit, onDelete }: SpaceInfoCardProps) {
  return (
    <Card className="mt-4">
      <CardContent className="p-4 flex items-center justify-between">
        <div>
          <h3 className="font-semibold">{space.name}</h3>
          {space.description && (
            <p className="text-sm text-muted-foreground">{space.description}</p>
          )}
          <p className="text-xs text-muted-foreground">
            Piso {space.floor_number} - {tableCount} mesas
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Edit2 className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// --- Create Space Dialog ---

interface CreateSpaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateSpaceDialog({ open, onOpenChange }: CreateSpaceDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [floor, setFloor] = useState("1");
  const createSpace = useCreateSpace();

  const handleCreate = () => {
    if (!name.trim()) return;
    createSpace.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        floorNumber: parseInt(floor) || 1,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          setName("");
          setDescription("");
          setFloor("1");
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo Espacio</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="space-name">Nombre del espacio</Label>
            <Input
              id="space-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Salon Principal, Terraza"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="space-description">Descripcion (opcional)</Label>
            <Input
              id="space-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Area al aire libre..."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="space-floor">Piso</Label>
            <Input
              id="space-floor"
              type="number"
              min={0}
              value={floor}
              onChange={(e) => setFloor(e.target.value)}
              placeholder="1"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleCreate}
            disabled={createSpace.isPending || !name.trim()}
          >
            {createSpace.isPending ? "Creando..." : "Crear Espacio"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Edit Space Dialog ---

interface EditSpaceDialogProps {
  space: any | null;
  onClose: () => void;
}

export function EditSpaceDialog({ space, onClose }: EditSpaceDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [floor, setFloor] = useState("1");
  const updateSpace = useUpdateSpace();

  // Sync form state when space changes
  const [prevSpaceId, setPrevSpaceId] = useState<string | null>(null);
  if (space && space.id !== prevSpaceId) {
    setPrevSpaceId(space.id);
    setName(space.name);
    setDescription(space.description || "");
    setFloor(String(space.floor_number));
  }
  if (!space && prevSpaceId) {
    setPrevSpaceId(null);
  }

  const handleUpdate = () => {
    if (!space || !name.trim()) return;
    updateSpace.mutate(
      {
        id: space.id,
        name: name.trim(),
        description: description.trim() || undefined,
        floorNumber: parseInt(floor) || 1,
      },
      {
        onSuccess: () => onClose(),
      }
    );
  };

  return (
    <Dialog open={!!space} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar Espacio</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="edit-space-name">Nombre</Label>
            <Input
              id="edit-space-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-space-desc">Descripcion</Label>
            <Input
              id="edit-space-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-space-floor">Piso</Label>
            <Input
              id="edit-space-floor"
              type="number"
              min={0}
              value={floor}
              onChange={(e) => setFloor(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={handleUpdate}
            disabled={updateSpace.isPending || !name.trim()}
          >
            {updateSpace.isPending ? "Guardando..." : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
