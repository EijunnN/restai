"use client";

import { memo, useMemo } from "react";
import { Input } from "@restai/ui/components/input";
import { Button } from "@restai/ui/components/button";
import { Badge } from "@restai/ui/components/badge";
import { Search, Loader2, UtensilsCrossed, X } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { PosCartItem, PosMenuItem } from "../page";

// ---------------------------------------------------------------------------
// ProductGrid
// ---------------------------------------------------------------------------

function ProductGridComponent({
  categories,
  items,
  isLoading,
  search,
  onSearchChange,
  selectedCategory,
  onCategoryChange,
  cart,
  onItemClick,
}: {
  categories: { id: string; name: string }[];
  items: PosMenuItem[];
  isLoading: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  selectedCategory: string | null;
  onCategoryChange: (id: string | null) => void;
  cart: PosCartItem[];
  onItemClick: (item: PosMenuItem) => void;
}) {
  const filteredItems = useMemo(
    () =>
      items.filter((item) => {
        if (!item.is_available) return false;
        if (search) return item.name.toLowerCase().includes(search.toLowerCase());
        return true;
      }),
    [items, search]
  );

  const cartItemsCount = useMemo(
    () => cart.reduce((sum, item) => sum + item.quantity, 0),
    [cart]
  );

  const cartQuantitiesByMenuItem = useMemo(() => {
    const quantities = new Map<string, number>();

    for (const cartItem of cart) {
      quantities.set(
        cartItem.menuItemId,
        (quantities.get(cartItem.menuItemId) ?? 0) + cartItem.quantity
      );
    }

    return quantities;
  }, [cart]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Search */}
      <div className="sticky top-0 z-10 space-y-3 rounded-[24px] bg-background/95 pb-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar producto..."
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="h-11 rounded-2xl border-border/70 pl-9"
            />
            {search && (
              <button
                onClick={() => onSearchChange("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Badge
            variant="secondary"
            className="h-9 shrink-0 rounded-xl px-2.5 text-[11px] font-medium lg:hidden"
          >
            Pedido {cartItemsCount}
          </Badge>
        </div>

        {/* Category tabs */}
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          <Button
            variant={selectedCategory === null ? "default" : "outline"}
            size="sm"
            className="h-10 shrink-0 rounded-full px-4"
            onClick={() => onCategoryChange(null)}
          >
            Todos
          </Button>
          {categories.map((cat) => (
            <Button
              key={cat.id}
              variant={selectedCategory === cat.id ? "default" : "outline"}
              size="sm"
              className="h-10 shrink-0 rounded-full px-4"
              onClick={() => onCategoryChange(cat.id)}
            >
              {cat.name}
            </Button>
          ))}
        </div>
      </div>

      {/* Product grid */}
      <div className="flex-1 overflow-y-auto pb-44 lg:pb-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            No se encontraron productos
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {filteredItems.map((item) => {
              const inCartQty = cartQuantitiesByMenuItem.get(item.id) ?? 0;

              return (
                <button
                  key={item.id}
                  onClick={() => onItemClick(item)}
                  className="group relative overflow-hidden rounded-[24px] border border-border/70 bg-card text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg"
                >
                  {/* Image */}
                  <div className="relative aspect-[4/3] overflow-hidden bg-muted">
                    {item.image_url ? (
                      <img
                        src={item.image_url}
                        alt={item.name}
                        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <UtensilsCrossed className="h-8 w-8 text-muted-foreground/25" />
                      </div>
                    )}
                    {inCartQty > 0 && (
                      <Badge className="absolute right-2 top-2 h-7 min-w-7 justify-center rounded-full text-xs shadow-lg">
                        {inCartQty}
                      </Badge>
                    )}
                  </div>

                  {/* Info */}
                  <div className="space-y-1 p-3">
                    <p className="line-clamp-2 text-sm font-semibold leading-snug sm:text-[15px]">
                      {item.name}
                    </p>
                    <p className="text-sm font-bold text-primary sm:text-base">
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
  );
}

export const ProductGrid = memo(ProductGridComponent);
