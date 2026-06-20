"use client";

import { useState, useCallback } from "react";
import { apiFetch } from "@/lib/fetcher";
import { Button } from "@restai/ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@restai/ui/components/sheet";
import { ShoppingCart } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useCategories, useMenuItems } from "@/hooks/use-menu";
import { useCreateOrder } from "@/hooks/use-orders";
import { toast } from "sonner";
import { ProductGrid } from "./_components/product-grid";
import { CartSidebar } from "./_components/cart-sidebar";
import { ModifierDialog, type CartModifier } from "./_components/modifier-dialog";
import { SuccessDialog } from "./_components/success-dialog";

// ---------------------------------------------------------------------------
// Types (exported for child components)
// ---------------------------------------------------------------------------

export interface PosCartItem {
  lineId: string;
  menuItemId: string;
  name: string;
  imageUrl: string | null;
  unitPrice: number;
  quantity: number;
  notes?: string;
  modifiers: CartModifier[];
}

export interface PosMenuItem {
  id: string;
  name: string;
  image_url: string | null;
  price: number;
  is_available: boolean;
}

interface PosModifierGroupSummary {
  id: string;
}

let lineCounter = 0;
function nextLineId() {
  return `line-${++lineCounter}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// POS Page
// ---------------------------------------------------------------------------

export default function PosPage() {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<PosCartItem[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [orderType, setOrderType] = useState<"dine_in" | "takeout" | "delivery">("dine_in");
  const [successDialog, setSuccessDialog] = useState(false);
  const [lastOrderNumber, setLastOrderNumber] = useState("");
  // Delivery state
  const [deliveryPhone, setDeliveryPhone] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryFee, setDeliveryFee] = useState("");
  const [deliveryDriverId, setDeliveryDriverId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [isPaid, setIsPaid] = useState(false);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);

  // Modifier dialog state
  const [modDialogItem, setModDialogItem] = useState<PosMenuItem | null>(null);
  const [modDialogOpen, setModDialogOpen] = useState(false);

  const { data: categories } = useCategories();
  const { data: menuItems, isLoading: itemsLoading } = useMenuItems(selectedCategory || undefined);
  const createOrder = useCreateOrder();

  const allItems: PosMenuItem[] = menuItems ?? [];
  const subtotal = cart.reduce((sum, item) => {
    const modifiersTotal = item.modifiers.reduce((modsSum, modifier) => modsSum + modifier.price, 0);
    return sum + (item.unitPrice + modifiersTotal) * item.quantity;
  }, 0);
  const tax = Math.round((subtotal * 1800) / 10000);
  const deliveryFeeCents = orderType === "delivery" && deliveryFee ? Math.round(parseFloat(deliveryFee) * 100) : 0;
  const total = subtotal + tax + deliveryFeeCents;
  const totalQty = cart.reduce((sum, item) => sum + item.quantity, 0);

  const addItemToCart = useCallback(
    (item: PosMenuItem, qty: number, mods: CartModifier[], notes: string) => {
      setCart((prev) => {
        if (mods.length === 0) {
          const existing = prev.find(
            (cartItem) => cartItem.menuItemId === item.id && cartItem.modifiers.length === 0
          );

          if (existing) {
            return prev.map((cartItem) =>
              cartItem.lineId === existing.lineId
                ? { ...cartItem, quantity: cartItem.quantity + qty }
                : cartItem
            );
          }
        }

        return [
          ...prev,
          {
            lineId: nextLineId(),
            menuItemId: item.id,
            name: item.name,
            imageUrl: item.image_url || null,
            unitPrice: item.price,
            quantity: qty,
            notes: notes || undefined,
            modifiers: mods,
          },
        ];
      });
    },
    []
  );

  const handleItemClick = useCallback(
    async (item: PosMenuItem) => {
      try {
        const modifierGroups = await apiFetch<PosModifierGroupSummary[]>(
          `/api/menu/items/${item.id}/modifier-groups`
        );

        if (modifierGroups.length === 0) {
          addItemToCart(item, 1, [], "");
          return;
        }

        setModDialogItem(item);
        setModDialogOpen(true);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo cargar el producto");
      }
    },
    [addItemToCart]
  );

  const handleAddFromDialog = useCallback(
    (item: PosMenuItem, qty: number, mods: CartModifier[], notes: string) => {
      addItemToCart(item, qty, mods, notes);
    },
    [addItemToCart]
  );

  const updateCartQty = (lineId: string, qty: number) => {
    if (qty <= 0) {
      setCart((prev) => prev.filter((c) => c.lineId !== lineId));
    } else {
      setCart((prev) => prev.map((c) => (c.lineId === lineId ? { ...c, quantity: qty } : c)));
    }
  };

  const removeFromCart = (lineId: string) => {
    setCart((prev) => prev.filter((c) => c.lineId !== lineId));
  };

  const handleCreateOrder = async () => {
    if (cart.length === 0) return;
    try {
      const orderData: any = {
        type: orderType,
        customerName: customerName || "Cliente POS",
        items: cart.map((item) => ({
          menuItemId: item.menuItemId,
          quantity: item.quantity,
          notes: item.notes || undefined,
          modifiers: item.modifiers.map((m) => ({ modifierId: m.modifierId })),
        })),
        notes: orderNotes || undefined,
      };

      if (orderType === "delivery") {
        if (deliveryPhone) orderData.deliveryPhone = deliveryPhone;
        if (deliveryAddress) orderData.deliveryAddress = deliveryAddress;
        if (deliveryFee) orderData.deliveryFee = Math.round(parseFloat(deliveryFee) * 100);
        if (deliveryDriverId) orderData.deliveryDriverId = deliveryDriverId;
        if (paymentMethod) {
          orderData.paymentMethod = paymentMethod;
          orderData.isPaid = isPaid;
        }
      }

      const result = await createOrder.mutateAsync(orderData);

      setLastOrderNumber(result.order_number || result.orderNumber || "");
      setCart([]);
      setCustomerName("");
      setOrderNotes("");
      setDeliveryPhone("");
      setDeliveryAddress("");
      setDeliveryFee("");
      setDeliveryDriverId("");
      setPaymentMethod("");
      setIsPaid(false);
      setMobileCartOpen(false);
      setSuccessDialog(true);
      toast.success("Orden creada exitosamente");
    } catch (err: any) {
      toast.error(err.message || "Error al crear orden");
    }
  };

  return (
    <div className="relative flex h-[calc(100vh-8rem)] min-h-0 flex-col gap-4 lg:flex-row">
      <ProductGrid
        categories={categories ?? []}
        items={allItems}
        isLoading={itemsLoading}
        search={search}
        onSearchChange={setSearch}
        selectedCategory={selectedCategory}
        onCategoryChange={setSelectedCategory}
        cart={cart}
        onItemClick={handleItemClick}
      />

      <div className="hidden lg:flex lg:w-[24rem] xl:w-[28rem]">
        <CartSidebar
          className="h-full rounded-[28px] border bg-card/80 p-4 shadow-sm"
          cart={cart}
          orderType={orderType}
          customerName={customerName}
          orderNotes={orderNotes}
          isPending={createOrder.isPending}
          onOrderTypeChange={setOrderType}
          onCustomerNameChange={setCustomerName}
          onOrderNotesChange={setOrderNotes}
          onUpdateQty={updateCartQty}
          onRemove={removeFromCart}
          onClearCart={() => setCart([])}
          onCreateOrder={handleCreateOrder}
          deliveryPhone={deliveryPhone}
          onDeliveryPhoneChange={setDeliveryPhone}
          deliveryAddress={deliveryAddress}
          onDeliveryAddressChange={setDeliveryAddress}
          deliveryFee={deliveryFee}
          onDeliveryFeeChange={setDeliveryFee}
          deliveryDriverId={deliveryDriverId}
          onDeliveryDriverIdChange={setDeliveryDriverId}
          paymentMethod={paymentMethod}
          onPaymentMethodChange={setPaymentMethod}
          isPaid={isPaid}
          onIsPaidChange={setIsPaid}
        />
      </div>

      <div className="fixed inset-x-0 bottom-16 z-30 p-3 lg:hidden">
        <Button
          className="h-14 w-full justify-between rounded-2xl border border-foreground/10 bg-foreground px-4 text-base font-semibold text-background shadow-lg hover:bg-foreground/90"
          onClick={() => setMobileCartOpen(true)}
        >
          <span className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            {totalQty > 0 ? `${totalQty} productos` : "Abrir pedido"}
          </span>
          <span>{totalQty > 0 ? formatCurrency(total) : "Sin items"}</span>
        </Button>
      </div>

      <Sheet open={mobileCartOpen} onOpenChange={setMobileCartOpen}>
        <SheetContent
          side="bottom"
          className="flex h-[88vh] min-h-0 flex-col overflow-hidden rounded-t-[28px] border-t bg-background px-4 pb-4 pt-6"
        >
          <SheetHeader className="mb-4">
            <SheetTitle>Pedido actual</SheetTitle>
            <SheetDescription>
              Revisa el carrito, datos del cliente y confirma la orden desde aqui.
            </SheetDescription>
          </SheetHeader>

          <CartSidebar
            className="min-h-0 flex-1"
            cart={cart}
            orderType={orderType}
            customerName={customerName}
            orderNotes={orderNotes}
            isPending={createOrder.isPending}
            onOrderTypeChange={setOrderType}
            onCustomerNameChange={setCustomerName}
            onOrderNotesChange={setOrderNotes}
            onUpdateQty={updateCartQty}
            onRemove={removeFromCart}
            onClearCart={() => setCart([])}
            onCreateOrder={handleCreateOrder}
            deliveryPhone={deliveryPhone}
            onDeliveryPhoneChange={setDeliveryPhone}
            deliveryAddress={deliveryAddress}
            onDeliveryAddressChange={setDeliveryAddress}
            deliveryFee={deliveryFee}
            onDeliveryFeeChange={setDeliveryFee}
            deliveryDriverId={deliveryDriverId}
            onDeliveryDriverIdChange={setDeliveryDriverId}
            paymentMethod={paymentMethod}
            onPaymentMethodChange={setPaymentMethod}
            isPaid={isPaid}
            onIsPaidChange={setIsPaid}
          />
        </SheetContent>
      </Sheet>

      <SuccessDialog
        open={successDialog}
        onOpenChange={setSuccessDialog}
        orderNumber={lastOrderNumber}
      />

      <ModifierDialog
        item={modDialogItem}
        open={modDialogOpen}
        onClose={() => setModDialogOpen(false)}
        onAdd={handleAddFromDialog}
      />
    </div>
  );
}
