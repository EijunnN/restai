"use client";
/* eslint-disable react-hooks/todo, react-hooks/set-state-in-effect, react-doctor/prefer-useReducer, react-doctor/no-giant-component */

import { use, useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { redirect, useRouter } from "next/navigation";
import { Button } from "@restai/ui/components/button";
import { Card, CardContent } from "@restai/ui/components/card";
import { Badge } from "@restai/ui/components/badge";
import { useCartStore } from "@/stores/cart-store";
import { useCustomerStore } from "@/stores/customer-store";
import { formatCurrency, cn } from "@/lib/utils";
import { ShoppingCart, Plus, Minus, Loader2, ImageOff, UtensilsCrossed, Receipt, Bell, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

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

interface Category {
  id: string;
  name: string;
  sort_order: number;
}

interface MenuData {
  branch: { id: string; name: string; slug: string; currency: string };
  table: { id: string; number: number };
  categories: Category[];
  items: MenuItem[];
}

function useCustomerMenuLocalState() {
  const [menuData, setMenuData] = useState<MenuData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionSent, setActionSent] = useState<{ request_bill: boolean; call_waiter: boolean }>({
    request_bill: false,
    call_waiter: false,
  });
  const [sessionValid, setSessionValid] = useState<boolean | null>(null);

  return {
    menuData,
    setMenuData,
    loading,
    setLoading,
    error,
    setError,
    activeCategory,
    setActiveCategory,
    actionLoading,
    setActionLoading,
    actionSent,
    setActionSent,
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
  const { addItem, getItemCount, items, updateQuantity } = useCartStore();
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
    actionLoading,
    setActionLoading,
    actionSent,
    setActionSent,
    sessionValid,
    setSessionValid,
  } = useCustomerMenuLocalState();
  const clearSession = useCustomerStore((s) => s.clear);

  const getToken = () => {
    const storeToken = useCustomerStore.getState().token;
    if (storeToken) return storeToken;
    if (typeof window !== "undefined") return sessionStorage.getItem("customer_token");
    return null;
  };

  const getSessionId = () => {
    const storeSessionId = useCustomerStore.getState().sessionId;
    if (storeSessionId) return storeSessionId;
    if (typeof window !== "undefined") return sessionStorage.getItem("customer_session_id");
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
          setError(result.error?.message || "Error al cargar el menu");
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
        setError("Error inesperado");
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

  const handleTableAction = async (action: "request_bill" | "call_waiter") => {
    const token = getToken();
    const sessionId = getSessionId();
    if (!token || !sessionId) return;
    setActionLoading(action);
    try {
      const res = await fetch(`${API_URL}/api/customer/table-action`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action, tableSessionId: sessionId }),
      });

      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.error?.message || "No se pudo enviar la solicitud");
      }

      setActionSent((prev) => ({ ...prev, [action]: true }));
      toast.success(
        action === "request_bill"
          ? "Cuenta solicitada. El personal fue notificado."
          : "Mozo solicitado. El personal fue notificado."
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al enviar solicitud");
    } finally {
      setActionLoading(null);
    }
  };

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
  const cartTotal = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);

  const handleAddItem = (item: MenuItem) => {
    addItem({
      menuItemId: item.id,
      name: item.name,
      unitPrice: item.price,
      quantity: 1,
      modifiers: [],
    });
  };

  const getItemQty = (itemId: string) => {
    const cartItem = items.find((i) => i.menuItemId === itemId);
    return cartItem?.quantity || 0;
  };

  if (loading || sessionValid === null) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Cargando menu...</p>
      </div>
    );
  }

  if (sessionValid === false) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Redirigiendo...</p>
      </div>
    );
  }

  if (error || !menuData) {
    return (
      <div className="p-6 mt-12 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
          <ImageOff className="h-8 w-8 text-destructive" />
        </div>
        <p className="text-destructive font-medium mb-2">Error</p>
        <p className="text-sm text-muted-foreground mb-4">{error || "Error al cargar menu"}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Reintentar
        </Button>
      </div>
    );
  }

  const { categories, items: menuItems } = menuData;
  const itemsByCategory = (catId: string) =>
    menuItems.filter((i) => i.category_id === catId && i.is_available);

  return (
    <div className="relative pb-32">
      {/* Category tabs */}
      <div className="sticky top-[49px] z-30 bg-background/95 backdrop-blur border-b border-border">
        <div className="flex overflow-x-auto no-scrollbar gap-2 p-3">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={cn(
                "px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all",
                activeCategory === cat.id
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-secondary text-secondary-foreground hover:bg-accent",
              )}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </div>

      {/* Menu items */}
      <div className="p-4 space-y-6">
        {categories.map((category) => (
          <div
            key={category.id}
            className={cn(activeCategory !== category.id && "hidden")}
          >
            <h2 className="text-lg font-bold mb-3">{category.name}</h2>
            <div className="space-y-3">
              {itemsByCategory(category.id).length === 0 && (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No hay productos disponibles en esta categoria
                </p>
              )}
              {itemsByCategory(category.id).map((item) => {
                const qty = getItemQty(item.id);
                return (
                  <Card key={item.id} className="overflow-hidden">
                    <CardContent className="p-0">
                      <div className="flex">
                        {/* Clickable image area */}
                        <button
                          type="button"
                          className="shrink-0 w-28 h-28 sm:w-32 sm:h-32 relative cursor-pointer"
                          onClick={() =>
                            router.push(
                              `/${branchSlug}/${tableCode}/menu/${item.id}`,
                            )
                          }
                        >
                          {item.image_url ? (
                            <Image
                              src={item.image_url}
                              alt={item.name}
                              fill
                              sizes="128px"
                              unoptimized
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full bg-muted flex items-center justify-center">
                              <UtensilsCrossed className="h-8 w-8 text-muted-foreground/50" />
                            </div>
                          )}
                        </button>
                        {/* Info area */}
                        <div className="flex-1 min-w-0 p-3 flex flex-col justify-between">
                          <div>
                            <button
                              type="button"
                              className="text-left w-full cursor-pointer"
                              onClick={() =>
                                router.push(
                                  `/${branchSlug}/${tableCode}/menu/${item.id}`,
                                )
                              }
                            >
                              <h3 className="font-semibold leading-tight line-clamp-1">
                                {item.name}
                              </h3>
                              {item.description && (
                                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                  {item.description}
                                </p>
                              )}
                            </button>
                          </div>
                          <div className="flex items-center justify-between mt-2">
                            <p className="text-base font-bold text-primary">
                              {formatCurrency(item.price)}
                            </p>
                            {qty > 0 ? (
                              <div className="flex items-center gap-1">
                                <Button
                                  size="icon"
                                  variant="outline"
                                  className="h-8 w-8 rounded-full"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    updateQuantity(item.id, qty - 1);
                                  }}
                                >
                                  <Minus className="h-3.5 w-3.5" />
                                </Button>
                                <span className="w-7 text-center font-bold text-sm">
                                  {qty}
                                </span>
                                <Button
                                  size="icon"
                                  className="h-8 w-8 rounded-full"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleAddItem(item);
                                  }}
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            ) : (
                              <Button
                                size="sm"
                                className="rounded-full h-8 px-3"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAddItem(item);
                                }}
                              >
                                <Plus className="h-4 w-4 mr-1" />
                                Agregar
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Floating action bar + cart */}
      <div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur border-t border-border">
        {/* Action buttons */}
        <div className="flex gap-2 px-4 pt-3 pb-2 max-w-lg mx-auto">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 h-9 text-xs gap-1.5"
            disabled={actionLoading !== null || actionSent.request_bill}
            onClick={() => handleTableAction("request_bill")}
          >
            {actionSent.request_bill ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
            ) : (
              <Receipt className="h-3.5 w-3.5" />
            )}
            {actionLoading === "request_bill"
              ? "Enviando..."
              : actionSent.request_bill
                ? "Cuenta Solicitada"
                : "Pedir la Cuenta"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 h-9 text-xs gap-1.5"
            disabled={actionLoading !== null || actionSent.call_waiter}
            onClick={() => handleTableAction("call_waiter")}
          >
            {actionSent.call_waiter ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
            ) : (
              <Bell className="h-3.5 w-3.5" />
            )}
            {actionLoading === "call_waiter"
              ? "Enviando..."
              : actionSent.call_waiter
                ? "Mozo Solicitado"
                : "Llamar al Mozo"}
          </Button>
        </div>
        {(actionSent.request_bill || actionSent.call_waiter) && (
          <div className="px-4 pb-2">
            <div className="max-w-lg mx-auto rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-xs text-green-700 dark:text-green-300">
              Tu solicitud fue enviada al personal del restaurante.
            </div>
          </div>
        )}
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
