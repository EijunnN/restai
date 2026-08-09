"use client";

import { memo, useMemo } from "react";
import { Input } from "@restai/ui/components/input";
import { Button } from "@restai/ui/components/button";
import { Badge } from "@restai/ui/components/badge";
import { AlertTriangle, Loader2, RefreshCw, Search, UtensilsCrossed, X } from "lucide-react";
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
  pendingItemIds,
  isError,
  errorMessage,
  onRetry,
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
  /** Productos cuya consulta de modificadores está en vuelo (uno por producto). */
  pendingItemIds: ReadonlySet<string>;
  isError?: boolean;
  errorMessage?: string;
  onRetry?: () => void;
}) {
  // El orden en que llegan las categorías YA es el de la carta: la API las
  // devuelve por `sort_order`. Aquí solo se convierte en un índice consultable.
  const posicionDeCategoria = useMemo(
    () => new Map(categories.map((c, i) => [c.id, i])),
    [categories],
  );

  const filteredItems = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("es");
    return items
      .filter((item) => {
        if (!item.is_available) return false;
        if (term) return item.name.toLocaleLowerCase("es").includes(term);
        return true;
      })
      // Esta rejilla es PLANA: mezcla todas las categorías cuando no hay
      // ninguna elegida. Por eso no basta con `sort_order` del plato, que es
      // relativo a SU categoría: los postres colocados en 0,1,2 se colarían
      // delante de los fondos que estén en 3 y siguientes. Manda primero la
      // posición de la categoría en la carta, y dentro de ella la del plato.
      .sort((a, b) => {
        const catA = posicionDeCategoria.get(a.category_id ?? "") ?? Number.MAX_SAFE_INTEGER;
        const catB = posicionDeCategoria.get(b.category_id ?? "") ?? Number.MAX_SAFE_INTEGER;
        if (catA !== catB) return catA - catB;
        const order = (a.sort_order ?? 0) - (b.sort_order ?? 0);
        return order !== 0 ? order : a.name.localeCompare(b.name, "es");
      });
  }, [items, search, posicionDeCategoria]);

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
      {/* Buscador */}
      <div className="sticky top-0 z-10 space-y-3 rounded-[24px] bg-background/95 pb-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar producto..."
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="h-11 rounded-2xl border-border/70 pl-9 pr-11"
              aria-label="Buscar producto en la carta"
            />
            {search && (
              <button
                type="button"
                onClick={() => onSearchChange("")}
                aria-label="Borrar la búsqueda"
                className="absolute right-0.5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
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

        {/* Categorías */}
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

      {/* Rejilla de productos */}
      <div className="flex-1 overflow-y-auto pb-44 lg:pb-0">
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <div
                key={index}
                className="overflow-hidden rounded-[24px] border border-border/70 bg-card"
              >
                <div className="aspect-[4/3] animate-pulse bg-muted" />
                <div className="space-y-2 p-3">
                  <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : isError ? (
          <div
            role="alert"
            className="mx-auto flex max-w-sm flex-col items-center gap-3 rounded-[24px] border border-destructive/40 bg-destructive/5 p-8 text-center"
          >
            <AlertTriangle className="h-7 w-7 text-destructive" />
            <p className="text-sm font-medium">No se pudo cargar la carta</p>
            <p className="text-xs text-muted-foreground">
              {errorMessage || "Revisa la conexión y vuelve a intentarlo."}
            </p>
            {onRetry && (
              <Button type="button" variant="outline" className="h-10" onClick={onRetry}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Reintentar
              </Button>
            )}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="mx-auto max-w-sm rounded-[24px] border border-dashed p-8 text-center">
            <UtensilsCrossed className="mx-auto h-8 w-8 text-muted-foreground/40" />
            <p className="mt-3 text-sm font-medium">
              {search ? `Ningún producto coincide con "${search}"` : "No hay productos disponibles"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {search
                ? "Prueba con otro nombre o cambia de categoría."
                : "Los productos agotados no se muestran. Actívalos desde Carta."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {filteredItems.map((item) => {
              const inCartQty = cartQuantitiesByMenuItem.get(item.id) ?? 0;
              // Cada toque consulta los grupos de modificadores del producto. Sin
              // este bloqueo, con red lenta el segundo toque añadía una unidad
              // duplicada antes de que respondiera el primero.
              const isPending = pendingItemIds.has(item.id);

              return (
                <button
                  key={item.id}
                  onClick={() => onItemClick(item)}
                  disabled={isPending}
                  aria-busy={isPending}
                  aria-label={`Añadir ${item.name} al pedido`}
                  className="group relative overflow-hidden rounded-[24px] border border-border/70 bg-card text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg disabled:pointer-events-none disabled:opacity-70"
                >
                  {/* Imagen */}
                  <div className="relative aspect-[4/3] overflow-hidden bg-muted">
                    {item.image_url ? (
                      <img
                        src={item.image_url}
                        alt={item.name}
                        className="h-full w-full object-contain transition-transform duration-200 group-hover:scale-105"
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
                    {isPending && (
                      <div className="absolute inset-0 flex items-center justify-center bg-background/70 backdrop-blur-[1px]">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                        <span className="sr-only">Añadiendo {item.name}…</span>
                      </div>
                    )}
                  </div>

                  {/* Nombre y precio */}
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
