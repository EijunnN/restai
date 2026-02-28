"use client";
/* eslint-disable react-hooks/todo, react-hooks/set-state-in-effect, react-doctor/prefer-useReducer, react-doctor/no-giant-component */

import { use, useState, useEffect, useCallback, type Dispatch, type SetStateAction } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Button } from "@restai/ui/components/button";
import { useCartStore } from "@/stores/cart-store";
import { cn, formatCurrency } from "@/lib/utils";
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

interface Modifier {
  id: string;
  name: string;
  price: number;
}

interface ModifierGroup {
  id: string;
  name: string;
  is_required: boolean;
  min_selections?: number;
  max_selections?: number;
  modifiers: Modifier[];
}

function useProductDetailLocalState() {
  const [menuData, setMenuData] = useState<MenuData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [selectedModifiers, setSelectedModifiers] = useState<Record<string, string[]>>({});
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  return {
    menuData,
    setMenuData,
    loading,
    setLoading,
    error,
    setError,
    quantity,
    setQuantity,
    modifierGroups,
    setModifierGroups,
    selectedModifiers,
    setSelectedModifiers,
    openGroups,
    setOpenGroups,
  };
}

function buildCartModifiers(
  selectedModifiers: Record<string, string[]>,
  modifierGroups: ModifierGroup[],
) {
  const cartModifiers: { modifierId: string; name: string; price: number }[] = [];
  for (const [groupId, modIds] of Object.entries(selectedModifiers)) {
    const group = modifierGroups.find((g) => g.id === groupId);
    if (!group) continue;
    for (const modId of modIds) {
      const mod = group.modifiers.find((m) => m.id === modId);
      if (!mod) continue;
      cartModifiers.push({
        modifierId: mod.id,
        name: mod.name,
        price: mod.price || 0,
      });
    }
  }
  return cartModifiers;
}

function calculateModifiersTotal(
  selectedModifiers: Record<string, string[]>,
  modifierGroups: ModifierGroup[],
) {
  return Object.entries(selectedModifiers).reduce((sum, [groupId, modIds]) => {
    const group = modifierGroups.find((g) => g.id === groupId);
    if (!group) return sum;
    return (
      sum +
      modIds.reduce((modsSum, modId) => {
        const mod = group.modifiers.find((m) => m.id === modId);
        return modsSum + (mod?.price || 0);
      }, 0)
    );
  }, 0);
}

