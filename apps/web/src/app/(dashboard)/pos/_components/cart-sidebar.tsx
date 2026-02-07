"use client";

import { Input } from "@restai/ui/components/input";
import { Button } from "@restai/ui/components/button";
import { Badge } from "@restai/ui/components/badge";
import {
  ShoppingCart,
  User,
  Plus,
  Minus,
  Trash2,
  Check,
  Loader2,
  UtensilsCrossed,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { PosCartItem } from "../page";

// ---------------------------------------------------------------------------
// CartSidebar
// ---------------------------------------------------------------------------

export function CartSidebar({
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
}: {
  cart: PosCartItem[];
  orderType: "dine_in" | "takeout";
  customerName: string;
  orderNotes: string;
  isPending: boolean;
  onOrderTypeChange: (type: "dine_in" | "takeout") => void;
  onCustomerNameChange: (name: string) => void;
  onOrderNotesChange: (notes: string) => void;
  onUpdateQty: (lineId: string, qty: number) => void;
  onRemove: (lineId: string) => void;
  onClearCart: () => void;
  onCreateOrder: () => void;
}) {
  const subtotal = cart.reduce((sum, item) => {
    const modTotal = item.modifiers.reduce((ms, m) => ms + m.price, 0);
    return sum + (item.unitPrice + modTotal) * item.quantity;
  }, 0);
  const tax = Math.round((subtotal * 1800) / 10000); // 18% IGV
  const total = subtotal + tax;
  const totalQty = cart.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="w-80 lg:w-96 flex flex-col border-l pl-4">
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
      <div className="flex gap-2 mb-3">
        <Button
          variant={orderType === "dine_in" ? "default" : "outline"}
          size="sm"
          className="flex-1"
          onClick={() => onOrderTypeChange("dine_in")}
        >
          Para aqui
        </Button>
        <Button
          variant={orderType === "takeout" ? "default" : "outline"}
          size="sm"
          className="flex-1"
          onClick={() => onOrderTypeChange("takeout")}
        >
          Para llevar
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

      {/* Cart items */}
      <div className="flex-1 overflow-y-auto space-y-1.5 mb-3">
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
        <div className="border-t pt-3 space-y-1 mb-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{formatCurrency(subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">IGV (18%)</span>
            <span>{formatCurrency(tax)}</span>
          </div>
          <div className="flex justify-between font-bold text-lg pt-1.5 border-t">
            <span>Total</span>
            <span className="text-primary">{formatCurrency(total)}</span>
          </div>
        </div>
      )}

      {/* Create order */}
      <Button
        className="w-full h-12 text-base font-semibold"
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
