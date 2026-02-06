"use client";

import { useState, useRef } from "react";
import { Button } from "@restai/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@restai/ui/components/card";
import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
import { Badge } from "@restai/ui/components/badge";
import { Select } from "@restai/ui/components/select";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@restai/ui/components/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@restai/ui/components/dialog";
import {
  Plus,
  Search,
  Edit,
  Trash2,
  ToggleLeft,
  ToggleRight,
  RefreshCw,
  Upload,
  Settings2,
  Link2,
  Unlink,
  GripVertical,
  ChevronDown,
  ChevronRight,
  X,
  UtensilsCrossed,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import {
  useCategories,
  useMenuItems,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
  useCreateMenuItem,
  useUpdateMenuItem,
  useDeleteMenuItem,
  useCreateModifierGroup,
  useUpdateModifierGroup,
  useDeleteModifierGroup,
  useModifierGroups,
  useAddModifier,
  useUpdateModifier,
  useDeleteModifier,
  useItemModifierGroups,
  useLinkModifierGroup,
  useUnlinkModifierGroup,
} from "@/hooks/use-menu";
import { useUploadImage } from "@/hooks/use-uploads";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function Skeleton({ className }: { className?: string }) {
  return (
    <div className={`animate-pulse bg-muted rounded ${className ?? ""}`} />
  );
}

function ImageUploadButton({
  currentUrl,
  onUploaded,
  uploadType = "menu",
}: {
  currentUrl?: string | null;
  onUploaded: (url: string) => void;
  uploadType?: "menu" | "category";
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadImage = useUploadImage();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await uploadImage.mutateAsync({ file, type: uploadType });
      onUploaded(result.url);
      toast.success("Imagen subida");
    } catch (err: any) {
      toast.error(err.message || "Error al subir imagen");
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="flex items-center gap-2">
      {currentUrl && (
        <img
          src={currentUrl}
          alt=""
          className="h-8 w-8 rounded object-cover"
        />
      )}
      <button
        type="button"
        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        onClick={() => fileRef.current?.click()}
        disabled={uploadImage.isPending}
      >
        <Upload className="h-3 w-3" />
        {uploadImage.isPending
          ? "Subiendo..."
          : currentUrl
            ? "Cambiar"
            : "Imagen"}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirm Dialog
// ---------------------------------------------------------------------------
function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  loading,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  onConfirm: () => void;
  loading?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancelar
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={loading}>
            {loading ? "Eliminando..." : "Eliminar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Category Dialog
// ---------------------------------------------------------------------------
function CategoryDialog({
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

// ---------------------------------------------------------------------------
// Product Dialog (with modifier group linking)
// ---------------------------------------------------------------------------
function ProductDialog({
  open,
  onOpenChange,
  categories,
  allModifierGroups,
  initial,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  categories: any[];
  allModifierGroups: any[];
  initial?: any;
}) {
  const isEdit = !!initial;
  const createItem = useCreateMenuItem();
  const updateItem = useUpdateMenuItem();
  const linkGroup = useLinkModifierGroup();
  const unlinkGroup = useUnlinkModifierGroup();

  const { data: linkedGroups, isLoading: linkedLoading } =
    useItemModifierGroups(initial?.id ?? "");

  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [priceSoles, setPriceSoles] = useState(
    initial ? (initial.price / 100).toFixed(2) : ""
  );
  const [categoryId, setCategoryId] = useState(
    initial?.category_id ?? initial?.categoryId ?? categories[0]?.id ?? ""
  );
  const [prepTime, setPrepTime] = useState<string>(
    initial?.preparation_time_min?.toString() ?? ""
  );
  const [imageUrl, setImageUrl] = useState<string>(
    initial?.image_url ?? initial?.imageUrl ?? ""
  );

  const loading = createItem.isPending || updateItem.isPending;
  const linkedGroupIds = (linkedGroups ?? []).map((g: any) => g.id);
  const unlinkedGroups = allModifierGroups.filter(
    (g: any) => !linkedGroupIds.includes(g.id)
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !priceSoles) return;

    const priceInCents = Math.round(parseFloat(priceSoles) * 100);
    if (isNaN(priceInCents) || priceInCents < 0) {
      toast.error("Precio invalido");
      return;
    }

    if (!categoryId) {
      toast.error("Selecciona una categoria");
      return;
    }

    const payload: any = {
      name: name.trim(),
      description: description.trim() || undefined,
      price: priceInCents,
      categoryId,
      imageUrl: imageUrl || undefined,
      preparationTimeMin: prepTime ? parseInt(prepTime, 10) : undefined,
    };

    try {
      if (isEdit) {
        await updateItem.mutateAsync({ id: initial.id, ...payload });
        toast.success("Producto actualizado");
      } else {
        await createItem.mutateAsync(payload);
        toast.success("Producto creado");
      }
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Error al guardar");
    }
  };

  const handleLink = async (groupId: string) => {
    if (!initial?.id) return;
    try {
      await linkGroup.mutateAsync({ itemId: initial.id, groupId });
      toast.success("Grupo vinculado");
    } catch (err: any) {
      toast.error(err.message || "Error al vincular");
    }
  };

  const handleUnlink = async (groupId: string) => {
    if (!initial?.id) return;
    try {
      await unlinkGroup.mutateAsync({ itemId: initial.id, groupId });
      toast.success("Grupo desvinculado");
    } catch (err: any) {
      toast.error(err.message || "Error al desvincular");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Editar Producto" : "Nuevo Producto"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2 col-span-2 sm:col-span-1">
              <Label htmlFor="prod-name">Nombre</Label>
              <Input
                id="prod-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Ceviche clasico"
                required
              />
            </div>
            <div className="space-y-2 col-span-2 sm:col-span-1">
              <Label htmlFor="prod-cat">Categoria</Label>
              <Select
                id="prod-cat"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                required
              >
                {categories.length === 0 && (
                  <option value="">Crea una categoria primero</option>
                )}
                {categories.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="prod-desc">Descripcion</Label>
            <Input
              id="prod-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descripcion opcional"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="prod-price">Precio (S/)</Label>
              <Input
                id="prod-price"
                type="number"
                step="0.01"
                min="0"
                value={priceSoles}
                onChange={(e) => setPriceSoles(e.target.value)}
                placeholder="0.00"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prod-prep">Tiempo prep. (min)</Label>
              <Input
                id="prod-prep"
                type="number"
                min="0"
                value={prepTime}
                onChange={(e) => setPrepTime(e.target.value)}
                placeholder="15"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Imagen</Label>
            <ImageUploadButton
              currentUrl={imageUrl || null}
              onUploaded={(url) => setImageUrl(url)}
            />
          </div>

          {/* Modifier Groups section — only visible when editing */}
          {isEdit && (
            <div className="space-y-3 rounded-lg border border-border p-4 bg-muted/30">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">
                  Grupos de Modificadores
                </Label>
                <Badge variant="secondary" className="text-[10px]">
                  {linkedGroupIds.length} vinculados
                </Badge>
              </div>

              {/* Linked groups */}
              {linkedLoading ? (
                <Skeleton className="h-10" />
              ) : linkedGroupIds.length > 0 ? (
                <div className="space-y-2">
                  {(linkedGroups ?? []).map((g: any) => (
                    <div
                      key={g.id}
                      className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <Link2 className="h-3.5 w-3.5 text-primary" />
                        <span className="text-sm font-medium">{g.name}</span>
                        <span className="text-[10px] text-muted-foreground">
                          ({g.modifiers?.length ?? 0} opciones)
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleUnlink(g.id)}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                        disabled={unlinkGroup.isPending}
                      >
                        <Unlink className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-2">
                  Sin grupos vinculados
                </p>
              )}

              {/* Add group dropdown */}
              {unlinkedGroups.length > 0 && (
                <Select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) handleLink(e.target.value);
                  }}
                >
                  <option value="">+ Vincular grupo...</option>
                  {unlinkedGroups.map((g: any) => (
                    <option key={g.id} value={g.id}>
                      {g.name} ({g.modifiers?.length ?? 0} opciones)
                    </option>
                  ))}
                </Select>
              )}
            </div>
          )}

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

// ---------------------------------------------------------------------------
// Modifier Group Dialog (create / edit with inline modifiers)
// ---------------------------------------------------------------------------
function ModifierGroupDialog({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: any;
}) {
  const isEdit = !!initial;
  const createGroup = useCreateModifierGroup();
  const updateGroup = useUpdateModifierGroup();
  const addModifier = useAddModifier();
  const updateModifier = useUpdateModifier();
  const deleteModifier = useDeleteModifier();

  const [groupName, setGroupName] = useState(initial?.name ?? "");
  const [minSel, setMinSel] = useState(
    initial?.min_selections?.toString() ?? "0"
  );
  const [maxSel, setMaxSel] = useState(
    initial?.max_selections?.toString() ?? "1"
  );
  const [isRequired, setIsRequired] = useState(initial?.is_required ?? false);

  // For new groups: inline modifiers to create
  const [newModifiers, setNewModifiers] = useState<
    { name: string; price: string }[]
  >(isEdit ? [] : [{ name: "", price: "0" }]);

  // For editing: track existing modifiers
  const existingModifiers: any[] = initial?.modifiers ?? [];

  const loading =
    createGroup.isPending ||
    updateGroup.isPending ||
    addModifier.isPending;

  const handleAddRow = () => {
    setNewModifiers((prev) => [...prev, { name: "", price: "0" }]);
  };

  const handleRemoveRow = (idx: number) => {
    setNewModifiers((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleModChange = (
    idx: number,
    field: "name" | "price",
    value: string
  ) => {
    setNewModifiers((prev) =>
      prev.map((m, i) => (i === idx ? { ...m, [field]: value } : m))
    );
  };

  const handleDeleteExistingModifier = async (modId: string) => {
    try {
      await deleteModifier.mutateAsync(modId);
      toast.success("Modificador eliminado");
    } catch (err: any) {
      toast.error(err.message || "Error");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupName.trim()) return;

    try {
      if (isEdit) {
        // Update group metadata
        await updateGroup.mutateAsync({
          id: initial.id,
          name: groupName.trim(),
          minSelections: parseInt(minSel, 10) || 0,
          maxSelections: parseInt(maxSel, 10) || 1,
          isRequired,
        });

        // Add any new modifiers
        const validNew = newModifiers.filter((m) => m.name.trim());
        for (const mod of validNew) {
          await addModifier.mutateAsync({
            groupId: initial.id,
            name: mod.name.trim(),
            price: Math.round(parseFloat(mod.price || "0") * 100),
            isAvailable: true,
          });
        }

        toast.success("Grupo actualizado");
      } else {
        const validMods = newModifiers.filter((m) => m.name.trim());
        if (validMods.length === 0) {
          toast.error("Agrega al menos un modificador");
          return;
        }

        const group = await createGroup.mutateAsync({
          name: groupName.trim(),
          minSelections: parseInt(minSel, 10) || 0,
          maxSelections: parseInt(maxSel, 10) || 1,
          isRequired,
        });

        for (const mod of validMods) {
          await addModifier.mutateAsync({
            groupId: group.id,
            name: mod.name.trim(),
            price: Math.round(parseFloat(mod.price || "0") * 100),
            isAvailable: true,
          });
        }

        toast.success("Grupo creado");
      }
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Error al guardar grupo");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Editar Grupo" : "Nuevo Grupo de Modificadores"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Actualiza el grupo y gestiona sus modificadores"
              : "Crea un grupo con sus opciones. Ej: Tamano, Extras, Salsas"}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="grp-name">Nombre del grupo</Label>
            <Input
              id="grp-name"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Ej: Tamano, Extras"
              required
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="grp-min">Min</Label>
              <Input
                id="grp-min"
                type="number"
                min="0"
                value={minSel}
                onChange={(e) => setMinSel(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="grp-max">Max</Label>
              <Input
                id="grp-max"
                type="number"
                min="1"
                value={maxSel}
                onChange={(e) => setMaxSel(e.target.value)}
              />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={isRequired}
                  onChange={(e) => setIsRequired(e.target.checked)}
                  className="rounded border-input accent-primary"
                />
                Obligatorio
              </label>
            </div>
          </div>

          {/* Existing modifiers (edit mode) */}
          {isEdit && existingModifiers.length > 0 && (
            <div className="space-y-2">
              <Label>Modificadores existentes</Label>
              <div className="space-y-1.5">
                {existingModifiers.map((mod: any) => (
                  <div
                    key={mod.id}
                    className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm">{mod.name}</span>
                      {mod.price > 0 && (
                        <span className="text-xs text-muted-foreground">
                          +{formatCurrency(mod.price)}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteExistingModifier(mod.id)}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                      disabled={deleteModifier.isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* New modifiers */}
          <div className="space-y-2">
            <Label>
              {isEdit ? "Agregar modificadores" : "Modificadores"}
            </Label>
            <div className="space-y-2">
              {newModifiers.map((mod, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Input
                    value={mod.name}
                    onChange={(e) =>
                      handleModChange(idx, "name", e.target.value)
                    }
                    placeholder="Nombre"
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={mod.price}
                    onChange={(e) =>
                      handleModChange(idx, "price", e.target.value)
                    }
                    placeholder="S/"
                    className="w-24"
                  />
                  {newModifiers.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveRow(idx)}
                      className="text-muted-foreground hover:text-destructive shrink-0"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddRow}
            >
              <Plus className="h-3 w-3 mr-1" />
              Agregar opcion
            </Button>
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
              {loading
                ? "Guardando..."
                : isEdit
                  ? "Actualizar"
                  : "Crear grupo"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Modifier Groups Panel (for the "Modificadores" tab)
// ---------------------------------------------------------------------------
function ModifierGroupsPanel() {
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

// ---------------------------------------------------------------------------
// Products Panel (for the "Productos" tab)
// ---------------------------------------------------------------------------
function ProductsPanel({
  categories,
  menuItems,
  allModifierGroups,
  isLoading,
}: {
  categories: any[];
  menuItems: any[];
  allModifierGroups: any[];
  isLoading: boolean;
}) {
  const [search, setSearch] = useState("");
  const updateItem = useUpdateMenuItem();
  const deleteItem = useDeleteMenuItem();
  const deleteCat = useDeleteCategory();

  const [catDialogOpen, setCatDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<any>(null);
  const [prodDialogOpen, setProdDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [confirmDelete, setConfirmDelete] = useState<{
    type: "category" | "product";
    id: string;
    name: string;
  } | null>(null);

  const categoryList: any[] = categories ?? [];
  const allItems: any[] = menuItems ?? [];

  const categoriesWithItems = categoryList.map((cat: any) => ({
    ...cat,
    items: allItems.filter(
      (item: any) => (item.categoryId || item.category_id) === cat.id
    ),
  }));

  const filteredCategories = categoriesWithItems
    .map((cat: any) => ({
      ...cat,
      items: cat.items.filter(
        (item: any) =>
          item.name.toLowerCase().includes(search.toLowerCase()) ||
          (item.description || "")
            .toLowerCase()
            .includes(search.toLowerCase())
      ),
    }))
    .filter((cat: any) => cat.items.length > 0 || !search);

  const handleToggleAvailability = (item: any) => {
    updateItem.mutate(
      {
        id: item.id,
        isAvailable: !(item.isAvailable ?? item.is_available),
      },
      {
        onSuccess: () =>
          toast.success(
            `${item.name} ${!(item.isAvailable ?? item.is_available) ? "disponible" : "no disponible"}`
          ),
      }
    );
  };

  const handleImageUploaded = (item: any, url: string) => {
    updateItem.mutate({ id: item.id, imageUrl: url });
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    try {
      if (confirmDelete.type === "category") {
        await deleteCat.mutateAsync(confirmDelete.id);
        toast.success("Categoria eliminada");
      } else {
        await deleteItem.mutateAsync(confirmDelete.id);
        toast.success("Producto eliminado");
      }
    } catch (err: any) {
      toast.error(err.message || "Error al eliminar");
    }
    setConfirmDelete(null);
  };

  return (
    <div className="space-y-4">
      {/* Actions bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar productos..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEditingCategory(null);
              setCatDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-1" />
            Categoria
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setEditingProduct(null);
              setProdDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-1" />
            Producto
          </Button>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-32" />
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {Array.from({ length: 3 }).map((_, j) => (
                    <Skeleton key={j} className="h-24" />
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredCategories.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-lg">
          <p className="text-sm text-muted-foreground mb-4">
            {search
              ? "No se encontraron productos"
              : "No hay categorias en el menu"}
          </p>
          {!search && (
            <Button
              variant="outline"
              onClick={() => {
                setEditingCategory(null);
                setCatDialogOpen(true);
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              Crear primera categoria
            </Button>
          )}
        </div>
      ) : (
        filteredCategories.map((category: any) => (
          <Card key={category.id}>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div className="flex items-center gap-3">
                {category.image_url && (
                  <img
                    src={category.image_url}
                    alt={category.name}
                    className="h-8 w-8 rounded object-cover"
                  />
                )}
                <div>
                  <CardTitle className="text-base">{category.name}</CardTitle>
                  {category.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {category.description}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Badge variant="secondary" className="text-[10px] mr-1">
                  {category.items.length}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => {
                    setEditingCategory(category);
                    setCatDialogOpen(true);
                  }}
                >
                  <Edit className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() =>
                    setConfirmDelete({
                      type: "category",
                      id: category.id,
                      name: category.name,
                    })
                  }
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {category.items.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Sin productos en esta categoria
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {category.items.map((item: any) => {
                    const available =
                      item.isAvailable ?? item.is_available ?? true;
                    const imageUrl = item.imageUrl || item.image_url;
                    return (
                      <div
                        key={item.id}
                        className={`group relative rounded-lg border overflow-hidden transition-colors hover:border-primary/30 ${
                          !available ? "opacity-60" : ""
                        }`}
                      >
                        {/* Product image — prominent */}
                        <div className="relative w-full h-36 bg-muted">
                          {imageUrl ? (
                            <img
                              src={imageUrl}
                              alt={item.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <UtensilsCrossed className="h-10 w-10 text-muted-foreground/40" />
                            </div>
                          )}
                          {!available && (
                            <Badge
                              variant="secondary"
                              className="absolute top-2 left-2 text-[9px]"
                            >
                              No disp.
                            </Badge>
                          )}
                          {/* Actions overlay */}
                          <div className="absolute top-2 right-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              className="p-1.5 rounded-md bg-background/80 hover:bg-background transition-colors"
                              onClick={() => handleToggleAvailability(item)}
                              title={
                                available
                                  ? "Marcar no disponible"
                                  : "Marcar disponible"
                              }
                            >
                              {available ? (
                                <ToggleRight className="h-4 w-4 text-primary" />
                              ) : (
                                <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                              )}
                            </button>
                            <button
                              className="p-1.5 rounded-md bg-background/80 hover:bg-background transition-colors"
                              onClick={() => {
                                setEditingProduct(item);
                                setProdDialogOpen(true);
                              }}
                            >
                              <Edit className="h-3.5 w-3.5" />
                            </button>
                            <button
                              className="p-1.5 rounded-md bg-background/80 hover:bg-background transition-colors"
                              onClick={() =>
                                setConfirmDelete({
                                  type: "product",
                                  id: item.id,
                                  name: item.name,
                                })
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </button>
                          </div>
                          {/* Image upload overlay */}
                          <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <div className="bg-background/80 rounded-md px-2 py-1">
                              <ImageUploadButton
                                currentUrl={imageUrl}
                                onUploaded={(url) =>
                                  handleImageUploaded(item, url)
                                }
                              />
                            </div>
                          </div>
                        </div>
                        {/* Product info */}
                        <div className="p-3">
                          <h4 className="font-medium text-sm leading-tight truncate">
                            {item.name}
                          </h4>
                          {item.description && (
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                              {item.description}
                            </p>
                          )}
                          <p className="text-sm font-semibold mt-1.5">
                            {formatCurrency(item.price)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        ))
      )}

      {/* Dialogs */}
      {catDialogOpen && (
        <CategoryDialog
          open={catDialogOpen}
          onOpenChange={(v) => {
            setCatDialogOpen(v);
            if (!v) setEditingCategory(null);
          }}
          initial={editingCategory}
        />
      )}
      {prodDialogOpen && (
        <ProductDialog
          open={prodDialogOpen}
          onOpenChange={(v) => {
            setProdDialogOpen(v);
            if (!v) setEditingProduct(null);
          }}
          categories={categoryList}
          allModifierGroups={allModifierGroups}
          initial={editingProduct}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          open={!!confirmDelete}
          onOpenChange={(v) => {
            if (!v) setConfirmDelete(null);
          }}
          title={`Eliminar ${confirmDelete.type === "category" ? "categoria" : "producto"}`}
          description={`Estas seguro que deseas eliminar "${confirmDelete.name}"? Esta accion no se puede deshacer.`}
          onConfirm={handleConfirmDelete}
          loading={deleteCat.isPending || deleteItem.isPending}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------
export default function MenuPage() {
  const {
    data: categories,
    isLoading: categoriesLoading,
    error: categoriesError,
    refetch: refetchCategories,
  } = useCategories();
  const {
    data: menuItems,
    isLoading: itemsLoading,
    error: itemsError,
    refetch: refetchItems,
  } = useMenuItems();
  const { data: modifierGroups } = useModifierGroups();

  const isLoading = categoriesLoading || itemsLoading;
  const error = categoriesError || itemsError;

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Menu</h1>
        </div>
        <div className="p-4 rounded-lg border border-destructive/50 bg-destructive/5 flex items-center justify-between">
          <p className="text-sm text-destructive">
            Error al cargar el menu: {(error as Error).message}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refetchCategories();
              refetchItems();
            }}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Menu</h1>
        <p className="text-muted-foreground">
          Gestiona categorias, productos y modificadores
        </p>
      </div>

      <Tabs defaultValue="products">
        <TabsList>
          <TabsTrigger value="products">Productos</TabsTrigger>
          <TabsTrigger value="modifiers">Modificadores</TabsTrigger>
        </TabsList>
        <TabsContent value="products">
          <ProductsPanel
            categories={categories ?? []}
            menuItems={menuItems ?? []}
            allModifierGroups={modifierGroups ?? []}
            isLoading={isLoading}
          />
        </TabsContent>
        <TabsContent value="modifiers">
          <ModifierGroupsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