function ModifierGroupsAccordion({
  modifierGroups,
  selectedModifiers,
  setSelectedModifiers,
  openGroups,
  setOpenGroups,
}: {
  modifierGroups: ModifierGroup[];
  selectedModifiers: Record<string, string[]>;
  setSelectedModifiers: Dispatch<SetStateAction<Record<string, string[]>>>;
  openGroups: Record<string, boolean>;
  setOpenGroups: Dispatch<SetStateAction<Record<string, boolean>>>;
}) {
  if (modifierGroups.length === 0) return null;

  return (
    <div className="space-y-3">
      {modifierGroups.map((group) => {
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
            className="rounded-xl bg-secondary/50 overflow-hidden"
          >
            <button
              type="button"
              onClick={toggleGroup}
              className="w-full flex items-center justify-between p-4 hover:bg-secondary/70 transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <h2 className="text-sm font-semibold">{group.name}</h2>
                {group.is_required && (
                  <span className="text-[10px] font-semibold text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded-full">
                    Requerido
                  </span>
                )}
                {selected.length > 0 && (
                  <span className="text-[10px] font-semibold text-foreground/70 bg-foreground/10 px-1.5 py-0.5 rounded-full">
                    {selected.length} sel.
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {(group.max_selections || 0) > 1 && (
                  <span className="text-xs text-muted-foreground">
                    Max {group.max_selections}
                  </span>
                )}
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform duration-200",
                    isOpen && "rotate-180",
                  )}
                />
              </div>
            </button>

            <div
              className="grid transition-[grid-template-rows] duration-200 ease-in-out"
              style={{
                gridTemplateRows: isOpen ? "1fr" : "0fr",
              }}
            >
              <div className="overflow-hidden">
                <div className="px-3 pb-3 space-y-1.5">
                  {group.modifiers.map((mod) => {
                    const isSelected = selected.includes(mod.id);
                    const handleToggle = () => {
                      if (isSingleSelect) {
                        setSelectedModifiers((prev) => ({
                          ...prev,
                          [group.id]: isSelected ? [] : [mod.id],
                        }));
                        return;
                      }

                      if (isSelected) {
                        setSelectedModifiers((prev) => ({
                          ...prev,
                          [group.id]: selected.filter((id) => id !== mod.id),
                        }));
                        return;
                      }

                      if (
                        group.max_selections &&
                        selected.length >= group.max_selections
                      ) {
                        return;
                      }

                      setSelectedModifiers((prev) => ({
                        ...prev,
                        [group.id]: [...selected, mod.id],
                      }));
                    };

                    return (
                      <button
                        key={mod.id}
                        type="button"
                        onClick={handleToggle}
                        className={cn(
                          "w-full flex items-center justify-between rounded-xl p-3 transition-colors",
                          isSelected
                            ? "bg-secondary border border-foreground/30"
                            : "bg-transparent border border-transparent hover:bg-secondary/80",
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={cn(
                              "flex h-5 w-5 items-center justify-center border-2 transition-colors",
                              isSingleSelect ? "rounded-full" : "rounded-md",
                              isSelected
                                ? "border-foreground bg-foreground"
                                : "border-muted-foreground/40",
                            )}
                          >
                            {isSelected && (
                              <svg
                                className="h-3 w-3 text-background"
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
  );
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
  "use no memo";
  const { branchSlug, tableCode, itemId } = use(params);
  const router = useRouter();
  const { addItem, items, updateQuantity } = useCartStore();
  const {
    menuData,
    setMenuData,
    loading,
    setLoading,
    error,
    setError,
    quantity,
    setQuantity,
    modifierGroups,
    setModifierGroups,
    selectedModifiers,
    setSelectedModifiers,
    openGroups,
    setOpenGroups,
  } = useProductDetailLocalState();

  const loadMenu = useCallback(() => {
    setLoading(true);
    setError(null);
    void fetch(`${API_URL}/api/customer/${branchSlug}/${tableCode}/menu`)
      .then((res) => res.json())
      .then((result) => {
        if (!result.success) {
          setError(result.error?.message || "Error al cargar el menu");
          return;
        }
        setMenuData(result.data);
      })
      .catch(() => {
        setError("Error inesperado");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [branchSlug, tableCode, setLoading, setError, setMenuData]);

  const loadModifiers = useCallback(() => {
    if (!menuData) return;
    void fetch(`${API_URL}/api/customer/${branchSlug}/menu/items/${itemId}/modifiers`)
      .then((res) => res.json())
      .then((result) => {
        if (result.success) {
          setModifierGroups(result.data);
          const defaults: Record<string, boolean> = {};
          for (const group of result.data) {
            defaults[group.id] = !!group.is_required;
          }
          setOpenGroups(defaults);
        }
      })
      .catch(() => {
        // Keep silent; modifiers are optional.
      });
  }, [branchSlug, itemId, menuData, setModifierGroups, setOpenGroups]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      loadMenu();
    }, 0);
    return () => clearTimeout(timeout);
  }, [loadMenu]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      void loadModifiers();
    }, 0);
    return () => clearTimeout(timeout);
  }, [loadModifiers]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
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

    const cartModifiers = buildCartModifiers(selectedModifiers, modifierGroups);

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

  const modifiersTotal = calculateModifiersTotal(selectedModifiers, modifierGroups);

  const totalPrice = (item.price + modifiersTotal) * quantity;

  return (
    <div className="relative min-h-dvh pb-28">
      {/* Hero image section */}
      <div className="relative w-full h-72 bg-muted overflow-hidden">
        {item.image_url ? (
          <>
            <Image
              src={item.image_url}
              alt={item.name}
              fill
              sizes="100vw"
              unoptimized
              className="object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
          </>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-muted">
            <UtensilsCrossed className="h-16 w-16 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground/50">Sin imagen</p>
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
          </div>
        )}

        {/* Floating back button */}
        <button
          type="button"
          onClick={() => router.back()}
          className="absolute top-4 left-4 z-10 flex items-center justify-center h-10 w-10 rounded-full bg-black/40 backdrop-blur-md transition-colors hover:bg-black/60"
        >
          <ArrowLeft className="h-5 w-5 text-white" />
        </button>
      </div>

      {/* Content section - overlapping the image */}
      <div className="relative z-10 -mt-8 rounded-t-3xl bg-background">
        <div className="p-5 pt-6 space-y-5">
          {/* Category badge + name + price */}
          <div>
            {category && (
              <p className="text-xs text-muted-foreground tracking-wide uppercase mb-1.5">
                {category.name}
              </p>
            )}
            <h1 className="text-2xl font-bold leading-tight">{item.name}</h1>
            <p className="text-xl font-bold text-foreground mt-2">
              {formatCurrency(item.price)}
            </p>
          </div>

          {/* Description */}
          {item.description && (
            <p className="text-sm text-muted-foreground leading-relaxed">
              {item.description}
            </p>
          )}

          {/* Modifier groups */}
          <ModifierGroupsAccordion
            modifierGroups={modifierGroups}
            selectedModifiers={selectedModifiers}
            setSelectedModifiers={setSelectedModifiers}
            openGroups={openGroups}
            setOpenGroups={setOpenGroups}
          />

          {/* Already in cart indicator */}
          {cartQty > 0 && (
            <div className="flex items-center gap-2.5 bg-secondary/50 rounded-xl px-4 py-3">
              <ShoppingCart className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Ya tienes{" "}
                <span className="font-semibold text-foreground">{cartQty}</span>{" "}
                en tu carrito
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Fixed bottom CTA with quantity controls */}
      <div className="fixed bottom-0 left-0 right-0 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] bg-background/95 backdrop-blur-md border-t border-border">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          {/* Quantity controls */}
          <div className="flex items-center bg-secondary rounded-2xl shrink-0">
            <button
              type="button"
              onClick={() => setQuantity(Math.max(1, quantity - 1))}
              disabled={quantity <= 1}
              className="h-14 w-12 rounded-l-2xl flex items-center justify-center text-foreground transition-colors hover:bg-foreground/10 disabled:opacity-30"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="text-lg font-bold min-w-[2rem] text-center text-foreground">
              {quantity}
            </span>
            <button
              type="button"
              onClick={() => setQuantity((prev) => prev + 1)}
              className="h-14 w-12 rounded-r-2xl flex items-center justify-center text-foreground transition-colors hover:bg-foreground/10"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          {/* Add to cart button */}
          <button
            type="button"
            onClick={handleAddToCart}
            disabled={!item.is_available}
            className={cn(
              "flex-1 h-14 rounded-2xl font-semibold text-base flex items-center justify-between px-5 transition-colors",
              item.is_available
                ? "bg-foreground text-background hover:bg-foreground/90"
                : "bg-muted text-muted-foreground cursor-not-allowed",
            )}
          >
            <span>Agregar</span>
            <span className="font-bold">{formatCurrency(totalPrice)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
