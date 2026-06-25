"use client";
/* eslint-disable react-hooks/todo, react-hooks/set-state-in-effect, react-doctor/prefer-useReducer, react-doctor/no-giant-component */

import { use, useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@restai/ui/components/button";
import { Card, CardContent } from "@restai/ui/components/card";
import { Input } from "@restai/ui/components/input";
import { useCartStore } from "@/stores/cart-store";
import { useCustomerStore } from "@/stores/customer-store";
import { formatCurrency } from "@/lib/utils";
import { Minus, Plus, Trash2, ArrowLeft, ShoppingBag, Ticket, Check, X, ChevronDown, Gift, ChevronRight, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";

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
  const [pendingRedemptions, setPendingRedemptions] = useState<Array<{ id: string; reward_name: string; discount_type: string; discount_value: number }>>([]);
  const [appliedRedemption, setAppliedRedemption] = useState<{ id: string; reward_name: string; discount_type: string; discount_value: number } | null>(null);

  return {
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

  const handlePointerUp = () => {
    if (!isDragging.current || confirmed) return;
    isDragging.current = false;
    const max = getMax();
    if (currentOffset.current >= max * 0.8) {
      updateVisuals(max);
      setConfirmed(true);
      onConfirm();
    } else {
      snapBack();
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
        className="absolute top-1 left-1 w-[60px] h-[56px] rounded-xl flex items-center justify-center cursor-grab active:cursor-grabbing"
        style={{
          background: confirmed ? "oklch(0.55 0.18 142)" : "var(--background)",
          boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
          touchAction: "none",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
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
    removeLine,
    clearCart,
    getSubtotal,
    getTax,
    getTotal,
  } = useCartStore();
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

  // Prefer the branch tax_rate from the public menu when available; the menu
  // endpoint is public so no auth is required. These totals remain estimates —
  // the server recomputes the authoritative total on order creation.
  const loadTaxRate = useCallback(() => {
    void fetch(`${API_URL}/api/customer/${branchSlug}/${tableCode}/menu`)
      .then((res) => res.json())
      .then((data) => {
        const rate = data?.data?.branch?.tax_rate;
        if (typeof rate === "number" && rate > 0) {
          setTaxRate(rate);
        }
      })
      .catch(() => {
        // Fall back to DEFAULT_TAX_RATE on any error.
      });
  }, [branchSlug, tableCode, setTaxRate]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      void loadTaxRate();
    }, 0);
    return () => clearTimeout(timeout);
  }, [loadTaxRate]);

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
          setCouponError(data.error?.message || "Cupon invalido");
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
        setCouponError("Error al validar cupon");
        setCouponLoading(false);
      });
  };

  // Effective per-unit price of a cart line INCLUDING its modifiers. Mirrors the
  // server's effectiveUnitPrice (line total / quantity) so free-item and
  // buy-x-get-y estimates match the confirmed total.
  const effectiveUnitPrice = (item: (typeof items)[number]): number => {
    const modifiersTotal = item.modifiers.reduce((ms, m) => ms + m.price, 0);
    return item.unitPrice + modifiersTotal;
  };
  // Effective line total (modifier-inclusive, × quantity). Matches server `total`.
  const effectiveLineTotal = (item: (typeof items)[number]): number =>
    effectiveUnitPrice(item) * item.quantity;

  // Honest coupon preview. Returns the estimated discount AND, when the coupon
  // cannot apply yet (min order not met), a human hint instead of pretending it
  // is applied. All math mirrors apps/api/src/services/order.service.ts so the
  // previewed total matches the server's confirmed total. Still an ESTIMATE —
  // the server recomputes and is authoritative.
  function computeCouponDiscount(): { discount: number; blockedReason: string | null } {
    if (!appliedCoupon) return { discount: 0, blockedReason: null };

    // Min order amount gate (server rejects the coupon below this threshold).
    if (
      appliedCoupon.min_order_amount != null &&
      subtotal < appliedCoupon.min_order_amount
    ) {
      const faltan = appliedCoupon.min_order_amount - subtotal;
      return {
        discount: 0,
        blockedReason: `Pedido minimo ${formatCurrency(appliedCoupon.min_order_amount)} · faltan ${formatCurrency(faltan)}`,
      };
    }

    let discount = 0;
    switch (appliedCoupon.type) {
      case "percentage":
        discount = Math.round(subtotal * (appliedCoupon.discount_value / 100));
        break;
      case "fixed":
        discount = Math.min(appliedCoupon.discount_value, subtotal);
        break;
      case "item_free": {
        // 1 unit free at the modifier-inclusive effective unit price.
        if (appliedCoupon.menu_item_id) {
          const match = items.find((i) => i.menuItemId === appliedCoupon.menu_item_id);
          if (match) discount = effectiveUnitPrice(match);
        } else if (items.length > 0) {
          const cheapest = items.reduce(
            (min, i) => (effectiveUnitPrice(i) < effectiveUnitPrice(min) ? i : min),
            items[0],
          );
          discount = effectiveUnitPrice(cheapest);
        }
        break;
      }
      case "item_discount": {
        // Percentage off a specific item's modifier-inclusive line total.
        if (appliedCoupon.menu_item_id) {
          const match = items.find((i) => i.menuItemId === appliedCoupon.menu_item_id);
          if (match) discount = Math.round(effectiveLineTotal(match) * (appliedCoupon.discount_value / 100));
        }
        break;
      }
      case "buy_x_get_y": {
        // Server calculates exact discount — show approximate as "promo applied"
        discount = 0;
        break;
      }
      default:
        discount = 0;
    }

    // Apply max discount cap, then clamp to subtotal (matches server order).
    if (appliedCoupon.max_discount_amount != null && discount > appliedCoupon.max_discount_amount) {
      discount = appliedCoupon.max_discount_amount;
    }
    return { discount: Math.min(discount, subtotal), blockedReason: null };
  }

  const { discount: couponDiscount, blockedReason: couponBlockedReason } = computeCouponDiscount();

  function getRedemptionDiscount(): number {
    if (!appliedRedemption) return 0;
    const remaining = subtotal - couponDiscount;
    if (remaining <= 0) return 0;
    if (appliedRedemption.discount_type === "percentage") {
      return Math.round(remaining * (appliedRedemption.discount_value / 100));
    }
    return Math.min(appliedRedemption.discount_value, remaining);
  }

  const redemptionDiscount = getRedemptionDiscount();
  const totalDiscount = couponDiscount + redemptionDiscount;
  // IGV is calculated on (subtotal - discount) to match backend logic
  const taxableBase = subtotal - totalDiscount;
  const adjustedTax = totalDiscount > 0 ? Math.round((taxableBase * taxRate) / 10000) : tax;
  const adjustedTotal = totalDiscount > 0 ? taxableBase + adjustedTax : total;

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
          notes: notes[item.lineId] || undefined,
          modifiers: item.modifiers.map((m) => ({
            modifierId: m.modifierId,
          })),
        })),
        // Only send the coupon when it actually qualifies (min order met). If it
        // is blocked, omit it so the order is not rejected wholesale by the
        // server — the user already sees the hint that it is not applied.
        ...(appliedCoupon && !couponBlockedReason ? { couponCode: appliedCoupon.code } : {}),
        ...(appliedRedemption ? { redemptionId: appliedRedemption.id } : {}),
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (!data.success) {
          setError(data.error?.message || "Error al crear orden");
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
        setError("Error inesperado");
        setLoading(false);
      });
  };

  if (items.length === 0) {
    return (
      <div className="p-6 mt-12 text-center">
        <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-muted">
          <ShoppingBag className="h-10 w-10 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-bold mb-2">Carrito vacio</h2>
        <p className="text-muted-foreground mb-6">Agrega productos desde el menu</p>
        <Button
          variant="outline"
          onClick={() => router.push(`/${branchSlug}/${tableCode}/menu`)}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Volver al Menu
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 pb-28">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push(`/${branchSlug}/${tableCode}/menu`)}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-bold">Tu Pedido</h1>
        <span className="text-sm text-muted-foreground">({items.length} items)</span>
      </div>

      {error && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
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
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 rounded-full"
                    onClick={() => updateLineQuantity(item.lineId, item.quantity - 1)}
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                  <span className="w-7 text-center font-bold text-sm">
                    {item.quantity}
                  </span>
                  <Button
                    size="icon"
                    className="h-8 w-8 rounded-full"
                    onClick={() => updateLineQuantity(item.lineId, item.quantity + 1)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold text-sm">
                    {formatCurrency(effectiveLineTotal(item))}
                  </p>
                  <button
                    onClick={() => removeLine(item.lineId)}
                    className="text-destructive hover:text-destructive/80 mt-1 p-1"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="mt-3">
                <Input
                  placeholder="Notas (ej: sin cebolla)"
                  className="text-sm h-9"
                  value={notes[item.lineId] || ""}
                  onChange={(e) =>
                    setNotes({ ...notes, [item.lineId]: e.target.value })
                  }
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
            onClick={() => setCouponOpen(!couponOpen)}
            className="flex items-center gap-2 text-sm font-medium text-foreground w-full"
          >
            <Ticket className="h-4 w-4 text-primary" />
            Tengo un cupon
            {appliedCoupon && !couponBlockedReason && (
              <span className="text-[10px] font-medium text-green-600 dark:text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded">
                Aplicado
              </span>
            )}
            {appliedCoupon && couponBlockedReason && (
              <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                No aplicable aun
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
                      className="w-full flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 p-3 hover:bg-primary/10 transition-colors text-left"
                    >
                      <div>
                        <p className="text-sm font-medium">{coupon.name}</p>
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
                  <button onClick={() => setAppliedCoupon(null)} className="p-1">
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
                        {appliedCoupon.type === "buy_x_get_y"
                          ? " - Promo aplicada en caja"
                          : ` - ${formatCurrency(couponDiscount)} descuento`}
                      </p>
                    </div>
                  </div>
                  <button onClick={() => setAppliedCoupon(null)} className="p-1">
                    <X className="h-4 w-4 text-green-600 dark:text-green-400" />
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Ingresa tu codigo"
                      value={couponCode}
                      onChange={(e) => { setCouponCode(e.target.value.toUpperCase()); setCouponError(null); }}
                      className="text-sm h-9 font-mono"
                    />
                    <Button
                      size="sm"
                      onClick={handleValidateCoupon}
                      disabled={couponLoading || !couponCode.trim()}
                      className="h-9 px-4"
                    >
                      {couponLoading ? "..." : "Aplicar"}
                    </Button>
                  </div>
                  {couponError && (
                    <p className="text-xs text-destructive">{couponError}</p>
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
              Recompensas Canjeadas
              {appliedRedemption && (
                <span className="text-[10px] font-medium text-green-600 dark:text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded">
                  Aplicada
                </span>
              )}
            </div>

            {appliedRedemption ? (
              <div className="flex items-center justify-between rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-3">
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                  <div>
                    <p className="text-sm font-medium text-green-800 dark:text-green-300">{appliedRedemption.reward_name}</p>
                    <p className="text-xs text-green-600 dark:text-green-400">
                      {appliedRedemption.discount_type === "percentage"
                        ? `${appliedRedemption.discount_value}% de descuento`
                        : `${formatCurrency(appliedRedemption.discount_value)} de descuento`}
                      {redemptionDiscount > 0 && ` · -${formatCurrency(redemptionDiscount)}`}
                    </p>
                  </div>
                </div>
                <button onClick={() => setAppliedRedemption(null)} className="p-1">
                  <X className="h-4 w-4 text-green-600 dark:text-green-400" />
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {pendingRedemptions.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setAppliedRedemption(r)}
                    className="w-full flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 p-3 hover:bg-primary/10 transition-colors text-left"
                  >
                    <div>
                      <p className="text-sm font-medium">{r.reward_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.discount_type === "percentage"
                          ? `${r.discount_value}% de descuento`
                          : `${formatCurrency(r.discount_value)} de descuento`}
                      </p>
                    </div>
                    <span className="text-xs font-bold text-primary">Aplicar</span>
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
              <span className="text-green-600 dark:text-green-400">Cupon ({appliedCoupon?.code})</span>
              <span className="font-medium text-green-600 dark:text-green-400">-{formatCurrency(couponDiscount)}</span>
            </div>
          )}
          {appliedCoupon && !couponBlockedReason && appliedCoupon.type === "buy_x_get_y" && (
            <div className="flex justify-between text-sm">
              <span className="text-green-600 dark:text-green-400">Cupon ({appliedCoupon.code})</span>
              <span className="font-medium text-green-600 dark:text-green-400">Promo en caja</span>
            </div>
          )}
          {redemptionDiscount > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-green-600 dark:text-green-400">Recompensa</span>
              <span className="font-medium text-green-600 dark:text-green-400">-{formatCurrency(redemptionDiscount)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">IGV ({taxRate / 100}%)</span>
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
