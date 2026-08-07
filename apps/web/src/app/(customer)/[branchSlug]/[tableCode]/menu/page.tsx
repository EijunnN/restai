"use client";
/* eslint-disable react-hooks/todo, react-hooks/set-state-in-effect, react-doctor/prefer-useReducer, react-doctor/no-giant-component */

import { use, useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { redirect, useRouter } from "next/navigation";
import { Button } from "@restai/ui/components/button";
import { Badge } from "@restai/ui/components/badge";
import { useCartStore } from "@/stores/cart-store";
import { useCustomerStore } from "@/stores/customer-store";
import { formatCurrency, cn } from "@/lib/utils";
import { ShoppingCart, Plus, Minus, Loader2, UtensilsCrossed, ClipboardList, Search, X } from "lucide-react";
import { TableActionButtons } from "@/components/customer/table-action-buttons";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface MenuItem {
  id: string;
  name: string;
  description: string | null;
  price: number;
  image_url?: string | null;
  is_available: boolean;
  category_id: string;
  // True when the item has modifier groups: quick-add must route to the detail
  // page so required options are chosen (otherwise the order fails at checkout).
  has_modifiers?: boolean;
  allergens?: string[];
  dietary_tags?: string[];
  spice_level?: number | null;
  preparation_time_min?: number | null;
}

/** Etiquetas legibles de alérgenos (los valores que guarda menu_items.allergens). */
const ALLERGEN_LABELS: Record<string, string> = {
  gluten: "gluten",
  lacteos: "lácteos",
  huevo: "huevo",
  pescado: "pescado",
  mariscos: "mariscos",
  mani: "maní",
  frutos_secos: "frutos secos",
  soya: "soya",
  sesamo: "sésamo",
  sulfitos: "sulfitos",
  mostaza: "mostaza",
  apio: "apio",
};

const DIETARY_LABELS: Record<string, string> = {
  vegetariano: "Vegetariano",
  vegano: "Vegano",
  sin_gluten: "Sin gluten",
  sin_lactosa: "Sin lactosa",
  keto: "Keto",
  bajo_en_calorias: "Bajo en calorías",
};

interface Category {
  id: string;
  name: string;
  sort_order: number;
}

interface MenuData {
  branch: { id: string; name: string; slug: string; currency: string; tax_rate?: number };
  table: { id: string; number: number; short_code?: string | null };
  categories: Category[];
  items: MenuItem[];
}

/**
 * Tarjeta de plato. Vive FUERA del componente de página: definida dentro, React
 * la trataba como un tipo nuevo en cada pulsación del buscador y desmontaba y
 * volvía a montar toda la cuadrícula, con el consiguiente parpadeo de imágenes.
 */
function MenuItemCard({
  item,
  qty,
  onOpenDetail,
  onAdd,
  onRemoveOne,
}: {
  item: MenuItem;
  qty: number;
  onOpenDetail: () => void;
  onAdd: () => void;
  onRemoveOne: () => void;
}) {
  const soldOut = !item.is_available;

  return (
    <div
      className={cn(
        "rounded-2xl bg-secondary overflow-hidden shadow-lg flex flex-col",
        soldOut && "opacity-60",
      )}
    >
      <div className="relative w-full h-40">
        <button
          type="button"
          className="w-full h-full cursor-pointer"
          onClick={onOpenDetail}
          aria-label={`Ver ${item.name}`}
        >
          {item.image_url ? (
            <Image
              src={item.image_url}
              alt={item.name}
              fill
              sizes="(max-width: 768px) 50vw, 200px"
              unoptimized
              className={cn("object-contain", soldOut && "grayscale")}
            />
          ) : (
            <div className="w-full h-full bg-muted flex items-center justify-center">
              <UtensilsCrossed className="h-10 w-10 text-muted-foreground/40" />
            </div>
          )}
        </button>

        {soldOut ? (
          <span className="absolute bottom-2 right-2 rounded-lg bg-black/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
            Agotado
          </span>
        ) : qty > 0 ? (
          <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-black/60 backdrop-blur-sm rounded-lg border border-white/10 px-1.5 py-1">
            <button
              type="button"
              aria-label={`Quitar una unidad de ${item.name}`}
              className="w-10 h-10 flex items-center justify-center text-foreground hover:text-primary transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                onRemoveOne();
              }}
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="w-5 text-center text-xs font-bold text-foreground">{qty}</span>
            <button
              type="button"
              aria-label={`Añadir una unidad de ${item.name}`}
              className="w-10 h-10 flex items-center justify-center text-foreground hover:text-primary transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                onAdd();
              }}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            aria-label={`Añadir ${item.name} al carrito`}
            className="absolute bottom-2 right-2 w-12 h-12 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm rounded-lg border border-white/10 text-foreground hover:bg-black/70 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onAdd();
            }}
          >
            <Plus className="h-4 w-4" />
            <span className="text-[9px] font-medium leading-none mt-0.5">Agregar</span>
          </button>
        )}
      </div>

      <button
        type="button"
        className="p-3 flex flex-col flex-1 text-left cursor-pointer"
        onClick={onOpenDetail}
      >
        <h3 className="text-sm font-bold text-foreground leading-tight line-clamp-2">
          {item.name}
        </h3>
        {item.description && (
          <p className="text-xs text-muted-foreground leading-snug line-clamp-2 mt-1">
            {item.description}
          </p>
        )}

        {/* Alérgenos y etiquetas dietéticas: información que puede evitar un
            incidente serio, y que hasta ahora no existía en la carta. */}
        {(item.allergens?.length || item.dietary_tags?.length) ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {item.dietary_tags?.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:text-green-300"
              >
                {DIETARY_LABELS[tag] ?? tag}
              </span>
            ))}
            {item.allergens?.length ? (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                Contiene: {item.allergens.map((a) => ALLERGEN_LABELS[a] ?? a).join(", ")}
              </span>
            ) : null}
          </div>
        ) : null}

        <p className="text-sm font-bold text-foreground mt-3">{formatCurrency(item.price)}</p>
        {item.preparation_time_min ? (
          <p className="mt-1 text-[10px] text-muted-foreground">
            ~{item.preparation_time_min} min
          </p>
        ) : null}
      </button>
    </div>
  );
}

