"use client";

import { use, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@restai/ui/components/button";
import { Card, CardContent } from "@restai/ui/components/card";
import { Input } from "@restai/ui/components/input";
import { useCartStore } from "@/stores/cart-store";
import { useCustomerStore } from "@/stores/customer-store";
import { formatCurrency } from "@/lib/utils";
import { Minus, Plus, Trash2, ArrowLeft, ShoppingBag, Ticket, Check, X, ChevronDown } from "lucide-react";

const TAX_RATE = 1800; // 18% IGV

export default function CartPage({
  params,
}: {
  params: Promise<{ branchSlug: string; tableCode: string }>;
}) {
  const { branchSlug, tableCode } = use(params);
  const router = useRouter();
  const {
    items,
    updateQuantity,
    removeItem,
    clearCart,
    getSubtotal,
    getTax,
    getTotal,
  } = useCartStore();
  const customerToken = useCustomerStore((s) => s.token);
  const setOrderId = useCustomerStore((s) => s.setOrderId);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [couponOpen, setCouponOpen] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; name: string; type: string; discount_value: number } | null>(null);
  const [availableCoupons, setAvailableCoupons] = useState<any[]>([]);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    async function fetchCoupons() {
      try {
        const res = await fetch("http://localhost:3001/api/customer/my-coupons", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (data.success && data.data?.length > 0) {
          setAvailableCoupons(data.data);
        }
      } catch {}
    }
    fetchCoupons();
  }, []);

  const subtotal = getSubtotal();
  const tax = getTax(TAX_RATE);
  const total = getTotal(TAX_RATE);

  const getToken = () => {
    if (customerToken) return customerToken;
    if (typeof window !== "undefined") {
      return sessionStorage.getItem("customer_token");
    }
    return null;
  };

  const handleValidateCoupon = async () => {
    if (!couponCode.trim()) return;
    try {
      setCouponLoading(true);
      setCouponError(null);
      const token = getToken();
      const res = await fetch("http://localhost:3001/api/customer/validate-coupon", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ code: couponCode.toUpperCase() }),
      });
      const data = await res.json();
      if (!data.success) {
        setCouponError(data.error?.message || "Cupon invalido");
        return;
      }
      setAppliedCoupon({
        code: data.data.code,
        name: data.data.name,
        type: data.data.type,
        discount_value: data.data.discount_value || 0,
      });
      setCouponCode("");
    } catch {
      setCouponError("Error al validar cupon");
    } finally {
      setCouponLoading(false);
    }
  };

  function getCouponDiscount(): number {
    if (!appliedCoupon) return 0;
    if (appliedCoupon.type === "percentage") {
      const discount = Math.round(subtotal * (appliedCoupon.discount_value / 100));
      return discount;
    }
    if (appliedCoupon.type === "fixed") {
      return Math.min(appliedCoupon.discount_value, subtotal);
    }
    return 0;
  }

  const couponDiscount = getCouponDiscount();
  const adjustedTotal = total - couponDiscount;

  const handleConfirmOrder = async () => {
    try {
      setLoading(true);
      setError(null);
      const token = getToken();

      const res = await fetch("http://localhost:3001/api/customer/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          type: "dine_in",
          items: items.map((item) => ({
            menuItemId: item.menuItemId,
            quantity: item.quantity,
            notes: notes[item.menuItemId] || undefined,
            modifiers: item.modifiers.map((m) => ({
              modifierId: m.modifierId,
            })),
          })),
          ...(appliedCoupon ? { couponCode: appliedCoupon.code } : {}),
        }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error?.message || "Error al crear orden");
      }

      if (data.data?.id) {
        setOrderId(data.data.id);
      }

      clearCart();
      router.push(`/${branchSlug}/${tableCode}/status`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado");
    } finally {
      setLoading(false);
    }
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

      {/* Cart items */}
      <div className="space-y-3">
        {items.map((item) => (
          <Card key={item.menuItemId}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium">{item.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {formatCurrency(item.unitPrice)} c/u
                  </p>
                  {item.modifiers.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {item.modifiers.map((m) => m.name).join(", ")}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 rounded-full"
                    onClick={() => updateQuantity(item.menuItemId, item.quantity - 1)}
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                  <span className="w-7 text-center font-bold text-sm">
                    {item.quantity}
                  </span>
                  <Button
                    size="icon"
                    className="h-8 w-8 rounded-full"
                    onClick={() => updateQuantity(item.menuItemId, item.quantity + 1)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold text-sm">
                    {formatCurrency(item.unitPrice * item.quantity)}
                  </p>
                  <button
                    onClick={() => removeItem(item.menuItemId)}
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
                  value={notes[item.menuItemId] || ""}
                  onChange={(e) =>
                    setNotes({ ...notes, [item.menuItemId]: e.target.value })
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
            {appliedCoupon && (
              <span className="text-[10px] font-medium text-green-600 dark:text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded">
                Aplicado
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
                        });
                      }}
                      className="w-full flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 p-3 hover:bg-primary/10 transition-colors text-left"
                    >
                      <div>
                        <p className="text-sm font-medium">{coupon.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{coupon.code}</p>
                      </div>
                      <span className="text-sm font-bold text-primary">
                        {coupon.type === "percentage"
                          ? `${coupon.discount_value}%`
                          : formatCurrency(coupon.discount_value || 0)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {appliedCoupon ? (
                <div className="flex items-center justify-between rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-3">
                  <div className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                    <div>
                      <p className="text-sm font-medium text-green-800 dark:text-green-300">{appliedCoupon.code}</p>
                      <p className="text-xs text-green-600 dark:text-green-400">{appliedCoupon.name} - {formatCurrency(couponDiscount)} descuento</p>
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

      {/* Summary */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="font-medium">{formatCurrency(subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">IGV (18%)</span>
            <span className="font-medium">{formatCurrency(tax)}</span>
          </div>
          {couponDiscount > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-green-600 dark:text-green-400">Cupon ({appliedCoupon?.code})</span>
              <span className="font-medium text-green-600 dark:text-green-400">-{formatCurrency(couponDiscount)}</span>
            </div>
          )}
          <div className="border-t border-border pt-3">
            <div className="flex justify-between font-bold text-lg">
              <span>Total</span>
              <span className="text-primary">{formatCurrency(couponDiscount > 0 ? adjustedTotal : total)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Fixed bottom CTA */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/95 backdrop-blur border-t border-border">
        <Button
          className="w-full max-w-lg mx-auto h-14 text-base font-semibold"
          onClick={handleConfirmOrder}
          disabled={loading}
        >
          {loading ? "Enviando pedido..." : `Confirmar Pedido · ${formatCurrency(couponDiscount > 0 ? adjustedTotal : total)}`}
        </Button>
      </div>
    </div>
  );
}
