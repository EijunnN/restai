"use client";

import { useState, useEffect } from "react";
import { Input } from "@restai/ui/components/input";
import { Button } from "@restai/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@restai/ui/components/dialog";
import { Check, Plus, Minus, Loader2, UtensilsCrossed } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useItemModifierGroups } from "@/hooks/use-menu";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CartModifier {
  modifierId: string;
  name: string;
  price: number;
}

// ---------------------------------------------------------------------------
// ModifierDialog
// ---------------------------------------------------------------------------

export function ModifierDialog({
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
