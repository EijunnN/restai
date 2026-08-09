"use client";
/* eslint-disable react-hooks/todo, react-hooks/set-state-in-effect, react-doctor/prefer-useReducer, react-doctor/no-giant-component */

import { use, useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@restai/ui/components/button";
import { Card, CardContent } from "@restai/ui/components/card";
import { Input } from "@restai/ui/components/input";
import { useCartStore } from "@/stores/cart-store";
import { useCustomerStore } from "@/stores/customer-store";
import { cn, formatCurrency } from "@/lib/utils";
import { Minus, Plus, Trash2, ArrowLeft, ShoppingBag, Ticket, Check, X, ChevronDown, Gift, ChevronRight, UtensilsCrossed, AlertCircle, ClipboardList } from "lucide-react";
import { toast } from "sonner";
import { describeReward } from "@/components/customer/reward-label";
import {
  computeCouponDiscount,
  computeRedemptionDiscount,
  computeTotals,
  effectiveUnitPrice,
  effectiveLineTotal,
  type PendingRedemption,
} from "@/lib/cart-discounts";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
// Default IGV (18%, stored in basis points: 1800/10000). All totals computed
// here are DISPLAY-ONLY ESTIMATES — the server recomputes and is authoritative.
// We prefer the branch's tax_rate from the public /menu response when present.
const DEFAULT_TAX_RATE = 1800; // 18% IGV

function useCartPageLocalState() {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  // Branch tax rate (basis points). Display-only; server total is authoritative.
  const [taxRate, setTaxRate] = useState<number>(DEFAULT_TAX_RATE);
  const [couponOpen, setCouponOpen] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; name: string; type: string; discount_value: number; menu_item_id?: string | null; min_order_amount?: number | null; max_discount_amount?: number | null } | null>(null);
  const [availableCoupons, setAvailableCoupons] = useState<any[]>([]);
  const [pendingRedemptions, setPendingRedemptions] = useState<PendingRedemption[]>([]);
  const [appliedRedemption, setAppliedRedemption] = useState<PendingRedemption | null>(null);
  // Nombres de la carta para describir un canje de producto gratis: el endpoint
  // de canjes devuelve el id del plato, no su nombre.
  const [menuItemNames, setMenuItemNames] = useState<Record<string, string>>({});

  return {
    menuItemNames,
    setMenuItemNames,
    notes,
    setNotes,
    loading,
    setLoading,
    error,
    setError,
    sessionChecked,
    setSessionChecked,
    taxRate,
    setTaxRate,
    couponOpen,
    setCouponOpen,
    couponCode,
    setCouponCode,
    couponLoading,
    setCouponLoading,
    couponError,
    setCouponError,
    appliedCoupon,
    setAppliedCoupon,
    availableCoupons,
    setAvailableCoupons,
    pendingRedemptions,
    setPendingRedemptions,
    appliedRedemption,
    setAppliedRedemption,
  };
}

