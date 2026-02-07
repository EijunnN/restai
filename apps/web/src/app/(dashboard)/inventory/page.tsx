"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@restai/ui/components/card";
import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
import { Badge } from "@restai/ui/components/badge";
import { Button } from "@restai/ui/components/button";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@restai/ui/components/select";
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
  DialogFooter,
} from "@restai/ui/components/dialog";
import {
  Search,
  Plus,
  AlertTriangle,
  RefreshCw,
  Package,
  ArrowUpDown,
  ChefHat,
  X,
} from "lucide-react";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import {
  useInventoryItems,
  useCreateInventoryItem,
  useCreateMovement,
  useInventoryMovements,
  useInventoryAlerts,
  useRecipe,
  useCreateRecipe,
} from "@/hooks/use-inventory";
import { useBranchSettings } from "@/hooks/use-settings";
import { toast } from "sonner";

const movementTypeLabels: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  purchase: { label: "Compra", variant: "default" },
  consumption: { label: "Consumo", variant: "secondary" },
  waste: { label: "Merma", variant: "destructive" },
  adjustment: { label: "Ajuste", variant: "outline" },
};

function Skeleton({ className }: { className?: string }) {
  return (
    <div className={`animate-pulse bg-muted rounded ${className ?? ""}`} />
  );
}

