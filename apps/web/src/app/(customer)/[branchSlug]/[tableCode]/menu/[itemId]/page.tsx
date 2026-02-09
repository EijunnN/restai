"use client";

import { use, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@restai/ui/components/button";
import { useCartStore } from "@/stores/cart-store";
import { formatCurrency } from "@/lib/utils";
import {
  ArrowLeft,
  Plus,
  Minus,
  ShoppingCart,
  Loader2,
  UtensilsCrossed,
  ChevronDown,
} from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface MenuItem {
  id: string;
  name: string;
  description: string | null;
  price: number;
  image_url?: string | null;
  is_available: boolean;
  category_id: string;
}

interface MenuData {
  branch: { id: string; name: string; slug: string; currency: string };
  table: { id: string; number: number };
  categories: { id: string; name: string; sort_order: number }[];
  items: MenuItem[];
}

export default function ProductDetailPage({
  params,
}: {
  params: Promise<{
    branchSlug: string;
    tableCode: string;
    itemId: string;
  }>;
}) {
  const { branchSlug, tableCode, itemId } = use(params);
  const router = useRouter();
  const { addItem, items, updateQuantity } = useCartStore();

  const [menuData, setMenuData] = useState<MenuData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [modifierGroups, setModifierGroups] = useState<any[]>([]);
  const [selectedModifiers, setSelectedModifiers] = useState<Record<string, string[]>>({});
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    async function fetchMenu() {
      try {
        setLoading(true);
        const res = await fetch(
          `${API_URL}/api/customer/${branchSlug}/${tableCode}/menu`,
        );
        const result = await res.json();
        if (!result.success) {
          throw new Error(result.error?.message || "Error al cargar el menu");
        }
        setMenuData(result.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error inesperado");
      } finally {
        setLoading(false);
      }
    }
    fetchMenu();
  }, [branchSlug, tableCode]);

  useEffect(() => {
    if (!menuData) return;
    async function fetchModifiers() {
      try {
        const res = await fetch(
          `${API_URL}/api/customer/${branchSlug}/menu/items/${itemId}/modifiers`,
        );
        const result = await res.json();
        if (result.success) {
          setModifierGroups(result.data);
          const defaults: Record<string, boolean> = {};
          for (const group of result.data) {
            defaults[group.id] = !!group.is_required;
          }
          setOpenGroups(defaults);
        }
      } catch (err) {
        console.error("Error fetching modifiers:", err);
      }
    }
    fetchModifiers();
  }, [branchSlug, itemId, menuData]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Cargando producto...</p>
      </div>
    );
  }

  if (error || !menuData) {
    return (
      <div className="p-6 mt-12 text-center">
        <p className="text-destructive font-medium mb-2">Error</p>
        <p className="text-sm text-muted-foreground mb-4">
          {error || "Error al cargar producto"}
        </p>
        <Button variant="outline" onClick={() => router.back()}>
          Volver
        </Button>
      </div>
    );
  }

  const item = menuData.items.find((i) => i.id === itemId);

  if (!item) {
    return (
      <div className="p-6 mt-12 text-center">
        <UtensilsCrossed className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <p className="font-medium mb-2">Producto no encontrado</p>
        <p className="text-sm text-muted-foreground mb-4">
          Este producto no existe o ya no esta disponible.
        </p>
        <Button
          variant="outline"
          onClick={() =>
            router.push(`/${branchSlug}/${tableCode}/menu`)
          }
        >
          Volver al menu
        </Button>
      </div>
    );
  }

  const category = menuData.categories.find((c) => c.id === item.category_id);
  const cartItem = items.find((i) => i.menuItemId === item.id);
  const cartQty = cartItem?.quantity || 0;

  const handleAddToCart = () => {
    // Check required modifier groups
    for (const group of modifierGroups) {
      if (group.is_required) {
        const sel = selectedModifiers[group.id] || [];
        if (sel.length < (group.min_selections || 1)) {
          alert(
            `Selecciona al menos ${group.min_selections || 1} opcion en "${group.name}"`,
          );
          return;
        }
      }
    }

    // Build modifiers array from selections
    const cartModifiers: { modifierId: string; name: string; price: number }[] =
      [];
    for (const [groupId, modIds] of Object.entries(selectedModifiers)) {
      const group = modifierGroups.find((g: any) => g.id === groupId);
      if (!group) continue;
      for (const modId of modIds) {
        const mod = group.modifiers.find((m: any) => m.id === modId);
        if (mod) {
          cartModifiers.push({
            modifierId: mod.id,
            name: mod.name,
            price: mod.price || 0,
          });
        }
      }
    }

    if (cartQty > 0 && cartModifiers.length === 0) {
      updateQuantity(item.id, cartQty + quantity);
    } else {
      addItem({
        menuItemId: item.id,
        name: item.name,
        unitPrice: item.price,
        quantity,
        modifiers: cartModifiers,
      });
    }
    router.push(`/${branchSlug}/${tableCode}/menu`);
  };

  const modifiersTotal = Object.entries(selectedModifiers).reduce(
    (sum, [groupId, modIds]) => {
      const group = modifierGroups.find((g: any) => g.id === groupId);
      if (!group) return sum;
      return (
        sum +
        modIds.reduce((ms, modId) => {
          const mod = group.modifiers.find((m: any) => m.id === modId);
          return ms + (mod?.price || 0);
        }, 0)
      );
    },
    0,
  );

  const totalPrice = (item.price + modifiersTotal) * quantity;

  return (
    <div className="relative pb-28">
      {/* Back button - floating over image */}
      <button
        type="button"
        onClick={() => router.back()}
        className="absolute top-3 left-3 z-10 flex items-center justify-center h-10 w-10 rounded-full bg-background/80 backdrop-blur shadow-md transition-colors hover:bg-background"
      >
        <ArrowLeft className="h-5 w-5" />
      </button>

      {/* Product image */}
      <div className="w-full aspect-[4/3] bg-muted relative overflow-hidden">
        {item.image_url ? (
          <img
            src={item.image_url}
            alt={item.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3">
            <UtensilsCrossed className="h-16 w-16 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground/50">Sin imagen</p>
          </div>
        )}
      </div>

      {/* Product info */}
      <div className="p-5 space-y-4">
        {/* Category badge + name */}
        <div>
          {category && (
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
              {category.name}
            </p>
          )}
          <h1 className="text-2xl font-bold leading-tight">{item.name}</h1>
          <p className="text-xl font-bold text-primary mt-2">
            {formatCurrency(item.price)}
          </p>
        </div>

        {/* Description */}
        {item.description && (
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground mb-1">
              Descripcion
            </h2>
            <p className="text-sm text-foreground/80 leading-relaxed">
              {item.description}
            </p>
          </div>
        )}

        {/* Modifier groups */}
        {modifierGroups.length > 0 && (
          <div className="space-y-3">
            {modifierGroups.map((group: any) => {
              const isSingleSelect = group.max_selections === 1;
              const selected = selectedModifiers[group.id] || [];
              const isOpen = openGroups[group.id] ?? !!group.is_required;

              const toggleGroup = () =>
                setOpenGroups((prev) => ({
                  ...prev,
                  [group.id]: !prev[group.id],
                }));

              return (
                <div
                  key={group.id}
                  className="rounded-xl border border-border overflow-hidden"
                >
                  {/* Accordion trigger */}
                  <button
                    type="button"
                    onClick={toggleGroup}
                    className="w-full flex items-center justify-between p-3 bg-muted/30 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-semibold">{group.name}</h2>
                      {group.is_required && (
                        <span className="text-[10px] font-medium text-destructive bg-destructive/10 px-1.5 py-0.5 rounded">
                          Requerido
                        </span>
                      )}
                      {selected.length > 0 && (
                        <span className="text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                          {selected.length} sel.
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {group.max_selections > 1 && (
                        <span className="text-xs text-muted-foreground">
                          Max {group.max_selections}
                        </span>
                      )}
                      <ChevronDown
                        className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${
                          isOpen ? "rotate-180" : ""
                        }`}
                      />
                    </div>
                  </button>

                  {/* Accordion content */}
                  <div
                    className="grid transition-[grid-template-rows] duration-200 ease-in-out"
                    style={{
                      gridTemplateRows: isOpen ? "1fr" : "0fr",
                    }}
                  >
                    <div className="overflow-hidden">
                      <div className="p-3 pt-1 space-y-1">
                        {group.modifiers.map((mod: any) => {
                          const isSelected = selected.includes(mod.id);

                          const handleToggle = () => {
                            if (isSingleSelect) {
                              setSelectedModifiers({
                                ...selectedModifiers,
                                [group.id]: isSelected ? [] : [mod.id],
                              });
                            } else {
                              if (isSelected) {
                                setSelectedModifiers({
                                  ...selectedModifiers,
                                  [group.id]: selected.filter(
                                    (id: string) => id !== mod.id,
                                  ),
                                });
                              } else {
                                if (
                                  group.max_selections &&
                                  selected.length >= group.max_selections
                                )
                                  return;
                                setSelectedModifiers({
                                  ...selectedModifiers,
                                  [group.id]: [...selected, mod.id],
                                });
                              }
                            }
                          };

                          return (
                            <button
                              key={mod.id}
                              type="button"
                              onClick={handleToggle}
                              className={`w-full flex items-center justify-between rounded-lg border p-3 transition-colors ${
                                isSelected
                                  ? "border-primary bg-primary/5"
                                  : "border-border hover:border-primary/50"
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                <div
                                  className={`flex h-5 w-5 items-center justify-center ${
                                    isSingleSelect
                                      ? "rounded-full"
                                      : "rounded"
                                  } border-2 ${
                                    isSelected
                                      ? "border-primary bg-primary"
                                      : "border-muted-foreground/30"
                                  }`}
                                >
                                  {isSelected && (
                                    <svg
                                      className="h-3 w-3 text-primary-foreground"
                                      fill="none"
                                      viewBox="0 0 24 24"
                                      stroke="currentColor"
                                      strokeWidth={3}
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        d="M5 13l4 4L19 7"
                                      />
                                    </svg>
                                  )}
                                </div>
                                <span className="text-sm font-medium">
                                  {mod.name}
                                </span>
                              </div>
                              {mod.price > 0 && (
                                <span className="text-sm text-muted-foreground">
                                  +{formatCurrency(mod.price)}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Quantity selector */}
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground mb-3">
            Cantidad
          </h2>
          <div className="flex items-center gap-4">
            <Button
              size="icon"
              variant="outline"
              className="h-10 w-10 rounded-full"
              onClick={() => setQuantity(Math.max(1, quantity - 1))}
              disabled={quantity <= 1}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <span className="text-xl font-bold w-8 text-center">
              {quantity}
            </span>
            <Button
              size="icon"
              variant="outline"
              className="h-10 w-10 rounded-full"
              onClick={() => setQuantity(quantity + 1)}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Cart info if already in cart */}
        {cartQty > 0 && (
          <div className="rounded-lg bg-muted/50 border border-border px-4 py-3">
            <p className="text-sm text-muted-foreground">
              Ya tienes{" "}
              <span className="font-semibold text-foreground">{cartQty}</span>{" "}
              en tu carrito
            </p>
          </div>
        )}
      </div>

      {/* Fixed bottom: Add to cart button */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/95 backdrop-blur border-t border-border">
        <div className="max-w-lg mx-auto">
          <Button
            className="w-full h-14 text-base font-semibold rounded-xl"
            onClick={handleAddToCart}
            disabled={!item.is_available}
          >
            <ShoppingCart className="h-5 w-5 mr-2" />
            <span>Agregar al Carrito</span>
            <span className="ml-auto font-bold">
              {formatCurrency(totalPrice)}
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}
