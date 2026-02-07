"use client";

import { useState } from "react";
import { Button } from "@restai/ui/components/button";
import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@restai/ui/components/dialog";
import {
  useCreateCategory,
  useUpdateCategory,
} from "@/hooks/use-menu";
import { toast } from "sonner";
import { ImageUploadButton } from "./image-upload-button";

export function CategoryDialog({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: any;
}) {
  const isEdit = !!initial;
  const createCat = useCreateCategory();
  const updateCat = useUpdateCategory();

  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [imageUrl, setImageUrl] = useState<string>(initial?.image_url ?? "");

  const loading = createCat.isPending || updateCat.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      if (isEdit) {
        await updateCat.mutateAsync({
          id: initial.id,
          name: name.trim(),
          description: description.trim() || undefined,
          imageUrl: imageUrl || undefined,
        });
        toast.success("Categoria actualizada");
      } else {
        await createCat.mutateAsync({
          name: name.trim(),
          description: description.trim() || undefined,
          imageUrl: imageUrl || undefined,
        });
        toast.success("Categoria creada");
      }
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Error al guardar");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Editar Categoria" : "Nueva Categoria"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cat-name">Nombre</Label>
            <Input
              id="cat-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Entradas"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cat-desc">Descripcion</Label>
            <Input
              id="cat-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descripcion opcional"
            />
          </div>
          <div className="space-y-2">
            <Label>Imagen</Label>
            <ImageUploadButton
              currentUrl={imageUrl || null}
              onUploaded={(url) => setImageUrl(url)}
              uploadType="category"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Guardando..." : isEdit ? "Actualizar" : "Crear"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