// ---------------------------------------------------------------------------
// Create Item Dialog
// ---------------------------------------------------------------------------
function CreateItemDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createItem = useCreateInventoryItem();
  const [form, setForm] = useState({
    name: "",
    unit: "kg",
    currentStock: "",
    minStock: "",
    costPerUnit: "",
    category: "",
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name) return;
    try {
      await createItem.mutateAsync({
        name: form.name,
        unit: form.unit,
        currentStock: parseFloat(form.currentStock) || 0,
        minStock: parseFloat(form.minStock) || 0,
        costPerUnit: Math.round(parseFloat(form.costPerUnit || "0") * 100),
        category: form.category || undefined,
      });
      setForm({
        name: "",
        unit: "kg",
        currentStock: "",
        minStock: "",
        costPerUnit: "",
        category: "",
      });
      onOpenChange(false);
      toast.success("Item creado exitosamente");
    } catch (err) {
      toast.error(`Error: ${(err as Error).message}`);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo Item de Inventario</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="itemName">Nombre *</Label>
            <Input
              id="itemName"
              placeholder="Ej: Arroz, Pollo, Aceite..."
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="itemCategory">Categoria</Label>
            <Input
              id="itemCategory"
              placeholder="Ej: Carnes, Verduras, Lacteos..."
              value={form.category}
              onChange={(e) =>
                setForm({ ...form, category: e.target.value })
              }
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="itemUnit">Unidad</Label>
              <Select
                value={form.unit}
                onValueChange={(v) => setForm({ ...form, unit: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar unidad..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="kg">Kilogramos (kg)</SelectItem>
                  <SelectItem value="g">Gramos (g)</SelectItem>
                  <SelectItem value="lt">Litros (lt)</SelectItem>
                  <SelectItem value="ml">Mililitros (ml)</SelectItem>
                  <SelectItem value="und">Unidades (und)</SelectItem>
                  <SelectItem value="paq">Paquetes (paq)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="itemCost">Costo por unidad (S/)</Label>
              <Input
                id="itemCost"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={form.costPerUnit}
                onChange={(e) =>
                  setForm({ ...form, costPerUnit: e.target.value })
                }
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="itemStock">Stock Inicial</Label>
              <Input
                id="itemStock"
                type="number"
                step="0.001"
                min="0"
                placeholder="0"
                value={form.currentStock}
                onChange={(e) =>
                  setForm({ ...form, currentStock: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="itemMinStock">Stock Minimo</Label>
              <Input
                id="itemMinStock"
                type="number"
                step="0.001"
                min="0"
                placeholder="0"
                value={form.minStock}
                onChange={(e) =>
                  setForm({ ...form, minStock: e.target.value })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={createItem.isPending || !form.name}>
              {createItem.isPending ? "Creando..." : "Crear Item"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Create Movement Dialog
// ---------------------------------------------------------------------------
function CreateMovementDialog({
  open,
  onOpenChange,
  items,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: any[];
}) {
  const createMovement = useCreateMovement();
  const [form, setForm] = useState({
    itemId: "none",
    type: "purchase",
    quantity: "",
    reference: "",
    notes: "",
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.itemId || form.itemId === "none" || !form.quantity) return;
    try {
      await createMovement.mutateAsync({
        itemId: form.itemId,
        type: form.type,
        quantity: parseFloat(form.quantity),
        reference: form.reference || undefined,
        notes: form.notes || undefined,
      });
      setForm({
        itemId: "none",
        type: "purchase",
        quantity: "",
        reference: "",
        notes: "",
      });
      onOpenChange(false);
      toast.success("Movimiento registrado exitosamente");
    } catch (err) {
      toast.error(`Error: ${(err as Error).message}`);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo Movimiento</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="movItem">Item *</Label>
            <Select
              value={form.itemId}
              onValueChange={(v) => setForm({ ...form, itemId: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar item..." />
              </SelectTrigger>
              <SelectContent>
                {items.map((item: any) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name} ({item.unit}) - Stock:{" "}
                    {parseFloat(item.current_stock).toFixed(2)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="movType">Tipo</Label>
              <Select
                value={form.type}
                onValueChange={(v) => setForm({ ...form, type: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar tipo..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="purchase">Compra</SelectItem>
                  <SelectItem value="consumption">Consumo</SelectItem>
                  <SelectItem value="waste">Merma</SelectItem>
                  <SelectItem value="adjustment">Ajuste</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="movQty">Cantidad *</Label>
              <Input
                id="movQty"
                type="number"
                step="0.001"
                placeholder="0"
                value={form.quantity}
                onChange={(e) =>
                  setForm({ ...form, quantity: e.target.value })
                }
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="movRef">Referencia</Label>
            <Input
              id="movRef"
              placeholder="N. factura, proveedor, etc."
              value={form.reference}
              onChange={(e) =>
                setForm({ ...form, reference: e.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="movNotes">Notas</Label>
            <Input
              id="movNotes"
              placeholder="Observaciones..."
              value={form.notes}
              onChange={(e) =>
                setForm({ ...form, notes: e.target.value })
              }
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={
                createMovement.isPending || !form.itemId || form.itemId === "none" || !form.quantity
              }
            >
              {createMovement.isPending
                ? "Registrando..."
                : "Registrar Movimiento"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Create Recipe Dialog
// ---------------------------------------------------------------------------
function CreateRecipeDialog({
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

// ---------------------------------------------------------------------------
// Items Tab
// ---------------------------------------------------------------------------
function ItemsTab({
  items,
  isLoading,
  search,
  setSearch,
  onNewItem,
}: {
  items: any[];
  isLoading: boolean;
  search: string;
  setSearch: (s: string) => void;
  onNewItem: () => void;
}) {
  const filteredItems = items.filter((item: any) =>
    item.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar item..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={onNewItem}>
          <Plus className="h-4 w-4 mr-2" />
          Nuevo Item
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left p-3 text-sm font-medium text-muted-foreground">
                    Nombre
                  </th>
                  <th className="text-center p-3 text-sm font-medium text-muted-foreground hidden sm:table-cell">
                    Unidad
                  </th>
                  <th className="text-right p-3 text-sm font-medium text-muted-foreground">
                    Stock Actual
                  </th>
                  <th className="text-right p-3 text-sm font-medium text-muted-foreground hidden md:table-cell">
                    Stock Min.
                  </th>
                  <th className="text-right p-3 text-sm font-medium text-muted-foreground hidden md:table-cell">
                    Costo
                  </th>
                  <th className="text-center p-3 text-sm font-medium text-muted-foreground">
                    Estado
                  </th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-b border-border">
                      <td className="p-3">
                        <Skeleton className="h-4 w-28" />
                      </td>
                      <td className="p-3 hidden sm:table-cell">
                        <Skeleton className="h-4 w-12 mx-auto" />
                      </td>
                      <td className="p-3">
                        <Skeleton className="h-4 w-10 ml-auto" />
                      </td>
                      <td className="p-3 hidden md:table-cell">
                        <Skeleton className="h-4 w-10 ml-auto" />
                      </td>
                      <td className="p-3 hidden md:table-cell">
                        <Skeleton className="h-4 w-14 ml-auto" />
                      </td>
                      <td className="p-3">
                        <Skeleton className="h-5 w-12 mx-auto rounded-full" />
                      </td>
                    </tr>
                  ))
                ) : filteredItems.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="p-8 text-center text-sm text-muted-foreground"
                    >
                      {search
                        ? "No se encontraron items"
                        : "No hay items en inventario"}
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item: any) => {
                    const currentStock = parseFloat(
                      item.current_stock ?? "0"
                    );
                    const minStock = parseFloat(item.min_stock ?? "0");
                    const costPerUnit = item.cost_per_unit ?? 0;
                    const isLow = currentStock < minStock;
                    return (
                      <tr
                        key={item.id}
                        className={cn(
                          "border-b border-border last:border-0 hover:bg-muted/50 transition-colors",
                          isLow && "bg-destructive/5"
                        )}
                      >
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            {isLow && (
                              <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                            )}
                            <span className="font-medium text-sm text-foreground">
                              {item.name}
                            </span>
                          </div>
                        </td>
                        <td className="p-3 text-sm text-center text-muted-foreground hidden sm:table-cell">
                          {item.unit}
                        </td>
                        <td
                          className={cn(
                            "p-3 text-sm font-medium text-right",
                            isLow
                              ? "text-destructive"
                              : "text-foreground"
                          )}
                        >
                          {currentStock.toFixed(2)}
                        </td>
                        <td className="p-3 text-sm text-right text-muted-foreground hidden md:table-cell">
                          {minStock.toFixed(2)}
                        </td>
                        <td className="p-3 text-sm text-right text-muted-foreground hidden md:table-cell">
                          {formatCurrency(costPerUnit)}
                        </td>
                        <td className="p-3 text-center">
                          <Badge
                            variant={isLow ? "destructive" : "secondary"}
                          >
                            {isLow ? "Bajo" : "OK"}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Movements Tab
// ---------------------------------------------------------------------------
function MovementsTab({
  movements,
  onNewMovement,
}: {
  movements: any[];
  onNewMovement: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={onNewMovement}>
          <ArrowUpDown className="h-4 w-4 mr-2" />
          Nuevo Movimiento
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left p-3 text-sm font-medium text-muted-foreground">
                    Tipo
                  </th>
                  <th className="text-left p-3 text-sm font-medium text-muted-foreground">
                    Item
                  </th>
                  <th className="text-right p-3 text-sm font-medium text-muted-foreground">
                    Cantidad
                  </th>
                  <th className="text-left p-3 text-sm font-medium text-muted-foreground hidden sm:table-cell">
                    Referencia
                  </th>
                  <th className="text-right p-3 text-sm font-medium text-muted-foreground hidden md:table-cell">
                    Fecha
                  </th>
                </tr>
              </thead>
              <tbody>
                {movements.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="p-8 text-center text-sm text-muted-foreground"
                    >
                      No hay movimientos registrados
                    </td>
                  </tr>
                ) : (
                  movements.map((mov: any) => {
                    const typeConfig =
                      movementTypeLabels[mov.type] ||
                      movementTypeLabels.adjustment;
                    return (
                      <tr
                        key={mov.id}
                        className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors"
                      >
                        <td className="p-3">
                          <Badge variant={typeConfig.variant}>
                            {typeConfig.label}
                          </Badge>
                        </td>
                        <td className="p-3 text-sm font-medium text-foreground">
                          {mov.item_name || "-"}
                        </td>
                        <td className="p-3 text-sm text-right font-medium text-foreground">
                          {parseFloat(mov.quantity).toFixed(3)}
                        </td>
                        <td className="p-3 text-sm text-muted-foreground hidden sm:table-cell">
                          {mov.reference || "-"}
                        </td>
                        <td className="p-3 text-sm text-muted-foreground text-right hidden md:table-cell">
                          {mov.created_at
                            ? formatDate(mov.created_at)
                            : "-"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recipes Tab
// ---------------------------------------------------------------------------
function RecipesTab({
  items,
  onNewRecipe,
}: {
  items: any[];
  onNewRecipe: () => void;
}) {
  const [recipeMenuItemId, setRecipeMenuItemId] = useState("");
  const { data: recipeData } = useRecipe(recipeMenuItemId);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          Configura las recetas para deducir inventario automaticamente cuando
          se completa una orden.
        </p>
        <Button onClick={onNewRecipe}>
          <Plus className="h-4 w-4 mr-2" />
          Nueva Receta
        </Button>
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="space-y-2">
            <Label>Ver receta de un item del menu</Label>
            <Input
              placeholder="ID del item del menu (UUID)"
              value={recipeMenuItemId}
              onChange={(e) => setRecipeMenuItemId(e.target.value)}
            />
          </div>
          {recipeMenuItemId && recipeData && (
            <div>
              <p className="text-sm font-medium text-foreground mb-2">
                Ingredientes:
              </p>
              {(recipeData as any[]).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Sin receta configurada
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="text-left p-2 text-sm font-medium text-muted-foreground">
                          Ingrediente
                        </th>
                        <th className="text-right p-2 text-sm font-medium text-muted-foreground">
                          Cantidad
                        </th>
                        <th className="text-center p-2 text-sm font-medium text-muted-foreground">
                          Unidad
                        </th>
                        <th className="text-right p-2 text-sm font-medium text-muted-foreground">
                          Stock
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {(recipeData as any[]).map(
                        (ing: any, i: number) => (
                          <tr
                            key={i}
                            className="border-b border-border last:border-0"
                          >
                            <td className="p-2 text-sm text-foreground">
                              {ing.item_name}
                            </td>
                            <td className="p-2 text-sm text-right text-foreground">
                              {parseFloat(ing.quantity_used).toFixed(3)}
                            </td>
                            <td className="p-2 text-sm text-center text-muted-foreground">
                              {ing.item_unit}
                            </td>
                            <td className="p-2 text-sm text-right text-muted-foreground">
                              {parseFloat(ing.current_stock).toFixed(2)}
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------
export default function InventoryPage() {
  const [activeTab, setActiveTab] = useState("stock");
  const [search, setSearch] = useState("");
  const [newItemOpen, setNewItemOpen] = useState(false);
  const [newMovementOpen, setNewMovementOpen] = useState(false);
  const [recipeDialogOpen, setRecipeDialogOpen] = useState(false);

  const { data: branchData } = useBranchSettings();
  const inventoryEnabled = branchData?.settings?.inventory_enabled ?? false;

  const {
    data: itemsData,
    isLoading,
    error,
    refetch,
  } = useInventoryItems();
  const { data: movementsData } = useInventoryMovements();
  const { data: alertsData } = useInventoryAlerts();

  const items: any[] = itemsData ?? [];
  const movements: any[] = movementsData ?? [];
  const alerts: any[] = alertsData ?? [];

  if (!inventoryEnabled && branchData) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Inventario</h1>
          <p className="text-muted-foreground">
            Control de stock y recetas
          </p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Package className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium mb-2">Inventario desactivado</p>
            <p className="text-sm text-muted-foreground text-center max-w-md mb-4">
              El control de inventario no esta activado para esta sede. Puedes activarlo desde la configuracion de la sede.
            </p>
            <Button variant="outline" onClick={() => window.location.href = "/settings"}>
              Ir a Configuracion
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Inventario</h1>
        </div>
        <div className="p-4 rounded-lg border border-destructive/50 bg-destructive/10 flex items-center justify-between">
          <p className="text-sm text-destructive">
            Error al cargar inventario: {(error as Error).message}
          </p>
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
      {/* Low-stock alert banner */}
      {alerts.length > 0 && (
        <div className="p-3 rounded-lg border border-destructive/50 bg-destructive/10 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
          <div>
            <p className="text-sm font-medium text-destructive">
              {alerts.length}{" "}
              {alerts.length === 1 ? "item" : "items"} bajo stock minimo
            </p>
            <p className="text-xs text-destructive/80">
              {alerts.map((a: any) => a.name).join(", ")}
            </p>
          </div>
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold text-foreground">Inventario</h1>
        <p className="text-muted-foreground">
          {isLoading
            ? "Cargando..."
            : `${items.length} items en total`}
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="stock">
            <Package className="h-4 w-4 mr-1" />
            Items
          </TabsTrigger>
          <TabsTrigger value="movements">
            <ArrowUpDown className="h-4 w-4 mr-1" />
            Movimientos
          </TabsTrigger>
          <TabsTrigger value="recipes">
            <ChefHat className="h-4 w-4 mr-1" />
            Recetas
          </TabsTrigger>
        </TabsList>

        <TabsContent value="stock">
          <ItemsTab
            items={items}
            isLoading={isLoading}
            search={search}
            setSearch={setSearch}
            onNewItem={() => setNewItemOpen(true)}
          />
        </TabsContent>

        <TabsContent value="movements">
          <MovementsTab
            movements={movements}
            onNewMovement={() => setNewMovementOpen(true)}
          />
        </TabsContent>

        <TabsContent value="recipes">
          <RecipesTab
            items={items}
            onNewRecipe={() => setRecipeDialogOpen(true)}
          />
        </TabsContent>
      </Tabs>

      <CreateItemDialog
        open={newItemOpen}
        onOpenChange={setNewItemOpen}
      />
      <CreateMovementDialog
        open={newMovementOpen}
        onOpenChange={setNewMovementOpen}
        items={items}
      />
      <CreateRecipeDialog
        open={recipeDialogOpen}
        onOpenChange={setRecipeDialogOpen}
        items={items}
      />
    </div>
  );
}
