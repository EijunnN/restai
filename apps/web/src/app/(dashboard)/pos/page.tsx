"use client";

import { useState, useCallback } from "react";
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
  const [orderType, setOrderType] = useState<"dine_in" | "takeout">("dine_in");
  const [successDialog, setSuccessDialog] = useState(false);
  const [lastOrderNumber, setLastOrderNumber] = useState("");

  // Modifier dialog state
  const [modDialogItem, setModDialogItem] = useState<any>(null);
  const [modDialogOpen, setModDialogOpen] = useState(false);

  const { data: categories } = useCategories();
  const { data: menuItems, isLoading: itemsLoading } = useMenuItems(selectedCategory || undefined);
  const createOrder = useCreateOrder();

  const allItems: any[] = menuItems ?? [];

  const handleItemClick = useCallback((item: any) => {
    setModDialogItem(item);
    setModDialogOpen(true);
  }, []);

  const handleAddFromDialog = useCallback(
    (item: any, qty: number, mods: CartModifier[], notes: string) => {
      if (mods.length === 0) {
        const existing = cart.find(
          (c) => c.menuItemId === item.id && c.modifiers.length === 0
        );
        if (existing) {
          setCart((prev) =>
            prev.map((c) =>
              c.lineId === existing.lineId ? { ...c, quantity: c.quantity + qty } : c
            )
          );
          return;
        }
      }

      setCart((prev) => [
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
      ]);
    },
    [cart]
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
      const result = await createOrder.mutateAsync({
        type: orderType,
        customerName: customerName || "Cliente POS",
        items: cart.map((item) => ({
          menuItemId: item.menuItemId,
          quantity: item.quantity,
          notes: item.notes || undefined,
          modifiers: item.modifiers.map((m) => ({ modifierId: m.modifierId })),
        })),
        notes: orderNotes || undefined,
      });

      setLastOrderNumber(result.order_number || result.orderNumber || "");
      setCart([]);
      setCustomerName("");
      setOrderNotes("");
      setSuccessDialog(true);
      toast.success("Orden creada exitosamente");
    } catch (err: any) {
      toast.error(err.message || "Error al crear orden");
    }
  };

  return (
    <div className="flex gap-4 h-[calc(100vh-8rem)]">
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

      <CartSidebar
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
      />

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
