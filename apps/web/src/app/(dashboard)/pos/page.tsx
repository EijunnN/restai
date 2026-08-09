"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { useBranches, type OrgSettings } from "@/hooks/use-settings";
import { useAuthStore } from "@/stores/auth-store";
import { hasPermission } from "@/lib/permissions";
import { usePrintKitchenTicket } from "@/components/print-ticket";
import { toast } from "sonner";
import { ProductGrid } from "./_components/product-grid";
import { CartSidebar } from "./_components/cart-sidebar";
import { ModifierDialog, type CartModifier } from "./_components/modifier-dialog";
import { SuccessDialog } from "./_components/success-dialog";
import { ChargeDialog } from "./_components/charge-dialog";

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
  /** Precio en CÉNTIMOS, como lo guarda la carta. */
  price: number;
  is_available: boolean;
  /**
   * Posición del plato DENTRO de su categoría. La API ya ordena por ella, pero
   * la rejilla del POS mezcla categorías cuando no hay ninguna elegida, así que
   * necesita también la de la categoría para no intercalar postres entre fondos.
   */
  sort_order?: number;
  category_id?: string;
}

/** Cliente identificado en la venta: sin su id, la venta no otorga puntos. */
export interface PosCustomer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  pointsBalance: number;
}

/** Línea tal y como se imprime en la comanda o el recibo. */
export interface PosTicketLine {
  name: string;
  quantity: number;
  unit_price: number;
  total: number;
  notes?: string;
  modifiers?: { name: string }[];
}

/**
 * Foto de la última orden creada.
 *
 * Guarda lo justo para cobrarla e imprimirla sin volver a pedirla al servidor:
 * los importes vienen de la respuesta de creación (son los que cuentan) y las
 * líneas del carrito (son las únicas que conservan los modificadores elegidos).
 */
export interface PosOrderSnapshot {
  id: string;
  orderNumber: string;
  createdAt: string;
  type: "dine_in" | "takeout" | "delivery";
  tableNumber: number | null;
  customerName: string | null;
  /** Nota general del pedido, tal y como se imprime en la comanda. */
  notes?: string;
  items: PosTicketLine[];
  subtotal: number;
  discount: number;
  tax: number;
  deliveryFee: number;
  total: number;
}

interface PosModifierGroupSummary {
  id: string;
}

let lineCounter = 0;
function nextLineId() {
  return `line-${++lineCounter}-${Date.now()}`;
}

/**
 * "12,50" o "12.50" -> 1250 céntimos. `null` si no es un importe válido.
 *
 * El dinero viaja SIEMPRE en céntimos enteros. Antes la tarifa de delivery se
 * leía con `parseFloat` a pelo: un campo a medio escribir ("12.") o con un signo
 * daba `NaN`, el total del botón se pintaba como "S/ NaN" y el pedido salía con
 * `deliveryFee: null`, que el servidor rechaza con un 400 de validación sin que
 * el cajero entendiera por qué.
 */
export function parseSolesToCents(input: string): number | null {
  const cleaned = input.trim().replace(/\s/g, "").replace(",", ".");
  if (!cleaned) return 0;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const cents = Math.round(parseFloat(cleaned) * 100);
  return Number.isFinite(cents) ? cents : null;
}

/** Los grupos de modificadores de un plato cambian poco durante un servicio. */
const MODIFIER_GROUPS_STALE_TIME = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// POS Page
// ---------------------------------------------------------------------------

