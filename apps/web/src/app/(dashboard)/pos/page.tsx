"use client";

import { useState, useCallback, useEffect } from "react";
import { Input } from "@restai/ui/components/input";
import { Button } from "@restai/ui/components/button";
import { Badge } from "@restai/ui/components/badge";
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
  Minus,
  Trash2,
  ShoppingCart,
  User,
  Check,
  Loader2,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useCategories, useMenuItems, useItemModifierGroups } from "@/hooks/use-menu";
import { useCreateOrder } from "@/hooks/use-orders";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CartModifier {
  modifierId: string;
  name: string;
  price: number;
}

interface PosCartItem {
  lineId: string;
  menuItemId: string;
  name: string;
  imageUrl: string | null;
  unitPrice: number;
  quantity: number;
  notes?: string;
  modifiers: CartModifier[];
}

// ---------------------------------------------------------------------------
// Modifier Selection Dialog (internal)
// ---------------------------------------------------------------------------

function ModifierDialog({
  item,
  open,
  onClose,
  onAdd,
}: {
  item: any;
  open: boolean;
  onClose: () => void;
  onAdd: (item: any, qty: number, mods: CartModifier[], notes: string) => void;
}) {
  const { data: groups, isLoading } = useItemModifierGroups(item?.id ?? "");
  const modifierGroups: any[] = groups ?? [];

  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");

  // Reset on open
  useEffect(() => {
    if (open) {
      setSelected({});
      setQuantity(1);
      setNotes("");
    }
  }, [open]);

  // Auto-add if no modifier groups
  useEffect(() => {
    if (!isLoading && modifierGroups.length === 0 && open && item) {
      onAdd(item, 1, [], "");
      onClose();
    }
  }, [isLoading, modifierGroups.length, open, item]);

  if (!item) return null;

  // If no modifier groups, the useEffect above handles auto-add
  if (!isLoading && modifierGroups.length === 0) return null;

  const toggleModifier = (groupId: string, modId: string, maxSelections: number, isSingle: boolean) => {
    setSelected((prev) => {
      const curr = prev[groupId] || [];
      if (isSingle) {
        return { ...prev, [groupId]: curr.includes(modId) ? [] : [modId] };
      }
      if (curr.includes(modId)) {
        return { ...prev, [groupId]: curr.filter((id) => id !== modId) };
      }
      if (maxSelections && curr.length >= maxSelections) return prev;
      return { ...prev, [groupId]: [...curr, modId] };
    });
  };

  const modifiersTotal = Object.entries(selected).reduce((sum, [groupId, modIds]) => {
    const group = modifierGroups.find((g: any) => g.id === groupId);
    if (!group) return sum;
    return sum + modIds.reduce((ms, modId) => {
      const mod = group.modifiers.find((m: any) => m.id === modId);
      return ms + (mod?.price || 0);
    }, 0);
  }, 0);

  const lineTotal = (item.price + modifiersTotal) * quantity;

  const hasRequiredErrors = modifierGroups.some((g: any) => {
    if (!g.is_required) return false;
    const sel = selected[g.id] || [];
    return sel.length < (g.min_selections || 1);
  });

  const handleConfirm = () => {
    const cartMods: CartModifier[] = [];
    for (const [groupId, modIds] of Object.entries(selected)) {
      const group = modifierGroups.find((g: any) => g.id === groupId);
      if (!group) continue;
      for (const modId of modIds) {
        const mod = group.modifiers.find((m: any) => m.id === modId);
        if (mod) cartMods.push({ modifierId: mod.id, name: mod.name, price: mod.price || 0 });
      }
    }
    onAdd(item, quantity, cartMods, notes);
    onClose();
  };

  return (
    <Dialog open={open && (isLoading || modifierGroups.length > 0)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            {item.image_url ? (
              <img src={item.image_url} alt="" className="h-12 w-12 rounded-lg object-cover" />
            ) : (
              <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center">
                <UtensilsCrossed className="h-5 w-5 text-muted-foreground/50" />
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate">{item.name}</p>
              <p className="text-sm font-normal text-primary">{formatCurrency(item.price)}</p>
            </div>
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-4 py-2">
            {/* Modifier groups */}
            {modifierGroups.map((group: any) => {
              const isSingle = group.max_selections === 1;
              const sel = selected[group.id] || [];

              return (
                <div key={group.id}>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold">
                      {group.name}
                      {group.is_required && (
                        <span className="ml-1.5 text-xs font-normal text-destructive">
                          * Requerido
                        </span>
                      )}
                    </p>
                    {group.max_selections > 1 && (
                      <span className="text-xs text-muted-foreground">
                        Max {group.max_selections}
                      </span>
                    )}
                  </div>
                  <div className="space-y-1">
                    {(group.modifiers || []).filter((m: any) => m.is_available !== false).map((mod: any) => {
                      const isSelected = sel.includes(mod.id);
                      return (
                        <button
                          key={mod.id}
                          type="button"
                          onClick={() => toggleModifier(group.id, mod.id, group.max_selections, isSingle)}
                          className={`w-full flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                            isSelected
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-primary/40"
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <div
                              className={`flex h-4.5 w-4.5 items-center justify-center ${
                                isSingle ? "rounded-full" : "rounded"
                              } border-2 transition-colors ${
                                isSelected ? "border-primary bg-primary" : "border-muted-foreground/30"
                              }`}
                            >
                              {isSelected && (
                                <Check className="h-2.5 w-2.5 text-primary-foreground" />
                              )}
                            </div>
                            <span className={isSelected ? "font-medium" : ""}>{mod.name}</span>
                          </div>
                          {mod.price > 0 && (
                            <span className="text-xs text-muted-foreground">
                              +{formatCurrency(mod.price)}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Notes */}
            <div>
              <p className="text-sm font-semibold mb-1.5">Notas (opcional)</p>
              <Input
                placeholder="Sin cebolla, extra picante..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="text-sm"
              />
            </div>
          </div>
        )}

        {!isLoading && modifierGroups.length > 0 && (
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            {/* Quantity */}
            <div className="flex items-center justify-between w-full">
              <span className="text-sm font-medium text-muted-foreground">Cantidad</span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  disabled={quantity <= 1}
                >
                  <Minus className="h-3 w-3" />
                </Button>
                <span className="w-6 text-center font-bold">{quantity}</span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setQuantity(quantity + 1)}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <Button
              className="w-full h-11"
              disabled={hasRequiredErrors}
              onClick={handleConfirm}
            >
              <Plus className="h-4 w-4 mr-2" />
              Agregar · {formatCurrency(lineTotal)}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main POS Page
// ---------------------------------------------------------------------------

let lineCounter = 0;
function nextLineId() {
  return `line-${++lineCounter}-${Date.now()}`;
}

export default function PosPage() {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<PosCartItem[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [orderType, setOrderType] = useState<"dine_in" | "takeout">("dine_in");
  const [successDialog, setSuccessDialog] = useState(false);
  const [lastOrderNumber, setLastOrderNumber] = useState("");

  // Modifier dialog state
  const [modDialogItem, setModDialogItem] = useState<any>(null);
  const [modDialogOpen, setModDialogOpen] = useState(false);

  const { data: categories } = useCategories();
  const { data: menuItems, isLoading: itemsLoading } = useMenuItems(selectedCategory || undefined);
  const createOrder = useCreateOrder();

  const allItems: any[] = menuItems ?? [];
  const filteredItems = allItems.filter((item: any) => {
    if (!item.is_available) return false;
    if (search) return item.name.toLowerCase().includes(search.toLowerCase());
    return true;
  });

  const handleItemClick = useCallback((item: any) => {
    setModDialogItem(item);
    setModDialogOpen(true);
  }, []);

  const handleAddFromDialog = useCallback(
    (item: any, qty: number, mods: CartModifier[], notes: string) => {
      // If no modifiers and item already in cart, just increment
      if (mods.length === 0) {
        const existing = cart.find(
          (c) => c.menuItemId === item.id && c.modifiers.length === 0
        );
        if (existing) {
          setCart((prev) =>
            prev.map((c) =>
              c.lineId === existing.lineId ? { ...c, quantity: c.quantity + qty } : c
            )
          );
          return;
        }
      }

      setCart((prev) => [
        ...prev,
        {
          lineId: nextLineId(),
          menuItemId: item.id,
          name: item.name,
          imageUrl: item.image_url || null,
          unitPrice: item.price,
          quantity: qty,
          notes: notes || undefined,
          modifiers: mods,
        },
      ]);
    },
    [cart]
  );

  const updateCartQty = (lineId: string, qty: number) => {
    if (qty <= 0) {
      setCart((prev) => prev.filter((c) => c.lineId !== lineId));
    } else {
      setCart((prev) => prev.map((c) => (c.lineId === lineId ? { ...c, quantity: qty } : c)));
    }
  };

  const removeFromCart = (lineId: string) => {
    setCart((prev) => prev.filter((c) => c.lineId !== lineId));
  };

  const subtotal = cart.reduce((sum, item) => {
    const modTotal = item.modifiers.reduce((ms, m) => ms + m.price, 0);
    return sum + (item.unitPrice + modTotal) * item.quantity;
  }, 0);
  const tax = Math.round((subtotal * 1800) / 10000); // 18% IGV
  const total = subtotal + tax;
  const totalQty = cart.reduce((sum, item) => sum + item.quantity, 0);

  const handleCreateOrder = async () => {
    if (cart.length === 0) return;
    try {
      const result = await createOrder.mutateAsync({
        type: orderType,
        customerName: customerName || "Cliente POS",
        items: cart.map((item) => ({
          menuItemId: item.menuItemId,
          quantity: item.quantity,
          notes: item.notes || undefined,
          modifiers: item.modifiers.map((m) => ({ modifierId: m.modifierId })),
        })),
        notes: orderNotes || undefined,
      });

      setLastOrderNumber(result.order_number || result.orderNumber || "");
      setCart([]);
      setCustomerName("");
      setOrderNotes("");
      setSuccessDialog(true);
      toast.success("Orden creada exitosamente");
    } catch (err: any) {
      toast.error(err.message || "Error al crear orden");
    }
  };

  return (
    <div className="flex gap-4 h-[calc(100vh-8rem)]">
      {/* ── Left: Product grid ── */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="mb-3">
          <h1 className="text-2xl font-bold">Punto de Venta</h1>
          <p className="text-muted-foreground text-sm">Selecciona productos para crear una orden</p>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar producto..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Category tabs */}
        <div className="flex gap-2 flex-wrap mb-3">
          <Button
            variant={selectedCategory === null ? "default" : "outline"}
            size="sm"
            onClick={() => setSelectedCategory(null)}
          >
            Todos
          </Button>
          {(categories ?? []).map((cat: any) => (
            <Button
              key={cat.id}
              variant={selectedCategory === cat.id ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedCategory(cat.id)}
            >
              {cat.name}
            </Button>
          ))}
        </div>

        {/* Product grid */}
        <div className="flex-1 overflow-y-auto">
          {itemsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No se encontraron productos
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
              {filteredItems.map((item: any) => {
                const inCartQty = cart
                  .filter((c) => c.menuItemId === item.id)
                  .reduce((sum, c) => sum + c.quantity, 0);

                return (
                  <button
                    key={item.id}
                    onClick={() => handleItemClick(item)}
                    className="group relative text-left rounded-xl border bg-card overflow-hidden hover:border-primary/50 hover:shadow-md transition-all"
                  >
                    {/* Image */}
                    <div className="aspect-[4/3] bg-muted relative overflow-hidden">
                      {item.image_url ? (
                        <img
                          src={item.image_url}
                          alt={item.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <UtensilsCrossed className="h-8 w-8 text-muted-foreground/25" />
                        </div>
                      )}
                      {inCartQty > 0 && (
                        <Badge className="absolute top-1.5 right-1.5 h-6 min-w-6 justify-center text-xs shadow-lg">
                          {inCartQty}
                        </Badge>
                      )}
                    </div>

                    {/* Info */}
                    <div className="p-2.5">
                      <p className="text-sm font-medium leading-snug line-clamp-2">{item.name}</p>
                      <p className="text-sm font-bold text-primary mt-1">
                        {formatCurrency(item.price)}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Right: Cart sidebar ── */}
      <div className="w-80 lg:w-96 flex flex-col border-l pl-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            Orden
            {totalQty > 0 && (
              <Badge variant="secondary" className="text-xs">
                {totalQty}
              </Badge>
            )}
          </h2>
          {cart.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => setCart([])}
            >
              Limpiar
            </Button>
          )}
        </div>

        {/* Order type */}
        <div className="flex gap-2 mb-3">
          <Button
            variant={orderType === "dine_in" ? "default" : "outline"}
            size="sm"
            className="flex-1"
            onClick={() => setOrderType("dine_in")}
          >
            Para aqui
          </Button>
          <Button
            variant={orderType === "takeout" ? "default" : "outline"}
            size="sm"
            className="flex-1"
            onClick={() => setOrderType("takeout")}
          >
            Para llevar
          </Button>
        </div>

        {/* Customer */}
        <div className="mb-3">
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Nombre del cliente (opcional)"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className="pl-9 text-sm"
            />
          </div>
        </div>

        {/* Cart items */}
        <div className="flex-1 overflow-y-auto space-y-1.5 mb-3">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <ShoppingCart className="h-10 w-10 mb-2 opacity-20" />
              <p className="text-sm">Toca un producto para agregar</p>
            </div>
          ) : (
            cart.map((item) => {
              const modTotal = item.modifiers.reduce((s, m) => s + m.price, 0);
              const lineTotal = (item.unitPrice + modTotal) * item.quantity;
              return (
                <div
                  key={item.lineId}
                  className="rounded-lg border p-2.5 space-y-1.5"
                >
                  <div className="flex items-start gap-2">
                    {/* Mini thumbnail */}
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt=""
                        className="h-9 w-9 rounded object-cover flex-shrink-0 mt-0.5"
                      />
                    ) : (
                      <div className="h-9 w-9 rounded bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                        <UtensilsCrossed className="h-3.5 w-3.5 text-muted-foreground/40" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatCurrency(item.unitPrice + modTotal)} c/u
                      </p>
                    </div>
                    <button
                      onClick={() => removeFromCart(item.lineId)}
                      className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Modifiers */}
                  {item.modifiers.length > 0 && (
                    <div className="pl-11 flex flex-wrap gap-1">
                      {item.modifiers.map((mod) => (
                        <span
                          key={mod.modifierId}
                          className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                        >
                          {mod.name}
                          {mod.price > 0 && ` +${formatCurrency(mod.price)}`}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Notes */}
                  {item.notes && (
                    <p className="pl-11 text-[11px] text-muted-foreground italic truncate">
                      {item.notes}
                    </p>
                  )}

                  {/* Qty + line total */}
                  <div className="flex items-center justify-between pl-11">
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => updateCartQty(item.lineId, item.quantity - 1)}
                      >
                        <Minus className="h-2.5 w-2.5" />
                      </Button>
                      <span className="w-5 text-center text-xs font-bold">{item.quantity}</span>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => updateCartQty(item.lineId, item.quantity + 1)}
                      >
                        <Plus className="h-2.5 w-2.5" />
                      </Button>
                    </div>
                    <p className="text-sm font-bold">{formatCurrency(lineTotal)}</p>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Notes */}
        {cart.length > 0 && (
          <div className="mb-3">
            <Input
              placeholder="Notas de la orden..."
              value={orderNotes}
              onChange={(e) => setOrderNotes(e.target.value)}
              className="text-sm"
            />
          </div>
        )}

        {/* Totals */}
        {cart.length > 0 && (
          <div className="border-t pt-3 space-y-1 mb-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">IGV (18%)</span>
              <span>{formatCurrency(tax)}</span>
            </div>
            <div className="flex justify-between font-bold text-lg pt-1.5 border-t">
              <span>Total</span>
              <span className="text-primary">{formatCurrency(total)}</span>
            </div>
          </div>
        )}

        {/* Create order */}
        <Button
          className="w-full h-12 text-base font-semibold"
          disabled={cart.length === 0 || createOrder.isPending}
          onClick={handleCreateOrder}
        >
          {createOrder.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Creando...
            </>
          ) : (
            <>
              <Check className="h-5 w-5 mr-2" />
              Crear Orden {cart.length > 0 && `· ${formatCurrency(total)}`}
            </>
          )}
        </Button>

        {/* Success dialog */}
        <Dialog open={successDialog} onOpenChange={setSuccessDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Orden Creada</DialogTitle>
            </DialogHeader>
            <div className="py-6 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                <Check className="h-8 w-8 text-green-600 dark:text-green-400" />
              </div>
              {lastOrderNumber && (
                <p className="text-2xl font-bold font-mono">{lastOrderNumber}</p>
              )}
              <p className="text-sm text-muted-foreground mt-2">
                La orden aparecera en la cocina automaticamente
              </p>
            </div>
            <DialogFooter>
              <Button onClick={() => setSuccessDialog(false)} className="w-full">
                Nueva Orden
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Modifier dialog */}
      <ModifierDialog
        item={modDialogItem}
        open={modDialogOpen}
        onClose={() => setModDialogOpen(false)}
        onAdd={handleAddFromDialog}
      />
    </div>
  );
}