function SlideToConfirm({ onConfirm, label }: { onConfirm: () => void; label: string }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const currentOffset = useRef(0);
  const thumbRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const [confirmed, setConfirmed] = useState(false);
  const THUMB_W = 64;
  const PAD = 4;

  const getMax = () => (trackRef.current ? trackRef.current.offsetWidth - THUMB_W - PAD * 2 : 250);

  const updateVisuals = (x: number) => {
    const max = getMax();
    const clamped = Math.max(0, Math.min(x, max));
    currentOffset.current = clamped;
    if (thumbRef.current) thumbRef.current.style.transform = `translateX(${clamped}px)`;
    if (labelRef.current) labelRef.current.style.opacity = `${1 - clamped / max}`;
    if (fillRef.current) fillRef.current.style.width = `${clamped + THUMB_W + PAD}px`;
  };

  const snapBack = () => {
    if (thumbRef.current) {
      thumbRef.current.style.transition = "transform 0.3s cubic-bezier(0.4,0,0.2,1)";
      thumbRef.current.style.transform = "translateX(0px)";
    }
    if (labelRef.current) {
      labelRef.current.style.transition = "opacity 0.3s";
      labelRef.current.style.opacity = "1";
    }
    if (fillRef.current) {
      fillRef.current.style.transition = "width 0.3s cubic-bezier(0.4,0,0.2,1)";
      fillRef.current.style.width = `${THUMB_W + PAD}px`;
    }
    currentOffset.current = 0;
    setTimeout(() => {
      if (thumbRef.current) thumbRef.current.style.transition = "none";
      if (labelRef.current) labelRef.current.style.transition = "none";
      if (fillRef.current) fillRef.current.style.transition = "none";
    }, 300);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (confirmed) return;
    e.preventDefault();
    isDragging.current = true;
    startX.current = e.clientX - currentOffset.current;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging.current || confirmed) return;
    updateVisuals(e.clientX - startX.current);
  };

  const confirm = () => {
    if (confirmed) return;
    updateVisuals(getMax());
    setConfirmed(true);
    onConfirm();
  };

  const handlePointerUp = () => {
    if (!isDragging.current || confirmed) return;
    isDragging.current = false;
    const max = getMax();
    if (currentOffset.current >= max * 0.8) {
      confirm();
    } else {
      snapBack();
    }
  };

  /**
   * Confirmación por teclado.
   *
   * El deslizamiento existe para evitar pedidos por toque accidental, no para
   * excluir a nadie. Sin esto, el ÚLTIMO paso del embudo era imposible para
   * quien navega con teclado, usa lector de pantalla o tiene movilidad reducida:
   * podía elegir todo el pedido y no llegar a enviarlo.
   *
   * Las flechas avanzan el control (conserva el gesto deliberado); Enter y
   * Espacio confirman directamente, que es lo que espera quien usa teclado.
   */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (confirmed) return;
    const max = getMax();
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      confirm();
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      const next = currentOffset.current + max / 5;
      if (next >= max) confirm();
      else updateVisuals(next);
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      updateVisuals(Math.max(0, currentOffset.current - max / 5));
    }
  };

  return (
    <div
      ref={trackRef}
      className="relative h-16 rounded-2xl bg-foreground overflow-hidden select-none"
    >
      {/* Shimmer animation hint */}
      {!confirmed && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl">
          <div
            className="absolute inset-y-0 w-24 bg-gradient-to-r from-transparent via-background/10 to-transparent"
            style={{ animation: "slide-shimmer 2.5s ease-in-out infinite" }}
          />
        </div>
      )}

      {/* Fill behind thumb */}
      <div
        ref={fillRef}
        className="absolute inset-y-0 left-0 rounded-2xl"
        style={{
          width: THUMB_W + PAD,
          background: confirmed
            ? "oklch(0.55 0.18 142)"
            : "rgba(255,255,255,0.08)",
        }}
      />

      {/* Label — offset to center in the area right of the thumb */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ paddingLeft: THUMB_W + PAD }}>
        <span
          ref={labelRef}
          className="text-sm font-semibold text-background/70 tracking-wide"
        >
          {confirmed ? "Pedido confirmado" : label}
        </span>
      </div>

      {/* Draggable thumb */}
      <div
        ref={thumbRef}
        role="button"
        tabIndex={confirmed ? -1 : 0}
        aria-label={
          confirmed
            ? "Pedido confirmado"
            : `${label}. Desliza hacia la derecha, o pulsa Enter para confirmar.`
        }
        aria-disabled={confirmed}
        className="absolute top-1 left-1 w-[60px] h-[56px] rounded-xl flex items-center justify-center cursor-grab active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        style={{
          background: confirmed ? "oklch(0.55 0.18 142)" : "var(--background)",
          boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
          touchAction: "none",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleKeyDown}
      >
        {confirmed ? (
          <Check className="h-6 w-6 text-white" />
        ) : (
          <div className="flex items-center -space-x-1.5">
            <ChevronRight className="h-5 w-5 text-foreground/40" />
            <ChevronRight className="h-5 w-5 text-foreground/70" />
            <ChevronRight className="h-5 w-5 text-foreground" />
          </div>
        )}
      </div>

    </div>
  );
}

