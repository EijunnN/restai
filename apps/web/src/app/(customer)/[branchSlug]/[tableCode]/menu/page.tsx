"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { redirect, useRouter } from "next/navigation";
import { Button } from "@restai/ui/components/button";
import {
  Bell,
  ChevronRight,
  Loader2,
  Search,
  User,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { useCartStore } from "@/stores/cart-store";
import { useCustomerStore } from "@/stores/customer-store";
import { summarizeVariants, unitsInCart, variantsInCart } from "@/lib/menu-options";
import { TableSheet } from "@/components/customer/table-sheet";
import { VariantsSheet } from "@/components/customer/variants-sheet";
import { VoiceEntryButton } from "@/components/customer/voice-entry-button";
import { KIOSK_INTENT_KEY } from "@/hooks/use-kiosk";
import { DishRow, type DishRowItem } from "./_components/dish-row";
import { CartaLectura } from "@/components/customer/carta-lectura";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface MenuCategory {
  id: string;
  name: string;
}

interface MenuData {
  branch: { id: string; name: string; currency?: string; menu_mode?: string };
  table?: { id: string; number?: number; short_code?: string } | null;
  categories: MenuCategory[];
  items: (DishRowItem & { category_id: string })[];
}

/**
 * La carta del comensal.
 *
 * El rediseño responde a un problema de sitio: había TRES barras fijas —la
 * cabecera del local, el buscador y las pestañas de categoría— más un pie que
 * apilaba los avisos de mesa, el enlace a los pedidos y el carrito. En un móvil
 * pequeño quedaba una ventana de carta de unos pocos centímetros, y los
 * offsets de las barras estaban calculados a mano (`top-[49px]`, `top-[110px]`)
 * contra la altura de la anterior.
 *
 * Ahora hay UNA barra arriba, que agrupa el local, la mesa, el buscador y las
 * categorías; el pie es solo el carrito; y los avisos de mesa viven en una hoja
 * que se abre cuando hacen falta. Las categorías dejan de filtrar y pasan a
 * llevar a su sección: la carta se lee de corrido, como la de papel.
 */
export default function CustomerMenuPage({
  params,
}: {
  params: Promise<{ branchSlug: string; tableCode: string }>;
}) {
  "use no memo";
  const { branchSlug, tableCode } = use(params);
  const router = useRouter();

  const addItem = useCartStore((s) => s.addItem);
  const getItemCount = useCartStore((s) => s.getItemCount);
  const cartItems = useCartStore((s) => s.items);
  const setSession = useCustomerStore((s) => s.setSession);
  const clearSession = useCustomerStore((s) => s.clear);

  const [menuData, setMenuData] = useState<MenuData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionValid, setSessionValid] = useState<boolean | null>(null);
  const [search, setSearch] = useState("");
  const [tableSheet, setTableSheet] = useState(false);
  const [variantsFor, setVariantsFor] = useState<DishRowItem | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

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
      .then((r) => r.json())
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
  }, [branchSlug, tableCode, clearSession]);

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
        if (result.data.categories?.length) setActiveCategory(result.data.categories[0].id);
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
  }, [branchSlug, tableCode, setSession]);

  useEffect(() => {
    const t = setTimeout(() => validateSession(), 0);
    return () => clearTimeout(t);
  }, [validateSession]);

  /*
    Llegada desde una tablet de pared: el comensal tecleó su mesa PARA hablar,
    así que la carta táctil no es su destino, solo el sitio por donde pasa el
    flujo de sesión. La intención se consume aquí y solo una vez: si más tarde
    vuelve a la carta por su propio pie, la pantalla ya no se le mueve.
  */
  useEffect(() => {
    if (sessionValid !== true) return;
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(KIOSK_INTENT_KEY) !== "1") return;
    sessionStorage.removeItem(KIOSK_INTENT_KEY);
    router.replace(`/${branchSlug}/${tableCode}/voz`);
  }, [sessionValid, branchSlug, tableCode, router]);

  useEffect(() => {
    const t = setTimeout(() => void loadMenu(), 0);
    return () => clearTimeout(t);
  }, [loadMenu]);

  /**
   * Carta de solo lectura: el local decidió que su QR sirve para leer.
   *
   * La comprobación va DESPUÉS de tener la carta, no antes: el modo llega en la
   * respuesta de `/menu`, y redirigir a la pantalla de entrada mientras tanto
   * mandaría al comensal a rellenar un formulario que en este modo no existe.
   */
  const soloLectura = menuData?.branch?.menu_mode === "static";

  if (menuData && !soloLectura && sessionValid === false) {
    redirect(`/${branchSlug}/${tableCode}`);
  }

  const currency = menuData?.branch?.currency;
  const itemCount = getItemCount();
  const cartTotal = useMemo(
    () =>
      cartItems.reduce(
        (sum, i) =>
          sum + (i.unitPrice + i.modifiers.reduce((m, x) => m + x.price, 0)) * i.quantity,
        0,
      ),
    [cartItems],
  );

  // Sin tildes ni mayúsculas: quien busca "pure" debe encontrar "Puré".
  const normalize = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const query = normalize(search.trim());

  const openDetail = (id: string) => router.push(`/${branchSlug}/${tableCode}/menu/${id}`);

  /**
   * Añadir desde la carta.
   *
   * Un plato con opciones NO se añade a ciegas: pasa por su pantalla. Si no, el
   * servidor rechaza el pedido entero al confirmar por faltar un modificador
   * obligatorio, y el comensal se entera al final, lejos de donde podía elegir.
   */
  const quickAdd = (item: DishRowItem) => {
    if (item.has_modifiers) {
      openDetail(item.id);
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

  const goToSection = (categoryId: string) => {
    setActiveCategory(categoryId);
    sectionRefs.current[categoryId]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (loading || (sessionValid === null && !soloLectura)) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">Cargando la carta…</p>
      </div>
    );
  }

  if (error || !menuData) {
    return (
      <div className="mt-12 p-6 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
          <UtensilsCrossed className="h-8 w-8 text-destructive" aria-hidden="true" />
        </div>
        <p role="alert" className="mb-2 font-medium text-destructive">
          No pudimos cargar la carta
        </p>
        <p className="mb-4 text-sm text-muted-foreground">
          {error || "Vuelve a intentarlo en un momento."}
        </p>
        <Button variant="outline" className="h-11 w-full max-w-xs" onClick={loadMenu}>
          Reintentar
        </Button>
      </div>
    );
  }

  if (soloLectura) {
    return (
      <CartaLectura
        branchName={menuData.branch.name}
        currency={menuData.branch.currency}
        categories={menuData.categories}
        items={menuData.items}
        subtitulo={menuData.table?.number ? `Mesa ${menuData.table.number}` : null}
        comoPedir="Cuando quieras pedir, llama a un mozo."
      />
    );
  }

  const { categories, items: menuItems } = menuData;
  const searchResults = query
    ? menuItems.filter((i) => normalize(`${i.name} ${i.description ?? ""}`).includes(query))
    : [];

  const renderRow = (item: DishRowItem) => {
    const units = unitsInCart(cartItems, item.id);
    const variants = variantsInCart(cartItems, item.id);
    return (
      <DishRow
        key={item.id}
        item={item}
        currency={currency}
        units={units}
        variantSummary={variants.length > 1 ? summarizeVariants(cartItems, item.id) : null}
        onOpen={() => openDetail(item.id)}
        onAdd={() => quickAdd(item)}
        onOpenVariants={() => setVariantsFor(item)}
      />
    );
  };

  return (
    // El hueco inferior solo tiene que cubrir el carrito: los avisos de mesa se
    // fueron a su hoja y el pie dejó de ser una pila de tres bloques.
    <div className={cn("relative", itemCount > 0 ? "pb-28" : "pb-8")}>
      {/* ── Única barra fija ─────────────────────────────────────────────── */}
      <div className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-3">
          <div className="min-w-0">
            <p className="truncate text-[21px] font-medium leading-tight">
              {menuData.branch.name}
            </p>
            <p className="truncate text-[12px] text-muted-foreground">
              {menuData.table?.number ? `Mesa ${menuData.table.number}` : "Tu mesa"}
              {itemCount > 0 ? " · pedido abierto" : ""}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => setTableSheet(true)}
              aria-label="Llamar al mozo o pedir la cuenta"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-border"
            >
              <Bell className="h-[18px] w-[18px]" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => router.push(`/${branchSlug}/${tableCode}/profile`)}
              aria-label="Tu perfil"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-border"
            >
              <User className="h-[18px] w-[18px]" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="px-4 pb-2">
          <div className="relative">
            <Search
              className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar en la carta"
              aria-label="Buscar platos en la carta"
              className="h-11 w-full rounded-full border border-border bg-card pl-10 pr-10 text-[14px] outline-none focus:ring-2 focus:ring-ring"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Borrar la búsqueda"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        {/* Las categorías dejan de filtrar: llevan a su sección. Filtrando, el
            comensal no podía ojear la carta de corrido como la de papel. */}
        {!query && categories.length > 0 && (
          <div className="flex gap-2 overflow-x-auto px-4 pb-3">
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => goToSection(c.id)}
                aria-pressed={activeCategory === c.id}
                className={cn(
                  "shrink-0 rounded-full px-3.5 py-2 text-[13px] transition-colors",
                  activeCategory === c.id
                    ? "bg-primary font-medium text-primary-foreground"
                    : "border border-border text-muted-foreground",
                )}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Mesero por voz. Va aquí —sobre la carta y bajo el buscador— y no
          flotando: es una alternativa a la carta, no una acción sobre ella. Se
          oculta al buscar, cuando el comensal ya sabe lo que quiere. */}
      {!query && (
        <div className="px-4 pt-4">
          <VoiceEntryButton branchSlug={branchSlug} tableCode={tableCode} />
        </div>
      )}

      {/* ── Carta ────────────────────────────────────────────────────────── */}
      <div className="px-4">
        {query ? (
          searchResults.length === 0 ? (
            <p className="py-16 text-center text-[13.5px] text-muted-foreground">
              No encontramos nada con «{search.trim()}».
            </p>
          ) : (
            <>
              <p className="pb-1 pt-4 text-[12px] text-muted-foreground">
                {searchResults.length}{" "}
                {searchResults.length === 1 ? "resultado" : "resultados"}
              </p>
              {searchResults.map(renderRow)}
            </>
          )
        ) : (
          categories.map((cat) => {
            const items = menuItems.filter((i) => i.category_id === cat.id);
            if (items.length === 0) return null;
            return (
              <section
                key={cat.id}
                ref={(el) => {
                  sectionRefs.current[cat.id] = el;
                }}
                // Deja sitio bajo la barra fija al saltar a la sección.
                className="scroll-mt-[188px]"
              >
                <div className="flex items-baseline gap-2.5 pb-1 pt-6">
                  <h2 className="text-[22px] font-medium">{cat.name}</h2>
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-[12px] text-muted-foreground">
                    {items.length} {items.length === 1 ? "plato" : "platos"}
                  </span>
                </div>
                {items.map(renderRow)}
              </section>
            );
          })
        )}
      </div>

      {/* ── Pie: solo el carrito ─────────────────────────────────────────── */}
      {itemCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          <button
            type="button"
            onClick={() => router.push(`/${branchSlug}/${tableCode}/cart`)}
            className="flex h-14 w-full items-center justify-between rounded-full bg-primary pl-4 pr-2 text-primary-foreground shadow-lg"
          >
            <span className="flex items-center gap-2.5">
              <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-primary-foreground/20 px-1 text-[13px] font-semibold tabular-nums">
                {itemCount}
              </span>
              <span className="text-[15px] font-medium">Ver mi pedido</span>
            </span>
            <span className="flex h-10 items-center gap-2 rounded-full bg-primary-foreground px-4 text-primary">
              <span className="text-[15px] font-semibold tabular-nums">
                {formatCurrency(cartTotal, currency)}
              </span>
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </span>
          </button>
        </div>
      )}

      <TableSheet
        open={tableSheet}
        onOpenChange={setTableSheet}
        branchSlug={branchSlug}
        tableCode={tableCode}
        tableNumber={menuData.table?.number}
        orderSummary={itemCount > 0 ? `${itemCount} en tu pedido` : null}
        voiceEnabled
      />

      {variantsFor && (
        <VariantsSheet
          open
          onOpenChange={(o) => !o && setVariantsFor(null)}
          menuItemId={variantsFor.id}
          itemName={variantsFor.name}
          currency={currency}
          onConfigureNew={() => openDetail(variantsFor.id)}
        />
      )}
    </div>
  );
}
