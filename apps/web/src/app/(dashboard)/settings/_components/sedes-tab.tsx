"use client";

import { useState } from "react";
import { Card, CardContent } from "@restai/ui/components/card";
import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
import { Button } from "@restai/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@restai/ui/components/dialog";
import { Plus, Pencil, Store } from "lucide-react";
import { useBranches, useCreateBranch, useUpdateBranchById } from "@/hooks/use-settings";
import { toast } from "sonner";

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className ?? ""}`} />;
}

function slugify(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

export function SedesTab() {
  const { data: branches, isLoading: branchesLoading } = useBranches();
  const createBranch = useCreateBranch();
  const updateBranchById = useUpdateBranchById();

  const [branchDialogOpen, setBranchDialogOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState<any>(null);
  const [branchDialogForm, setBranchDialogForm] = useState({
    name: "",
    slug: "",
    address: "",
    phone: "",
  });
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);

  const openCreateBranchDialog = () => {
    setEditingBranch(null);
    setBranchDialogForm({ name: "", slug: "", address: "", phone: "" });
    setSlugManuallyEdited(false);
    setBranchDialogOpen(true);
  };

  const openEditBranchDialog = (branch: any) => {
    setEditingBranch(branch);
    setBranchDialogForm({
      name: branch.name || "",
      slug: branch.slug || "",
      address: branch.address || "",
      phone: branch.phone || "",
    });
    setSlugManuallyEdited(true);
    setBranchDialogOpen(true);
  };

  const handleBranchDialogSave = async () => {
    try {
      if (editingBranch) {
        await updateBranchById.mutateAsync({
          id: editingBranch.id,
          name: branchDialogForm.name,
          slug: branchDialogForm.slug,
          address: branchDialogForm.address,
          phone: branchDialogForm.phone,
        });
        toast.success("Sede actualizada correctamente");
      } else {
        await createBranch.mutateAsync({
          name: branchDialogForm.name,
          slug: branchDialogForm.slug,
          address: branchDialogForm.address || undefined,
          phone: branchDialogForm.phone || undefined,
        });
        toast.success("Sede creada correctamente");
      }
      setBranchDialogOpen(false);
    } catch (err: any) {
      toast.error(err.message || "Error al guardar sede");
    }
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Todas las Sedes</h2>
          <p className="text-sm text-muted-foreground">Gestiona las sedes de tu organizacion</p>
        </div>
        <Button size="sm" onClick={openCreateBranchDialog}>
          <Plus className="h-4 w-4 mr-2" />
          Nueva Sede
        </Button>
      </div>

      {branchesLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : !branches || branches.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Store className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No hay sedes configuradas</p>
            <Button className="mt-4" size="sm" onClick={openCreateBranchDialog}>
              <Plus className="h-4 w-4 mr-2" />
              Crear primera sede
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {branches.map((branch: any) => (
            <Card key={branch.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center justify-center h-10 w-10 rounded-full bg-primary/10 text-primary border border-primary/20">
                      <Store className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-medium">{branch.name}</p>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{branch.slug}</span>
                        {branch.address && <span>· {branch.address}</span>}
                        {branch.phone && <span>· {branch.phone}</span>}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEditBranchDialog(branch)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={branchDialogOpen} onOpenChange={setBranchDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingBranch ? "Editar Sede" : "Nueva Sede"}</DialogTitle>
            <DialogDescription>
              {editingBranch ? "Modifica los datos de la sede" : "Agrega una nueva sede a tu organizacion"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="dialogBranchName">Nombre</Label>
              <Input
                id="dialogBranchName"
                placeholder="Sede Centro"
                value={branchDialogForm.name}
                onChange={(e) => {
                  const name = e.target.value;
                  setBranchDialogForm({
                    ...branchDialogForm,
                    name,
                    slug: slugManuallyEdited ? branchDialogForm.slug : slugify(name),
                  });
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dialogBranchSlug">Slug (URL)</Label>
              <Input
                id="dialogBranchSlug"
                placeholder="sede-centro"
                value={branchDialogForm.slug}
                onChange={(e) => {
                  setSlugManuallyEdited(true);
                  setBranchDialogForm({ ...branchDialogForm, slug: e.target.value });
                }}
              />
              <p className="text-xs text-muted-foreground">
                Identificador unico para URLs y codigos QR
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dialogBranchAddress">Direccion</Label>
              <Input
                id="dialogBranchAddress"
                placeholder="Av. Principal 123"
                value={branchDialogForm.address}
                onChange={(e) => setBranchDialogForm({ ...branchDialogForm, address: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dialogBranchPhone">Telefono</Label>
              <Input
                id="dialogBranchPhone"
                placeholder="+51 999 999 999"
                value={branchDialogForm.phone}
                onChange={(e) => setBranchDialogForm({ ...branchDialogForm, phone: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBranchDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleBranchDialogSave}
              disabled={!branchDialogForm.name || !branchDialogForm.slug || createBranch.isPending || updateBranchById.isPending}
            >
              {(createBranch.isPending || updateBranchById.isPending) ? "Guardando..." : editingBranch ? "Guardar" : "Crear Sede"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