export default function CartPage({
  params,
}: {
  params: Promise<{ branchSlug: string; tableCode: string }>;
}) {
  "use no memo";
  const { branchSlug, tableCode } = use(params);
  const router = useRouter();
  const {
    items,
    updateLineQuantity,
    updateLineNotes,
    clearCart,
    getSubtotal,
    getTax,
    getTotal,
    getItemCount,
  } = useCartStore();
  const unitCount = getItemCount();
  // Order type: QR table orders default to dine-in ("en local"). The customer
  // can switch to takeout ("para llevar"). Sent to the server on confirm.
  const [orderType, setOrderType] = useState<"dine_in" | "takeout">("dine_in");
  const customerToken = useCustomerStore((s) => s.token);
  const setOrderId = useCustomerStore((s) => s.setOrderId);
  const clearSession = useCustomerStore((s) => s.clear);
  const {
    notes,
    setNotes,
    loading,
    setLoading,
    error,
    setError,
    sessionChecked,
    setSessionChecked,
    taxRate,
    setTaxRate,
    couponOpen,
    setCouponOpen,
    couponCode,
    setCouponCode,
    couponLoading,
    setCouponLoading,
    couponError,
    setCouponError,
    appliedCoupon,
    setAppliedCoupon,
    availableCoupons,
    setAvailableCoupons,
    pendingRedemptions,
    setPendingRedemptions,
    appliedRedemption,
    setAppliedRedemption,
    menuItemNames,
    setMenuItemNames,
  } = useCartPageLocalState();

  const getToken = useCallback(() => {
    if (customerToken) return customerToken;
    if (typeof window !== "undefined") {
      return sessionStorage.getItem("customer_token");
    }
    return null;
  }, [customerToken]);

  const validateSession = useCallback(() => {
    const token = getToken();
    if (!token) {
      clearSession();
      router.replace(`/${branchSlug}/${tableCode}`);
      return;
    }
    void fetch(`${API_URL}/api/customer/${branchSlug}/${tableCode}/check-session`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((response) => response.json())
      .then((result) => {
        if (result.success && result.data.hasSession && result.data.status === "active") {
          setSessionChecked(true);
        } else {
          clearSession();
          router.replace(`/${branchSlug}/${tableCode}`);
        }
      })
      .catch(() => {
        clearSession();
        router.replace(`/${branchSlug}/${tableCode}`);
      });
  }, [getToken, clearSession, router, branchSlug, tableCode, setSessionChecked]);

  // Validate session on mount
  useEffect(() => {
    const timeout = setTimeout(() => {
      validateSession();
    }, 0);
    return () => clearTimeout(timeout);
  }, [validateSession]);

  const loadDiscounts = useCallback(() => {
    const token = getToken();
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    void Promise.all([
      fetch(`${API_URL}/api/customer/my-coupons`, { headers }),
      fetch(`${API_URL}/api/customer/my-redemptions`, { headers }),
    ])
      .then(([couponsRes, redemptionsRes]) => Promise.all([
        couponsRes.json(),
        redemptionsRes.json(),
      ]))
      .then(([couponsData, redemptionsData]) => {
        if (couponsData.success && couponsData.data?.length > 0) {
          setAvailableCoupons(couponsData.data);
        }
        if (redemptionsData.success && redemptionsData.data?.length > 0) {
          setPendingRedemptions(redemptionsData.data);
        }
      })
      .catch(() => {
        // Ignore discounts errors
      });
  }, [getToken, setAvailableCoupons, setPendingRedemptions]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      void loadDiscounts();
    }, 0);
    return () => clearTimeout(timeout);
  }, [loadDiscounts]);

  // El IGV REAL de la sede (`branch.tax_rate`, en centésimas de punto). Ya no se
  // asume 18 %: una sede exonerada de la Amazonía o un cambio de tipo dejaría el
  // total estimado sistemáticamente mal. La misma respuesta sirve para traducir
  // menu_item_id → nombre del plato en los canjes de producto gratis. Sigue
  // siendo una ESTIMACIÓN: el servidor recalcula y manda al registrar el pedido.
  const loadBranchMenu = useCallback(() => {
    void fetch(`${API_URL}/api/customer/${branchSlug}/${tableCode}/menu`)
      .then((res) => res.json())
      .then((data) => {
        const rate = data?.data?.branch?.tax_rate;
        if (typeof rate === "number" && rate > 0) {
          setTaxRate(rate);
        }
        const items = data?.data?.items;
        if (Array.isArray(items)) {
          const names: Record<string, string> = {};
          for (const item of items as Array<{ id: string; name: string }>) {
            names[item.id] = item.name;
          }
          setMenuItemNames(names);
        }
      })
      .catch(() => {
        // Fall back to DEFAULT_TAX_RATE on any error.
      });
  }, [branchSlug, tableCode, setTaxRate, setMenuItemNames]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      void loadBranchMenu();
    }, 0);
    return () => clearTimeout(timeout);
  }, [loadBranchMenu]);

  // Display-only estimates — server total is authoritative.
  const subtotal = getSubtotal();
  const tax = getTax(taxRate);
  const total = getTotal(taxRate);

  const handleValidateCoupon = () => {
    if (!couponCode.trim()) return;
    setCouponLoading(true);
    setCouponError(null);
    const token = getToken();
    void fetch(`${API_URL}/api/customer/validate-coupon`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ code: couponCode.toUpperCase() }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (!data.success) {
          setCouponError(data.error?.message || "Cupón inválido");
          setCouponLoading(false);
          return;
        }
        setAppliedCoupon({
          code: data.data.code,
          name: data.data.name,
          type: data.data.type,
          discount_value: data.data.discount_value || 0,
          menu_item_id: data.data.menu_item_id || null,
          min_order_amount: data.data.min_order_amount ?? null,
          max_discount_amount: data.data.max_discount_amount ?? null,
        });
        setCouponCode("");
        setCouponLoading(false);
      })
      .catch(() => {
        setCouponError("No pudimos validar el cupón. Inténtalo de nuevo.");
        setCouponLoading(false);
      });
  };

  // El cálculo de descuentos vive en `lib/cart-discounts.ts`: el mesero por voz
  // necesita EXACTAMENTE el mismo para poder decir el total en voz alta, y dos
  // copias de la misma aritmética de dinero acaban divergiendo.
  const {
    discount: couponDiscount,
    blockedReason: couponBlockedReason,
    serverOnly: couponServerOnly,
  } = computeCouponDiscount({ coupon: appliedCoupon, items, subtotal, menuItemNames });

  const { discount: redemptionDiscount, blockedReason: redemptionBlockedReason } =
    computeRedemptionDiscount({
      redemption: appliedRedemption,
      items,
      subtotal,
      couponDiscount,
      menuItemNames,
    });

  const totalDiscount = couponDiscount + redemptionDiscount;
  const { taxableBase, tax: computedTax, total: computedTotal } = computeTotals({
    subtotal,
    totalDiscount,
    taxRate,
  });
  // Sin descuento se conservan las cifras del store, para no cambiar por un
  // redondeo distinto lo que ya se venía mostrando.
  const adjustedTax = totalDiscount > 0 ? computedTax : tax;
  const adjustedTotal = totalDiscount > 0 ? computedTotal : total;

  const handleConfirmOrder = () => {
    setLoading(true);
    setError(null);
    const token = getToken();
    void fetch(`${API_URL}/api/customer/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        type: orderType,
        items: items.map((item) => ({
          menuItemId: item.menuItemId,
          quantity: item.quantity,
          // El `??` importa: las notas que dictó el comensal al mesero por voz
          // viven en la línea del carrito, no en este estado local, que solo se
          // llena al escribir aquí. Con `||` se perdía en silencio un "sin
          // cebolla" dicho en voz alta si luego se confirmaba desde esta
          // pantalla. El estado local sigue mandando cuando existe, para que
          // borrar la nota a mano de verdad la borre.
          notes: (notes[item.lineId] ?? item.notes) || undefined,
          modifiers: item.modifiers.map((m) => ({
            modifierId: m.modifierId,
          })),
        })),
        // Only send the coupon when it actually qualifies (min order met). If it
        // is blocked, omit it so the order is not rejected wholesale by the
        // server — the user already sees the hint that it is not applied.
        ...(appliedCoupon && !couponBlockedReason ? { couponCode: appliedCoupon.code } : {}),
        // Un canje que no descuenta nada (producto gratis que no está en el
        // carrito) SE CONSUMIRÍA igualmente al enviarlo: el servidor lo marca
        // como usado. No se manda hasta que de verdad valga algo.
        ...(appliedRedemption && !redemptionBlockedReason
          ? { redemptionId: appliedRedemption.id }
          : {}),
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (!data.success) {
          setError(data.error?.message || "No pudimos registrar tu pedido. Inténtalo de nuevo.");
          setLoading(false);
          return;
        }

        if (data.data?.id) {
          setOrderId(data.data.id);
        }

        clearCart();
        toast.success("Pedido enviado a cocina", {
          description: `Orden #${data.data?.order_number || ""} recibida`,
        });
        setLoading(false);
        router.push(`/${branchSlug}/${tableCode}/status`);
      })
      .catch(() => {
        setError("No hay conexión con el restaurante. Revisa tu red e inténtalo de nuevo.");
        setLoading(false);
      });
  };

  if (items.length === 0) {
    return (
      <div className="p-6 mt-12 text-center">
        <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-muted">
          <ShoppingBag className="h-10 w-10 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-bold mb-2">Tu carrito está vacío</h2>
        <p className="text-muted-foreground mb-6">
          Elige algo de la carta y aparecerá aquí.
        </p>
        <div className="mx-auto max-w-xs space-y-2">
          <Button
            className="h-12 w-full"
            onClick={() => router.push(`/${branchSlug}/${tableCode}/menu`)}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Volver a la carta
          </Button>
          <Button
            variant="outline"
            className="h-12 w-full"
            onClick={() => router.push(`/${branchSlug}/${tableCode}/status`)}
          >
            <ClipboardList className="h-4 w-4 mr-2" />
            Ver mis pedidos
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 pb-28">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10"
          aria-label="Volver a la carta"
          onClick={() => router.push(`/${branchSlug}/${tableCode}/menu`)}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold">Tu pedido</h1>
          {/* Unidades, no líneas: dos ceviches y un lomo son 3 platos, no 2. */}
          <p className="text-xs text-muted-foreground">
            {unitCount} {unitCount === 1 ? "plato" : "platos"}
          </p>
        </div>
        <Button
          variant="ghost"
          className="h-10 shrink-0 gap-1.5 px-2 text-xs"
          onClick={() => router.push(`/${branchSlug}/${tableCode}/status`)}
        >
          <ClipboardList className="h-4 w-4" />
          Mis pedidos
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {/* Order type selector — en local vs para llevar */}
      <Card>
        <CardContent className="p-3">
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={orderType === "dine_in" ? "default" : "outline"}
              className="h-11"
              onClick={() => setOrderType("dine_in")}
            >
              <UtensilsCrossed className="h-4 w-4 mr-2" />
              En local
            </Button>
            <Button
              type="button"
              variant={orderType === "takeout" ? "default" : "outline"}
              className="h-11"
              onClick={() => setOrderType("takeout")}
            >
              <ShoppingBag className="h-4 w-4 mr-2" />
              Para llevar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Cart items */}
      <div className="space-y-3">
        {items.map((item) => (
          <Card key={item.lineId}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium">{item.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {formatCurrency(effectiveUnitPrice(item))} c/u
                  </p>
                  {item.modifiers.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {item.modifiers.map((m) => (
                        <li
                          key={m.modifierId}
                          className="flex items-center justify-between gap-2 text-xs text-muted-foreground"
                        >
                          <span>+ {m.name}</span>
                          {m.price > 0 && (
                            <span className="shrink-0">{formatCurrency(m.price)}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {/* 40px de lado: se pulsa de pie y con una sola mano. */}
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 rounded-full"
                    /*
                      A una unidad este botón no resta: elimina la línea entera
                      (`updateLineQuantity(.., 0)` borra). Decir "quitar una
                      unidad" engañaba a quien navega con lector de pantalla.
                    */
                    aria-label={
                      item.quantity === 1
                        ? `Quitar ${item.name} del pedido`
                        : `Quitar una unidad de ${item.name}`
                    }
                    onClick={() => updateLineQuantity(item.lineId, item.quantity - 1)}
                  >
                    {item.quantity === 1 ? (
                      <Trash2 className="h-4 w-4" />
                    ) : (
                      <Minus className="h-4 w-4" />
                    )}
                  </Button>
                  <span className="w-7 text-center font-bold text-sm tabular-nums">
                    {item.quantity}
                  </span>
                  <Button
                    size="icon"
                    className="h-10 w-10 rounded-full"
                    aria-label={`Añadir una unidad de ${item.name}`}
                    onClick={() => updateLineQuantity(item.lineId, item.quantity + 1)}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-bold text-sm tabular-nums">
                    {formatCurrency(effectiveLineTotal(item))}
                  </p>
                </div>
              </div>
              <div className="mt-3">
                <Input
                  placeholder="Notas (ej: sin cebolla)"
                  aria-label={`Notas para ${item.name}`}
                  className="text-sm h-10"
                  value={notes[item.lineId] ?? item.notes ?? ""}
                  onChange={(e) =>
                    setNotes({ ...notes, [item.lineId]: e.target.value })
                  }
                  /*
                    La nota también va al carrito, que persiste en sessionStorage.
                    Antes vivía solo en este estado local: quien escribía "sin
                    cebolla", volvía a la carta a añadir algo y regresaba, se
                    encontraba el campo vacío sin que nada lo avisara.
                  */
                  onBlur={(e) => updateLineNotes(item.lineId, e.target.value)}
                />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Coupon section */}
      <Card>
        <CardContent className="p-4">
          <button
            type="button"
            aria-expanded={couponOpen}
            onClick={() => setCouponOpen(!couponOpen)}
            className="flex min-h-11 w-full items-center gap-2 text-sm font-medium text-foreground"
          >
            <Ticket className="h-4 w-4 text-primary" />
            Tengo un cupón
            {appliedCoupon && !couponBlockedReason && (
              <span className="text-[10px] font-medium text-green-600 dark:text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded">
                Aplicado
              </span>
            )}
            {appliedCoupon && couponBlockedReason && (
              <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                No aplicable aún
              </span>
            )}
            <ChevronDown
              className={`h-4 w-4 ml-auto text-muted-foreground transition-transform duration-200 ${
                couponOpen ? "rotate-180" : ""
              }`}
            />
          </button>

          <div
            className="grid transition-[grid-template-rows] duration-200 ease-in-out"
            style={{ gridTemplateRows: couponOpen ? "1fr" : "0fr" }}
          >
            <div className="overflow-hidden">
            <div className="pt-3 space-y-2">
              {availableCoupons.length > 0 && !appliedCoupon && (
                <div className="space-y-2 mb-3">
                  <p className="text-xs font-medium text-muted-foreground">Cupones disponibles:</p>
                  {availableCoupons.map((coupon: any) => (
                    <button
                      key={coupon.id}
                      onClick={() => {
                        setAppliedCoupon({
                          code: coupon.code,
                          name: coupon.name,
                          type: coupon.type,
                          discount_value: coupon.discount_value || 0,
                          menu_item_id: coupon.menu_item_id || null,
                          min_order_amount: coupon.min_order_amount ?? null,
                          max_discount_amount: coupon.max_discount_amount ?? null,
                        });
                      }}
                      className="w-full min-h-12 flex items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3 hover:bg-primary/10 transition-colors text-left"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{coupon.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{coupon.code}</p>
                      </div>
                      <span className="text-sm font-bold text-primary">
                        {coupon.type === "percentage" || coupon.type === "item_discount"
                          ? `${coupon.discount_value}%`
                          : coupon.type === "item_free"
                            ? "Gratis"
                            : coupon.type === "buy_x_get_y"
                              ? "Promo"
                              : formatCurrency(coupon.discount_value || 0)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {appliedCoupon && couponBlockedReason ? (
                <div className="flex items-center justify-between rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3">
                  <div className="flex items-center gap-2">
                    <Ticket className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <div>
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-300">{appliedCoupon.code}</p>
                      <p className="text-xs text-amber-600 dark:text-amber-400">{couponBlockedReason}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAppliedCoupon(null)}
                    aria-label="Quitar el cupón"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                  >
                    <X className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  </button>
                </div>
              ) : appliedCoupon ? (
                <div className="flex items-center justify-between rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-3">
                  <div className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                    <div>
                      <p className="text-sm font-medium text-green-800 dark:text-green-300">{appliedCoupon.code}</p>
                      <p className="text-xs text-green-600 dark:text-green-400">
                        {appliedCoupon.name}
                        {couponServerOnly
                          ? " · el descuento se calcula al confirmar el pedido"
                          : ` - ${formatCurrency(couponDiscount)} descuento`}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAppliedCoupon(null)}
                    aria-label="Quitar el cupón"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                  >
                    <X className="h-4 w-4 text-green-600 dark:text-green-400" />
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Ingresa tu código"
                      value={couponCode}
                      onChange={(e) => { setCouponCode(e.target.value.toUpperCase()); setCouponError(null); }}
                      aria-label="Código de cupón"
                      className="text-sm h-10 font-mono"
                    />
                    <Button
                      onClick={handleValidateCoupon}
                      disabled={couponLoading || !couponCode.trim()}
                      className="h-10 px-4"
                    >
                      {couponLoading ? "..." : "Aplicar"}
                    </Button>
                  </div>
                  {couponError && (
                    <p role="alert" className="text-xs text-destructive">{couponError}</p>
                  )}
                </>
              )}
            </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Reward redemptions section */}
      {(pendingRedemptions.length > 0 || appliedRedemption) && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground mb-3">
              <Gift className="h-4 w-4 text-primary" />
              Recompensas canjeadas
              {appliedRedemption && !redemptionBlockedReason && (
                <span className="text-[10px] font-medium text-green-600 dark:text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded">
                  Aplicada
                </span>
              )}
              {appliedRedemption && redemptionBlockedReason && (
                <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                  Falta un producto
                </span>
              )}
            </div>

            {appliedRedemption ? (
              <div
                className={cn(
                  "flex items-center justify-between gap-2 rounded-lg border p-3",
                  redemptionBlockedReason
                    ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800"
                    : "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800",
                )}
              >
                <div className="flex min-w-0 items-center gap-2">
                  {redemptionBlockedReason ? (
                    <Gift className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  ) : (
                    <Check className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
                  )}
                  <div className="min-w-0">
                    <p
                      className={cn(
                        "text-sm font-medium",
                        redemptionBlockedReason
                          ? "text-amber-800 dark:text-amber-300"
                          : "text-green-800 dark:text-green-300",
                      )}
                    >
                      {appliedRedemption.reward_name}
                    </p>
                    <p
                      className={cn(
                        "text-xs",
                        redemptionBlockedReason
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-green-600 dark:text-green-400",
                      )}
                    >
                      {redemptionBlockedReason ??
                        `${describeReward(appliedRedemption, menuItemNames)}${
                          redemptionDiscount > 0
                            ? ` · -${formatCurrency(redemptionDiscount)}`
                            : ""
                        }`}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setAppliedRedemption(null)}
                  aria-label={`Quitar la recompensa ${appliedRedemption.reward_name}`}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                >
                  <X
                    className={cn(
                      "h-4 w-4",
                      redemptionBlockedReason
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-green-600 dark:text-green-400",
                    )}
                  />
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {pendingRedemptions.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setAppliedRedemption(r)}
                    className="w-full min-h-12 flex items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3 hover:bg-primary/10 transition-colors text-left"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{r.reward_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {describeReward(r, menuItemNames)}
                      </p>
                    </div>
                    <span className="text-xs font-bold text-primary shrink-0">Aplicar</span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Summary */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="font-medium">{formatCurrency(subtotal)}</span>
          </div>
          {couponDiscount > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-green-600 dark:text-green-400">Cupón ({appliedCoupon?.code})</span>
              <span className="font-medium text-green-600 dark:text-green-400">-{formatCurrency(couponDiscount)}</span>
            </div>
          )}
          {appliedCoupon && couponServerOnly && (
            <div className="flex justify-between gap-3 text-sm">
              <span className="text-green-600 dark:text-green-400">Cupón ({appliedCoupon.code})</span>
              {/* El total de abajo NO incluye este descuento: el importe lo
                  calcula el servidor con las reglas de la promoción. */}
              <span className="shrink-0 text-xs font-medium text-green-600 dark:text-green-400">
                Se aplica al confirmar
              </span>
            </div>
          )}
          {redemptionDiscount > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-green-600 dark:text-green-400">
                Recompensa ({appliedRedemption?.reward_name})
              </span>
              <span className="font-medium text-green-600 dark:text-green-400">-{formatCurrency(redemptionDiscount)}</span>
            </div>
          )}
          {appliedRedemption && redemptionBlockedReason && (
            <div className="flex justify-between gap-3 text-sm">
              <span className="text-amber-600 dark:text-amber-400">
                Recompensa ({appliedRedemption.reward_name})
              </span>
              <span className="shrink-0 text-xs font-medium text-amber-600 dark:text-amber-400">
                Sin aplicar
              </span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            {/* El porcentaje sale de branch.tax_rate (centésimas de punto) y se
                escribe con coma decimal, como en el Perú. */}
            <span className="text-muted-foreground">
              IGV ({(taxRate / 100).toLocaleString("es-PE", { maximumFractionDigits: 2 })}%)
            </span>
            <span className="font-medium">{formatCurrency(totalDiscount > 0 ? adjustedTax : tax)}</span>
          </div>
          <div className="border-t border-border pt-3">
            <div className="flex justify-between font-bold text-lg">
              <span>Total</span>
              <span className="text-primary">{formatCurrency(adjustedTotal)}</span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Total estimado. El monto final se confirma al registrar el pedido.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Fixed bottom — Slide to confirm */}
      <div className="fixed bottom-0 left-0 right-0 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] bg-background/95 backdrop-blur-md border-t border-border">
        <div className="max-w-lg mx-auto">
          {/*
            El error se muestra AQUÍ, pegado a la acción. Antes solo se pintaba
            en la cabecera de la página: con el carrito largo quedaba fuera de la
            pantalla y el comensal arrastraba el control una y otra vez sin
            entender por qué no pasaba nada.
          */}
          {error && !loading && (
            <div
              role="alert"
              className="mb-3 flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {loading ? (
            <div className="h-14 rounded-2xl bg-foreground flex items-center justify-center gap-2">
              <div className="h-4 w-4 border-2 border-background/30 border-t-background rounded-full animate-spin" />
              <span className="text-background font-semibold">Enviando pedido...</span>
            </div>
          ) : (
            <SlideToConfirm
              onConfirm={handleConfirmOrder}
              label={`Desliza para confirmar · ${formatCurrency(adjustedTotal)}`}
            />
          )}
        </div>
      </div>
    </div>
  );
}
