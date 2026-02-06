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
} from "lucide-react";

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

  useEffect(() => {
    async function fetchMenu() {
      try {
        setLoading(true);
        const res = await fetch(
          `http://localhost:3001/api/customer/${branchSlug}/${tableCode}/menu`,
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
    if (cartQty > 0) {
      updateQuantity(item.id, cartQty + quantity);
    } else {
      addItem({
        menuItemId: item.id,
        name: item.name,
        unitPrice: item.price,
        quantity,
        modifiers: [],
      });
    }
    router.push(`/${branchSlug}/${tableCode}/menu`);
  };

  const totalPrice = item.price * quantity;

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

        {/* TODO: Modifier groups selection UI — not yet available in menu API */}

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