function useCustomerMenuLocalState() {
  const [menuData, setMenuData] = useState<MenuData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [sessionValid, setSessionValid] = useState<boolean | null>(null);
  const [search, setSearch] = useState("");

  return {
    search,
    setSearch,
    menuData,
    setMenuData,
    loading,
    setLoading,
    error,
    setError,
    activeCategory,
    setActiveCategory,
    sessionValid,
    setSessionValid,
  };
}

export default function CustomerMenuPage({
  params,
}: {
  params: Promise<{ branchSlug: string; tableCode: string }>;
}) {
  "use no memo";
  const { branchSlug, tableCode } = use(params);
  const router = useRouter();
  const { addItem, getItemCount, items, updateLineQuantity, getItemQty } = useCartStore();
  const setSession = useCustomerStore((s) => s.setSession);
  const {
    menuData,
    setMenuData,
    loading,
    setLoading,
    error,
    setError,
    activeCategory,
    setActiveCategory,
    sessionValid,
    setSessionValid,
    search,
    setSearch,
  } = useCustomerMenuLocalState();
  const clearSession = useCustomerStore((s) => s.clear);

  const getToken = () => {
    const storeToken = useCustomerStore.getState().token;
    if (storeToken) return storeToken;
    if (typeof window !== "undefined") return sessionStorage.getItem("customer_token");
    return null;
  };

  const validateSession = useCallback(() => {
    const token = getToken();
    if (!token) {
      setSessionValid(false);
      return;
    }

    void fetch(`${API_URL}/api/customer/${branchSlug}/${tableCode}/check-session`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((response) => response.json())
      .then((result) => {
        if (result.success && result.data.hasSession && result.data.status === "active") {
          setSessionValid(true);
        } else {
          setSessionValid(false);
          clearSession();
        }
      })
      .catch(() => {
        setSessionValid(false);
        clearSession();
      });
  }, [branchSlug, tableCode, clearSession, setSessionValid]);

  const loadMenu = useCallback(() => {
    setLoading(true);
    setError(null);
    void fetch(`${API_URL}/api/customer/${branchSlug}/${tableCode}/menu`)
      .then((res) => res.json())
      .then((result) => {
        if (!result.success) {
          setError(result.error?.message || "No pudimos cargar la carta.");
          setLoading(false);
          return;
        }
        setMenuData(result.data);
        if (result.data.categories.length > 0) {
          setActiveCategory(result.data.categories[0].id);
        }
        if (result.data.branch?.name) {
          const existing = useCustomerStore.getState();
          if (existing.token) {
            setSession({
              token: existing.token,
              sessionId: existing.sessionId || "",
              branchSlug,
              tableCode,
              branchName: result.data.branch.name,
            });
          }
        }
        setLoading(false);
      })
      .catch(() => {
        setError("No hay conexión con el restaurante. Revisa tu red e inténtalo de nuevo.");
        setLoading(false);
      });
  }, [branchSlug, tableCode, setSession, setLoading, setError, setMenuData, setActiveCategory]);

  // Validate session is still active on mount
  useEffect(() => {
    const timeout = setTimeout(() => {
      validateSession();
    }, 0);
    return () => clearTimeout(timeout);
  }, [validateSession]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      void loadMenu();
    }, 0);
    return () => clearTimeout(timeout);
  }, [loadMenu]);

  if (sessionValid === false) {
    redirect(`/${branchSlug}/${tableCode}`);
  }

  const itemCount = getItemCount();
  // Modifier-inclusive total so the floating bar matches the cart estimate.
  const cartTotal = items.reduce(
    (sum, i) => sum + (i.unitPrice + i.modifiers.reduce((m, x) => m + x.price, 0)) * i.quantity,
    0,
  );

  // Quick-add from the grid targets the plain (no-modifier) line of a product.
  // Items WITH modifier groups must be configured on the detail page, otherwise
  // a required-modifier order would be rejected by the server at checkout.
  const handleAddItem = (item: MenuItem) => {
    if (item.has_modifiers) {
      router.push(`/${branchSlug}/${tableCode}/menu/${item.id}`);
      return;
    }
    addItem({
      menuItemId: item.id,
      name: item.name,
      unitPrice: item.price,
      quantity: 1,
      modifiers: [],
    });
  };

  if (loading || sessionValid === null) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Cargando la carta...</p>
      </div>
    );
  }

  if (error || !menuData) {
    return (
      <div className="p-6 mt-12 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
          <UtensilsCrossed className="h-8 w-8 text-destructive" />
        </div>
        <p role="alert" className="text-destructive font-medium mb-2">
          No pudimos cargar la carta
        </p>
        <p className="text-sm text-muted-foreground mb-4">
          {error || "Vuelve a intentarlo en un momento."}
        </p>
        {/*
          Reintenta la carga de la carta, no recarga la página: `location.reload()`
          descartaba el estado en memoria y hacía parpadear toda la app cuando
          bastaba con repetir una petición.
        */}
        <Button variant="outline" className="h-11 w-full max-w-xs" onClick={loadMenu}>
          Reintentar
        </Button>
      </div>
    );
  }

  const { categories, items: menuItems } = menuData;

  // Los platos agotados YA NO se ocultan: se muestran atenuados y marcados.
  // Al desaparecer, la carta cambiaba de tamaño sin explicación y el comensal
  // buscaba una y otra vez el plato que venía a comer.
  const itemsByCategory = (catId: string) => menuItems.filter((i) => i.category_id === catId);

  // Sin tildes ni mayúsculas: quien busca "pure" debe encontrar "Puré", y quien
  // busca "cafe" debe encontrar "Café". ̀-ͯ es el bloque de marcas
  // diacríticas que deja NFD tras separar la letra de su acento.
  const normalize = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  /** Tarjeta con los manejadores ya atados: el componente vive a nivel de módulo. */
  const renderCard = (item: MenuItem) => (
    <MenuItemCard
      key={item.id}
      item={item}
      qty={getItemQty(item.id)}
      onOpenDetail={() => router.push(`/${branchSlug}/${tableCode}/menu/${item.id}`)}
      onAdd={() => handleAddItem(item)}
      onRemoveOne={() => updateLineQuantity(item.id, getItemQty(item.id) - 1)}
    />
  );

  const query = normalize(search.trim());
  // Con 60–80 platos, ir pestaña por pestaña es más lento que la carta de papel.
  // La búsqueda ignora tildes y mira nombre y descripción.
  const searchResults = query
    ? menuItems.filter((i) => {
        const haystack = normalize(`${i.name} ${i.description ?? ""}`);
        return haystack.includes(query);
      })
    : [];

  return (
    // El hueco inferior tiene que cubrir de verdad la barra fija: con el carrito
    // lleno mide ~190 px y `pb-40` (160 px) tapaba el último plato de la carta.
    <div className={cn("relative", itemCount > 0 ? "pb-56" : "pb-36")}>
      {/* Buscador */}
      <div className="sticky top-[49px] z-40 bg-background/95 backdrop-blur px-4 pt-3 pb-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar en la carta..."
            aria-label="Buscar platos en la carta"
            className="h-11 w-full rounded-xl border border-border bg-secondary pl-9 pr-9 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Borrar búsqueda"
              className="absolute right-1.5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Category tabs — sticky underline style */}
      <div
        className={cn(
          "sticky top-[110px] z-30 bg-background/95 backdrop-blur border-b border-border",
          query && "hidden",
        )}
      >
        <div className="flex gap-1 overflow-x-auto px-2 no-scrollbar">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              title={cat.name}
              className={cn(
                "shrink-0 max-w-[12rem] truncate px-4 py-3 text-xs font-medium uppercase tracking-wider whitespace-nowrap text-center transition-colors border-b-2",
                activeCategory === cat.id
                  ? "text-foreground border-foreground"
                  : "text-muted-foreground border-transparent hover:text-foreground/70",
              )}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </div>

      {/* Product grid */}
      <div className="p-4">
        {query ? (
          searchResults.length === 0 ? (
            <div className="py-16 text-center">
              <Search className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                No encontramos nada para “{search.trim()}”.
              </p>
              <Button variant="outline" className="mt-4 h-11" onClick={() => setSearch("")}>
                Ver toda la carta
              </Button>
            </div>
          ) : (
            <>
              <p className="mb-3 text-xs text-muted-foreground">
                {searchResults.length}{" "}
                {searchResults.length === 1 ? "resultado" : "resultados"}
              </p>
              <div className="grid grid-cols-2 gap-4">
                {searchResults.map((item) => renderCard(item))}
              </div>
            </>
          )
        ) : categories.length === 0 ? (
          // La sede puede no tener ninguna categoría activa: el servidor devuelve
          // items vacío y antes quedaba una pantalla en blanco bajo el buscador.
          <div className="py-16 text-center">
            <UtensilsCrossed className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm font-medium">La carta aún no está publicada</p>
            <p className="mt-1 text-sm text-muted-foreground">
              El restaurante todavía no ha activado ninguna categoría. Avisa al mozo y te
              tomará el pedido en persona.
            </p>
          </div>
        ) : (
          categories.map((category) => (
            <div
              key={category.id}
              className={cn(activeCategory !== category.id && "hidden")}
            >
              {itemsByCategory(category.id).length === 0 ? (
                <p className="text-sm text-muted-foreground py-12 text-center">
                  No hay productos en esta categoría
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  {itemsByCategory(category.id).map((item) => renderCard(item))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Floating action bar + cart */}
      {/* pb con safe-area: sin esto, en iPhone el botón del carrito queda debajo
          de la barra del sistema y no se puede pulsar. */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
        {/*
          Los mismos avisos que en el estado del pedido, con el mismo
          comportamiento: enfriamiento visible, mensaje en línea y respuesta
          honesta cuando el aviso ya estaba en curso.
        */}
        <div className="max-w-lg mx-auto px-4 pt-3 pb-2 space-y-2">
          <TableActionButtons branchSlug={branchSlug} tableCode={tableCode} />
          {/*
            Salida de la carta hacia el estado del pedido: tras "Pedir más" el
            comensal se quedaba encerrado en el menú sin forma de volver a ver
            cómo iba su comanda.
          */}
          <Button
            variant="ghost"
            className="h-11 w-full gap-2"
            onClick={() => router.push(`/${branchSlug}/${tableCode}/status`)}
          >
            <ClipboardList className="h-4 w-4" />
            Ver mis pedidos y el total de la mesa
          </Button>
        </div>
        {/* Cart button */}
        {itemCount > 0 && (
          <div className="px-4 pb-4">
            <Button
              className="w-full max-w-lg mx-auto flex items-center justify-between h-14 text-base px-5"
              onClick={() => router.push(`/${branchSlug}/${tableCode}/cart`)}
            >
              <div className="flex items-center gap-3">
                <ShoppingCart className="h-5 w-5" />
                <Badge variant="secondary" className="bg-primary-foreground/20 text-primary-foreground font-bold">
                  {itemCount}
                </Badge>
              </div>
              <span className="font-semibold">Ver Carrito</span>
              <span className="font-bold">{formatCurrency(cartTotal)}</span>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
