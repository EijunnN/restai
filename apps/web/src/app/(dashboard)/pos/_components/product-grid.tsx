"use client";

import { Input } from "@restai/ui/components/input";
import { Button } from "@restai/ui/components/button";
import { Badge } from "@restai/ui/components/badge";
import { Search, Loader2, UtensilsCrossed, X } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import type { PosCartItem } from "../page";

// ---------------------------------------------------------------------------
// ProductGrid
// ---------------------------------------------------------------------------

export function ProductGrid({
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
  categories: any[];
  items: any[];
  isLoading: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  selectedCategory: string | null;
  onCategoryChange: (id: string | null) => void;
  cart: PosCartItem[];
  onItemClick: (item: any) => void;
}) {
  const filteredItems = items.filter((item: any) => {
    if (!item.is_available) return false;
    if (search) return item.name.toLowerCase().includes(search.toLowerCase());
    return true;
  });

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="mb-3">
        <PageHeader
          title="Punto de Venta"
          description="Selecciona productos para crear una orden"
        />
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar producto..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9"
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

      {/* Category tabs */}
      <div className="flex gap-2 flex-wrap mb-3">
        <Button
          variant={selectedCategory === null ? "default" : "outline"}
          size="sm"
          onClick={() => onCategoryChange(null)}
        >
          Todos
        </Button>
        {categories.map((cat: any) => (
          <Button
            key={cat.id}
            variant={selectedCategory === cat.id ? "default" : "outline"}
            size="sm"
            onClick={() => onCategoryChange(cat.id)}
          >
            {cat.name}
          </Button>
        ))}
      </div>

      {/* Product grid */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
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
                  onClick={() => onItemClick(item)}
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
  );
}