export default function PosPage() {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<PosCartItem[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customer, setCustomer] = useState<PosCustomer | null>(null);
  const [tableId, setTableId] = useState<string | null>(null);
  const [orderNotes, setOrderNotes] = useState("");
  const [orderType, setOrderType] = useState<"dine_in" | "takeout" | "delivery">("dine_in");
  const [successDialog, setSuccessDialog] = useState(false);
  const [chargeDialog, setChargeDialog] = useState(false);
  const [lastOrder, setLastOrder] = useState<PosOrderSnapshot | null>(null);
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

  // Productos con la consulta de modificadores en vuelo. Evita que un segundo
  // toque con red lenta añada una unidad duplicada.
  const [pendingItemIds, setPendingItemIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const inFlightItems = useRef<Set<string>>(new Set());
  /** Hay una creación de orden en vuelo: bloquea el segundo toque del botón. */
  const creatingOrderRef = useRef(false);

  const queryClient = useQueryClient();
  const { data: categories } = useCategories();
  const {
    data: menuItems,
    isLoading: itemsLoading,
    isError: itemsError,
    error: itemsErrorObj,
    refetch: refetchItems,
  } = useMenuItems(selectedCategory || undefined);
  const createOrder = useCreateOrder();
  const printKitchenTicket = usePrintKitchenTicket();

  // Tasa de IGV de la sede. Se lee de /api/branches (permiso `branch:read`, que
  // sí tienen cajero y mozo) y NO de /api/settings/branch, que exige
  // `settings:read`: justo los dos roles que viven en el POS no lo tienen, así
  // que ahí la tasa habría vuelto siempre al 18 % cableado.
  const selectedBranchId = useAuthStore((state) => state.selectedBranchId);
  const role = useAuthStore((state) => state.user?.role);
  const { data: branches } = useBranches();

  // Cabecera fiscal del recibo. `GET /api/settings/org` exige `settings:read`, que
  // ni el cajero ni el mozo tienen: pedirlo sin más era un 403 garantizado en cada
  // carga del POS. Se consulta solo cuando el rol puede leerlo y, si no, el recibo
  // cae al nombre de la sede (ver el pendiente sobre exponer el emisor con
  // `branch:read`).
  const canReadOrgSettings = hasPermission(role, "settings:read");
  const { data: org } = useQuery<OrgSettings>({
    queryKey: ["settings", "org"],
    queryFn: () => apiFetch<OrgSettings>("/api/settings/org", { includeBranchHeader: false }),
    enabled: canReadOrgSettings,
  });

  const branch = useMemo(
    () =>
      ((branches ?? []) as Array<{ id: string; name?: string; address?: string | null; tax_rate?: number }>).find(
        (b) => b.id === selectedBranchId,
      ),
    [branches, selectedBranchId],
  );
  const taxRate: number = branch?.tax_rate ?? 1800;

  const allItems: PosMenuItem[] = menuItems ?? [];
  const subtotal = cart.reduce((sum, item) => {
    const modifiersTotal = item.modifiers.reduce((modsSum, modifier) => modsSum + modifier.price, 0);
    return sum + (item.unitPrice + modifiersTotal) * item.quantity;
  }, 0);
  const tax = Math.round((subtotal * taxRate) / 10000);
  // La tarifa de delivery se valida una sola vez y aquí: el carrito pinta el mismo
  // número que se envía, así que el total del botón no puede separarse del real.
  const parsedDeliveryFee = orderType === "delivery" ? parseSolesToCents(deliveryFee) : 0;
  const deliveryFeeInvalid = parsedDeliveryFee === null;
  const deliveryFeeCents = parsedDeliveryFee ?? 0;
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
      // Guarda síncrona: dos toques seguidos entran en el mismo tick de React y
      // el estado todavía no se ha repintado cuando llega el segundo.
      if (inFlightItems.current.has(item.id)) return;
      inFlightItems.current.add(item.id);
      setPendingItemIds((prev) => new Set(prev).add(item.id));

      try {
        // fetchQuery comparte caché con useItemModifierGroups: el diálogo se abre
        // con los grupos ya cargados y el segundo toque no repite la petición.
        const modifierGroups = await queryClient.fetchQuery({
          queryKey: ["menu", "items", item.id, "modifier-groups"],
          queryFn: () =>
            apiFetch<PosModifierGroupSummary[]>(`/api/menu/items/${item.id}/modifier-groups`),
          staleTime: MODIFIER_GROUPS_STALE_TIME,
        });

        if (modifierGroups.length === 0) {
          addItemToCart(item, 1, [], "");
          return;
        }

        setModDialogItem(item);
        setModDialogOpen(true);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo cargar el producto");
      } finally {
        inFlightItems.current.delete(item.id);
        setPendingItemIds((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
      }
    },
    [addItemToCart, queryClient]
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

  const handleOrderTypeChange = (type: "dine_in" | "takeout" | "delivery") => {
    setOrderType(type);
    // La mesa solo aplica al pedido "Aquí": si se cambia de tipo se suelta, para
    // que no quede una mesa elegida invisible en el formulario.
    if (type !== "dine_in") setTableId(null);
  };

  /** Líneas del carrito en el formato que imprimen la comanda y el recibo. */
  const buildTicketLines = (lines: PosCartItem[]): PosTicketLine[] =>
    lines.map((line) => {
      const modsTotal = line.modifiers.reduce((sum, mod) => sum + mod.price, 0);
      const unitPrice = line.unitPrice + modsTotal;
      return {
        name: line.name,
        quantity: line.quantity,
        unit_price: unitPrice,
        total: unitPrice * line.quantity,
        notes: line.notes,
        modifiers: line.modifiers.map((mod) => ({ name: mod.name })),
      };
    });

  const handleCreateOrder = async () => {
    if (cart.length === 0) return;
    // Guarda síncrona contra el doble toque: `isPending` deshabilita el botón en
    // el siguiente repintado, y en una tablet lenta caben dos toques antes. Una
    // orden duplicada en hora punta es el peor fallo posible del POS.
    if (creatingOrderRef.current) return;
    if (orderType === "delivery" && deliveryFeeInvalid) {
      toast.error("La tarifa de delivery debe ser un importe en soles (ej. 8.50)");
      return;
    }
    const effectiveCustomerName = customer?.name || customerName.trim() || "Cliente POS";
    creatingOrderRef.current = true;

    try {
      const orderData: Record<string, unknown> = {
        type: orderType,
        customerName: effectiveCustomerName,
        items: cart.map((item) => ({
          menuItemId: item.menuItemId,
          quantity: item.quantity,
          notes: item.notes || undefined,
          modifiers: item.modifiers.map((m) => ({ modifierId: m.modifierId })),
        })),
        notes: orderNotes || undefined,
      };

      // Mesa: solo en el pedido de salón. El backend cuelga el pedido de la visita
      // abierta de la mesa o abre una nueva.
      if (orderType === "dine_in" && tableId) orderData.tableId = tableId;
      // Cliente: es este id, y no el nombre, lo que hace que la venta sume puntos.
      if (customer) orderData.customerId = customer.id;

      if (orderType === "delivery") {
        if (deliveryPhone) orderData.deliveryPhone = deliveryPhone;
        if (deliveryAddress) orderData.deliveryAddress = deliveryAddress;
        if (deliveryFeeCents > 0) orderData.deliveryFee = deliveryFeeCents;
        if (deliveryDriverId) orderData.deliveryDriverId = deliveryDriverId;
        if (paymentMethod) {
          orderData.paymentMethod = paymentMethod;
          orderData.isPaid = isPaid;
        }
      }

      const result: any = await createOrder.mutateAsync(orderData);

      // El pedido con mesa abre o reutiliza una visita y puede dejar la mesa
      // ocupada: sin invalidar estas cachés, el plano del salón y el selector de
      // mesa siguen enseñando la foto anterior (`useCreateOrder` solo invalida
      // ["orders"]).
      if (orderType === "dine_in" && tableId) {
        void queryClient.invalidateQueries({ queryKey: ["tables"] });
        void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      }

      setLastOrder({
        id: result.id,
        orderNumber: result.order_number ?? "",
        createdAt: result.created_at ?? new Date().toISOString(),
        type: orderType,
        tableNumber: result.table_number ?? null,
        customerName: result.customer_name ?? effectiveCustomerName,
        notes: orderNotes.trim() || undefined,
        items: buildTicketLines(cart),
        subtotal: result.subtotal ?? subtotal,
        discount: result.discount ?? 0,
        tax: result.tax ?? tax,
        deliveryFee: result.delivery_fee ?? deliveryFeeCents,
        total: result.total ?? total,
      });

      setCart([]);
      setCustomerName("");
      setCustomer(null);
      setTableId(null);
      setOrderNotes("");
      setDeliveryPhone("");
      setDeliveryAddress("");
      setDeliveryFee("");
      setDeliveryDriverId("");
      setPaymentMethod("");
      setIsPaid(false);
      setMobileCartOpen(false);
      setSuccessDialog(true);
      toast.success("Orden creada correctamente");
    } catch (err: any) {
      toast.error(err?.message || "No se pudo crear la orden");
    } finally {
      creatingOrderRef.current = false;
    }
  };

  const handlePrintKitchenTicket = () => {
    if (!lastOrder) return;
    printKitchenTicket({
      orderNumber: lastOrder.orderNumber,
      tableNumber: lastOrder.tableNumber ?? undefined,
      orderType: lastOrder.type,
      customerName: lastOrder.customerName ?? undefined,
      createdAt: lastOrder.createdAt,
      items: lastOrder.items,
      notes: lastOrder.notes,
    });
  };

  const cartCommonProps = {
    cart,
    orderType,
    customerName,
    orderNotes,
    isPending: createOrder.isPending,
    taxRate,
    tableId,
    onTableChange: setTableId,
    customer,
    onCustomerChange: setCustomer,
    onOrderTypeChange: handleOrderTypeChange,
    onCustomerNameChange: setCustomerName,
    onOrderNotesChange: setOrderNotes,
    onUpdateQty: updateCartQty,
    onRemove: removeFromCart,
    onClearCart: () => setCart([]),
    onCreateOrder: handleCreateOrder,
    deliveryPhone,
    onDeliveryPhoneChange: setDeliveryPhone,
    deliveryAddress,
    onDeliveryAddressChange: setDeliveryAddress,
    deliveryFee,
    onDeliveryFeeChange: setDeliveryFee,
    deliveryFeeCents,
    deliveryFeeInvalid,
    deliveryDriverId,
    onDeliveryDriverIdChange: setDeliveryDriverId,
    paymentMethod,
    onPaymentMethodChange: setPaymentMethod,
    isPaid,
    onIsPaidChange: setIsPaid,
  };

  return (
    <div className="relative flex h-[calc(100vh-8rem)] min-h-0 flex-col gap-4 lg:flex-row">
      <ProductGrid
        categories={categories ?? []}
        items={allItems}
        isLoading={itemsLoading}
        isError={itemsError}
        errorMessage={(itemsErrorObj as Error | null)?.message}
        onRetry={() => refetchItems()}
        search={search}
        onSearchChange={setSearch}
        selectedCategory={selectedCategory}
        onCategoryChange={setSelectedCategory}
        cart={cart}
        onItemClick={handleItemClick}
        pendingItemIds={pendingItemIds}
      />

      <div className="hidden lg:flex lg:w-[24rem] xl:w-[28rem]">
        <CartSidebar
          className="h-full rounded-[28px] border bg-card/80 p-4 shadow-sm"
          {...cartCommonProps}
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
          <span>{totalQty > 0 ? formatCurrency(total) : "Sin productos"}</span>
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
              Revisa el carrito, la mesa y el cliente, y confirma la orden desde aquí.
            </SheetDescription>
          </SheetHeader>

          <CartSidebar className="min-h-0 flex-1" {...cartCommonProps} />
        </SheetContent>
      </Sheet>

      <SuccessDialog
        open={successDialog}
        onOpenChange={setSuccessDialog}
        order={lastOrder}
        onCharge={() => {
          setSuccessDialog(false);
          setChargeDialog(true);
        }}
        onPrintKitchenTicket={handlePrintKitchenTicket}
      />

      <ChargeDialog
        open={chargeDialog}
        onOpenChange={setChargeDialog}
        order={lastOrder}
        taxRate={taxRate}
        businessName={org?.legal_name || org?.name || branch?.name || "RestAI"}
        ruc={org?.ruc || undefined}
        address={branch?.address || undefined}
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
