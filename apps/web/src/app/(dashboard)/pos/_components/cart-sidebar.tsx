"use client";

import { Input } from "@restai/ui/components/input";
import { Button } from "@restai/ui/components/button";
import { Badge } from "@restai/ui/components/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@restai/ui/components/select";
import {
  ShoppingCart,
  User,
  Plus,
  Minus,
  Trash2,
  Check,
  Loader2,
  UtensilsCrossed,
  Phone,
  MapPin,
  Truck,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { useStaffList } from "@/hooks/use-staff";
import type { PosCartItem } from "../page";

// ---------------------------------------------------------------------------
// CartSidebar
// ---------------------------------------------------------------------------

export function CartSidebar({
  className,
  cart,
  orderType,
  customerName,
  orderNotes,
  isPending,
  onOrderTypeChange,
  onCustomerNameChange,
  onOrderNotesChange,
  onUpdateQty,
  onRemove,
  onClearCart,
  onCreateOrder,
  deliveryPhone,
  onDeliveryPhoneChange,
  deliveryAddress,
  onDeliveryAddressChange,
  deliveryFee,
  onDeliveryFeeChange,
  deliveryDriverId,
  onDeliveryDriverIdChange,
  paymentMethod,
  onPaymentMethodChange,
  isPaid,
  onIsPaidChange,
}: {
  className?: string;
  cart: PosCartItem[];
  orderType: "dine_in" | "takeout" | "delivery";
  customerName: string;
  orderNotes: string;
  isPending: boolean;
  onOrderTypeChange: (type: "dine_in" | "takeout" | "delivery") => void;
  onCustomerNameChange: (name: string) => void;
  onOrderNotesChange: (notes: string) => void;
  onUpdateQty: (lineId: string, qty: number) => void;
  onRemove: (lineId: string) => void;
  onClearCart: () => void;
  onCreateOrder: () => void;
  deliveryPhone: string;
  onDeliveryPhoneChange: (v: string) => void;
  deliveryAddress: string;
  onDeliveryAddressChange: (v: string) => void;
  deliveryFee: string;
  onDeliveryFeeChange: (v: string) => void;
  deliveryDriverId: string;
  onDeliveryDriverIdChange: (v: string) => void;
  paymentMethod: string;
  onPaymentMethodChange: (v: string) => void;
  isPaid: boolean;
  onIsPaidChange: (v: boolean) => void;
}) {
  const { data: staffData } = useStaffList();
  const staffList: any[] = staffData ?? [];

  const subtotal = cart.reduce((sum, item) => {
    const modTotal = item.modifiers.reduce((ms, m) => ms + m.price, 0);
    return sum + (item.unitPrice + modTotal) * item.quantity;
  }, 0);
  const tax = Math.round((subtotal * 1800) / 10000); // 18% IGV
  const deliveryFeeCents = orderType === "delivery" && deliveryFee ? Math.round(parseFloat(deliveryFee) * 100) : 0;
  const total = subtotal + tax + deliveryFeeCents;
  const totalQty = cart.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold flex items-center gap-2">
          <ShoppingCart className="h-5 w-5" />
          Orden
          {totalQty > 0 && (
            <Badge variant="secondary" className="text-xs">
              {totalQty}
            </Badge>
          )}
        </h2>
        {cart.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={onClearCart}
          >
            Limpiar
          </Button>
        )}
      </div>

      {/* Order type */}
      <div className="mb-3 grid grid-cols-3 gap-1.5">
        <Button
          variant={orderType === "dine_in" ? "default" : "outline"}
          size="sm"
          className="h-11"
          onClick={() => onOrderTypeChange("dine_in")}
        >
          Aqui
        </Button>
        <Button
          variant={orderType === "takeout" ? "default" : "outline"}
          size="sm"
          className="h-11"
          onClick={() => onOrderTypeChange("takeout")}
        >
          Llevar
        </Button>
        <Button
          variant={orderType === "delivery" ? "default" : "outline"}
          size="sm"
          className="h-11"
          onClick={() => onOrderTypeChange("delivery")}
        >
          <Truck className="h-3.5 w-3.5 mr-1" />
          Delivery
        </Button>
      </div>

      {/* Customer */}
      <div className="mb-3">
        <div className="relative">
          <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Nombre del cliente (opcional)"
            value={customerName}
            onChange={(e) => onCustomerNameChange(e.target.value)}
            className="pl-9 text-sm"
          />
        </div>
      </div>

      {/* Delivery fields */}
      {orderType === "delivery" && (
        <div className="space-y-2 mb-3 p-2.5 rounded-lg border border-dashed">
          <div className="relative">
            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Telefono del cliente"
              value={deliveryPhone}
              onChange={(e) => onDeliveryPhoneChange(e.target.value)}
              className="pl-9 text-sm"
            />
          </div>
          <textarea
            placeholder="Direccion de entrega (opcional - ubicacion por WSP)"
            value={deliveryAddress}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onDeliveryAddressChange(e.target.value)}
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[60px]"
            rows={2}
          />
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">S/</span>
            <Input
              type="number"
              placeholder="Tarifa delivery"
              value={deliveryFee}
              onChange={(e) => onDeliveryFeeChange(e.target.value)}
              className="pl-9 text-sm"
              min="0"
              step="0.5"
            />
          </div>
          <Select value={deliveryDriverId || undefined} onValueChange={onDeliveryDriverIdChange}>
            <SelectTrigger className="text-sm">
              <SelectValue placeholder="Repartidor (opcional)" />
            </SelectTrigger>
            <SelectContent>
              {staffList.map((s: any) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name} ({s.role})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={paymentMethod || undefined} onValueChange={onPaymentMethodChange}>
            <SelectTrigger className="text-sm">
              <SelectValue placeholder="Metodo de pago" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cash">Efectivo</SelectItem>
              <SelectItem value="yape">Yape</SelectItem>
              <SelectItem value="plin">Plin</SelectItem>
              <SelectItem value="card">Tarjeta</SelectItem>
              <SelectItem value="transfer">Transferencia</SelectItem>
            </SelectContent>
          </Select>
          {paymentMethod && (
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm">Ya pago</span>
              <input
                type="checkbox"
                checked={isPaid}
                onChange={(e) => onIsPaidChange(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
            </label>
          )}
        </div>
      )}

      {/* Cart items */}
      <div className="mb-3 flex-1 space-y-1.5 overflow-y-auto pr-1">
        {cart.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <ShoppingCart className="h-10 w-10 mb-2 opacity-20" />
            <p className="text-sm">Toca un producto para agregar</p>
          </div>
        ) : (
          cart.map((item) => {
            const modTotal = item.modifiers.reduce((s, m) => s + m.price, 0);
            const lineTotal = (item.unitPrice + modTotal) * item.quantity;
            return (
              <div
                key={item.lineId}
                className="rounded-lg border p-2.5 space-y-1.5"
              >
                <div className="flex items-start gap-2">
                  {/* Mini thumbnail */}
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt=""
                      className="h-9 w-9 rounded object-cover flex-shrink-0 mt-0.5"
                    />
                  ) : (
                    <div className="h-9 w-9 rounded bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                      <UtensilsCrossed className="h-3.5 w-3.5 text-muted-foreground/40" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatCurrency(item.unitPrice + modTotal)} c/u
                    </p>
                  </div>
                  <button
                    onClick={() => onRemove(item.lineId)}
                    className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Modifiers */}
                {item.modifiers.length > 0 && (
                  <div className="pl-11 flex flex-wrap gap-1">
                    {item.modifiers.map((mod) => (
                      <span
                        key={mod.modifierId}
                        className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                      >
                        {mod.name}
                        {mod.price > 0 && ` +${formatCurrency(mod.price)}`}
                      </span>
                    ))}
                  </div>
                )}

                {/* Notes */}
                {item.notes && (
                  <p className="pl-11 text-[11px] text-muted-foreground italic truncate">
                    {item.notes}
                  </p>
                )}

                {/* Qty + line total */}
                <div className="flex items-center justify-between pl-11">
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => onUpdateQty(item.lineId, item.quantity - 1)}
                    >
                      <Minus className="h-2.5 w-2.5" />
                    </Button>
                    <span className="w-5 text-center text-xs font-bold">{item.quantity}</span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => onUpdateQty(item.lineId, item.quantity + 1)}
                    >
                      <Plus className="h-2.5 w-2.5" />
                    </Button>
                  </div>
                  <p className="text-sm font-bold">{formatCurrency(lineTotal)}</p>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Notes */}
      {cart.length > 0 && (
        <div className="mb-3">
          <Input
            placeholder="Notas de la orden..."
            value={orderNotes}
            onChange={(e) => onOrderNotesChange(e.target.value)}
            className="text-sm"
          />
        </div>
      )}

      {/* Totals */}
      {cart.length > 0 && (
        <div className="mb-3 space-y-1 border-t pt-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{formatCurrency(subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">IGV (18%)</span>
            <span>{formatCurrency(tax)}</span>
          </div>
          {deliveryFeeCents > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Delivery</span>
              <span>{formatCurrency(deliveryFeeCents)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-lg pt-1.5 border-t">
            <span>Total</span>
            <span className="text-primary">{formatCurrency(total)}</span>
          </div>
        </div>
      )}

      {/* Create order */}
      <Button
        className="h-12 w-full rounded-2xl text-base font-semibold"
        disabled={cart.length === 0 || isPending}
        onClick={onCreateOrder}
      >
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Creando...
          </>
        ) : (
          <>
            <Check className="h-5 w-5 mr-2" />
            Crear Orden {cart.length > 0 && `· ${formatCurrency(total)}`}
          </>
        )}
      </Button>
    </div>
  );
}
