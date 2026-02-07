"use client";

import { useState } from "react";
import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
import { Button } from "@restai/ui/components/button";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@restai/ui/components/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@restai/ui/components/dialog";
import { Plus, X } from "lucide-react";
import { useCreateRecipe } from "@/hooks/use-inventory";
import { toast } from "sonner";

export function CreateRecipeDialog({
  open,
  onOpenChange,
  items,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: any[];
}) {
  const createRecipe = useCreateRecipe();
  const [form, setForm] = useState({
    menuItemId: "",
    ingredients: [{ inventoryItemId: "", quantityUsed: "" }],
  });

  function addIngredientRow() {
    setForm({
      ...form,
      ingredients: [
        ...form.ingredients,
        { inventoryItemId: "", quantityUsed: "" },
      ],
    });
  }

  function updateIngredient(index: number, field: string, value: string) {
    const updated = [...form.ingredients];
    (updated[index] as any)[field] = value;
    setForm({ ...form, ingredients: updated });
  }

  function removeIngredient(index: number) {
    if (form.ingredients.length <= 1) return;
    const updated = form.ingredients.filter((_, i) => i !== index);
    setForm({ ...form, ingredients: updated });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.menuItemId) return;
    const validIngredients = form.ingredients.filter(
      (i) => i.inventoryItemId && i.quantityUsed
    );
    if (validIngredients.length === 0) return;
    try {
      await createRecipe.mutateAsync({
        menuItemId: form.menuItemId,
        ingredients: validIngredients.map((i) => ({
          inventoryItemId: i.inventoryItemId,
          quantityUsed: parseFloat(i.quantityUsed),
        })),
      });
      setForm({
        menuItemId: "",
        ingredients: [{ inventoryItemId: "", quantityUsed: "" }],
      });
      onOpenChange(false);
      toast.success("Receta guardada exitosamente");
    } catch (err) {
      toast.error(`Error: ${(err as Error).message}`);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Configurar Receta</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="recipeMenuItem">
              ID del Item del Menu (UUID)
            </Label>
            <Input
              id="recipeMenuItem"
              placeholder="UUID del item del menu"
              value={form.menuItemId}
              onChange={(e) =>
                setForm({ ...form, menuItemId: e.target.value })
              }
              required
            />
          </div>
          <div className="space-y-2">
            <Label>Ingredientes</Label>
            {form.ingredients.map((ing, index) => (
              <div key={index} className="flex gap-2 items-center">
                <Select
                  value={ing.inventoryItemId || "none"}
                  onValueChange={(v) =>
                    updateIngredient(
                      index,
                      "inventoryItemId",
                      v === "none" ? "" : v
                    )
                  }
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Seleccionar item..." />
                  </SelectTrigger>
                  <SelectContent>
                    {items.map((item: any) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name} ({item.unit})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  className="w-24"
                  type="number"
                  step="0.001"
                  min="0"
                  placeholder="Cant."
                  value={ing.quantityUsed}
                  onChange={(e) =>
                    updateIngredient(
                      index,
                      "quantityUsed",
                      e.target.value
                    )
                  }
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => removeIngredient(index)}
                  disabled={form.ingredients.length <= 1}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addIngredientRow}
              className="w-full"
            >
              <Plus className="h-3 w-3 mr-1" />
              Agregar ingrediente
            </Button>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={createRecipe.isPending || !form.menuItemId}>
              {createRecipe.isPending ? "Guardando..." : "Guardar Receta"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
