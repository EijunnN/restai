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
import { LayoutList, Plus, ShoppingCart } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useCategories, useMenuItems } from "@/hooks/use-menu";
import { useAddOrderItems, useCreateOrder, useOrders } from "@/hooks/use-orders";
import { useTables, type TableRow } from "@/hooks/use-tables";
import { useServiceRequests } from "@/hooks/use-service-requests";
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
import { TurnoResumen } from "./_components/turno-resumen";
import { OpenAccounts } from "./_components/open-accounts";
import { componerCuentas, type CuentaAbierta } from "./_components/pos-accounts";
import { CobrarDialog } from "../tables/_components/cobrar-dialog";

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
  /**
   * Cuántos grupos de opciones cuelgan del plato. Ya venía en `GET /menu/items`
   * y nadie lo miraba: es lo que permite avisar en la ficha de que tocarlo abre
   * un diálogo en vez de añadirlo directo al carrito.
   */
  modifier_group_count?: number;
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

  /*
    Sobre qué cuenta se está cantando.

    Se guarda la CLAVE y no la cuenta entera: los saldos se refrescan cada pocos
    segundos y una copia congelada acabaría cobrando el importe de hace tres
    rondas. La cuenta viva se busca por clave en cada repintado.
  */
  const [claveCuenta, setClaveCuenta] = useState<string | null>(null);
  const [cuentasAbiertasOpen, setCuentasAbiertasOpen] = useState(false);
  /** Mesa cuyo cobro completo (dividir, facturar) está abierto. */
  const [mesaACobrar, setMesaACobrar] = useState<TableRow | null>(null);
  /**
   * Lo que queda por cobrar de `lastOrder`, cuando no es su total.
   *
   * Solo pasa al ampliar una cuenta que ya recibió un adelanto: el diálogo debe
   * abrirse con lo que falta, no con el total nuevo entero.
   */
  const [pendienteCobro, setPendienteCobro] = useState<number | undefined>(undefined);

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
  /*
    La carta ENTERA, siempre, y el filtrado por categoría en el cliente.

    Dos razones. El carril lateral dice cuántos platos tiene cada categoría, y
    eso no se puede saber si el servidor solo devuelve la que estás mirando. Y
    cambiar de categoría deja de ser una petición: en una caja, "Bebidas" tiene
    que aparecer en el mismo toque, no cuando conteste la red del local.

    La carta de un restaurante son decenas de platos, no miles: cabe de sobra en
    una respuesta.
  */
  const {
    data: menuItems,
    isLoading: itemsLoading,
    isError: itemsError,
    error: itemsErrorObj,
    refetch: refetchItems,
  } = useMenuItems();
  const createOrder = useCreateOrder();
  const addOrderItems = useAddOrderItems();
  const printKitchenTicket = usePrintKitchenTicket();

  /*
    Las cuentas abiertas del local.

    Dos fuentes, porque el servidor guarda dos cosas distintas: las mesas traen
    el saldo YA agregado de su visita (suma sus órdenes y resta lo cobrado sin
    anular), y los pedidos de mostrador y reparto no tienen visita, así que son
    su propia cuenta. Mezclar los dos saldos sin cuidado contaría dos veces el
    dinero del salón: de eso se encarga `componerCuentas`.
  */
  const { data: tablesData, isLoading: tablesLoading } = useTables();
  const { data: openOrders, isLoading: ordersLoading } = useOrders({
    scope: "open",
    limit: 100,
  });
  // Qué mesas han pedido la cuenta: es lo que separa "esperan cobro" de "siguen
  // comiendo tranquilas".
  const { data: avisosDeCuenta } = useServiceRequests({ type: "request_bill" });

  const cuentas = useMemo(
    () =>
      componerCuentas({
        mesas: tablesData?.tables ?? [],
        ordenes: (openOrders?.orders ?? []) as any[],
        mesasConCuentaPedida: new Set(
          (avisosDeCuenta ?? []).map((a) => a.table_id).filter((id): id is string => !!id),
        ),
      }),
    [tablesData, openOrders, avisosDeCuenta],
  );
  const cuentaActiva = useMemo(
    () => cuentas.find((c) => c.clave === claveCuenta) ?? null,
    [cuentas, claveCuenta],
  );

  /*
    Tasa de IGV de la sede, leída de /api/branches (`branch:read`).

    OJO, aquí hubo un comentario FALSO durante meses: decía que cajero y mozo no
    tenían `settings:read`. Sí lo tienen (packages/config/src/index.ts, líneas 53
    y 76), y cada uno por un motivo escrito al lado. La razón real para usar
    /api/branches es otra y sigue siendo buena: esta pantalla YA carga la lista
    de sedes para saber en cuál está, así que la tasa viene sin una petición de
    más.
  */
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

  /**
   * Manda lo cantado al servidor y devuelve la foto de la cuenta resultante.
   *
   * Tres caminos, y el tipo de cuenta decide cuál:
   *
   * - Sin cuenta activa: nace una cuenta nueva (`POST /orders`).
   * - Cuenta de MESA: cada ronda es su propia comanda colgada de la misma visita
   *   (`POST /orders` con `tableId`). La cocina recibe un ticket por ronda, que
   *   es como se trabaja en el pase.
   * - Cuenta de mostrador o reparto: no hay visita de la que colgar nada, así
   *   que las líneas se añaden a la orden que ya existe (`POST /orders/:id/items`).
   *
   * Devuelve `null` si no se envió nada, para que quien llame no siga adelante.
   *
   * @param silencioso No abre el resumen con "imprimir comanda". Lo usa el
   *        cobro, que va a abrir su propia pantalla justo después: dos diálogos
   *        encadenados son un toque extra en el momento de más prisa.
   */
  const enviarPedido = async (silencioso = false): Promise<PosOrderSnapshot | null> => {
    if (cart.length === 0) return null;
    if (creatingOrderRef.current) return null;

    // Ampliación de un pedido de mostrador o reparto ya abierto.
    if (cuentaActiva && cuentaActiva.tipo !== "mesa") {
      const orderId = cuentaActiva.orderIds[0];
      if (!orderId) {
        toast.error("Esta cuenta ya no tiene un pedido al que añadir");
        return null;
      }
      creatingOrderRef.current = true;
      try {
        const res = await addOrderItems.mutateAsync({
          orderId,
          items: cart.map((item) => ({
            menuItemId: item.menuItemId,
            quantity: item.quantity,
            notes: item.notes || undefined,
            modifiers: item.modifiers.map((m) => ({ modifierId: m.modifierId })),
          })),
        });

        const snapshot: PosOrderSnapshot = {
          id: res.id,
          orderNumber: res.order_number ?? "",
          createdAt: new Date().toISOString(),
          type: cuentaActiva.tipo === "delivery" ? "delivery" : "takeout",
          tableNumber: null,
          customerName: cuentaActiva.cliente,
          notes: orderNotes.trim() || undefined,
          // La comanda que se imprime es la de ESTA ronda: lo anterior ya salió.
          items: buildTicketLines(cart),
          subtotal: res.subtotal,
          discount: res.discount ?? 0,
          tax: res.tax,
          deliveryFee: 0,
          total: res.total,
        };
        setLastOrder(snapshot);
        // El total de la respuesta es el de la orden ENTERA; lo que el cliente
        // debe ahora es eso menos lo que ya había entregado.
        setPendienteCobro(Math.max(0, res.total - cuentaActiva.pagado));
        setCart([]);
        setOrderNotes("");
        setMobileCartOpen(false);
        if (!silencioso) setSuccessDialog(true);
        toast.success(`Añadido a ${cuentaActiva.nombre}`);
        return snapshot;
      } catch (err: any) {
        toast.error(err?.message || "No se pudo añadir a la cuenta");
        return null;
      } finally {
        creatingOrderRef.current = false;
      }
    }

    return handleCreateOrder(silencioso);
  };

  /**
   * Cierra la venta: manda lo que quede por mandar y abre el cobro.
   *
   * El cobro tiene dos tamaños. El de mesa es el completo —dividir por producto,
   * cobros parciales, liberar la mesa al saldar—, porque una mesa casi nunca
   * paga de una sola forma. El de mostrador es el rápido: un método, un importe,
   * el vuelto y a por el siguiente.
   */
  const handleCobrar = async () => {
    /*
      La cuenta se congela ANTES de mandar nada.

      Mandar una ronda suelta la cuenta activa (el carrito queda limpio para el
      siguiente), así que leer `cuentaActiva` después del envío daría null y una
      mesa acabaría cobrando solo su última comanda en vez de la visita entera.
    */
    const cuenta = cuentaActiva;
    let orden: PosOrderSnapshot | null = null;
    // El resumen de la comanda anterior no puede quedar encima del cobro: son
    // dos diálogos apilados y el de abajo se lleva los toques.
    setSuccessDialog(false);

    if (cart.length > 0) {
      const enviada = await enviarPedido(true);
      if (!enviada) return;
      orden = enviada;
    }

    // Mesa: el cobro completo trabaja sobre la visita entera, no sobre la última
    // comanda. Cobrar solo la última ronda dejaría el resto de la mesa sin pagar.
    const claveMesa = cuenta?.tipo === "mesa" ? cuenta.tableId : null;
    if (claveMesa) {
      const mesa = (tablesData?.tables ?? []).find((t) => t.id === claveMesa);
      if (!mesa) {
        toast.error("La mesa de esta cuenta ya no está disponible");
        return;
      }
      setMesaACobrar(mesa);
      return;
    }

    // Mostrador y reparto: cobro rápido sobre la orden.
    if (!orden && cuenta) {
      const orderId = cuenta.orderIds[0];
      if (!orderId) {
        toast.error("Esta cuenta ya no tiene un pedido que cobrar");
        return;
      }
      const cargada = await cargarOrdenParaCobro(orderId);
      if (!cargada) return;
      orden = cargada;
      setPendienteCobro(cuenta.saldo);
    }

    if (!orden) return;
    setLastOrder(orden);
    setChargeDialog(true);
  };

  /** Trae del servidor una orden ya existente en el formato que cobra el POS. */
  const cargarOrdenParaCobro = async (orderId: string): Promise<PosOrderSnapshot | null> => {
    try {
      const orden = await queryClient.fetchQuery<any>({
        queryKey: ["orders", orderId],
        queryFn: () => apiFetch<any>(`/api/orders/${orderId}`),
      });
      return {
        id: orden.id,
        orderNumber: orden.order_number ?? "",
        createdAt: orden.created_at ?? new Date().toISOString(),
        type: orden.type,
        tableNumber: orden.table_number ?? null,
        customerName: orden.customer_name ?? null,
        notes: orden.notes || undefined,
        items: (orden.items ?? [])
          // Una línea anulada ("86") no se cobra ni se imprime en el recibo.
          .filter((i: any) => i.status !== "cancelled")
          .map((i: any) => ({
            name: i.name,
            quantity: i.quantity,
            unit_price: i.unit_price,
            total: i.total,
            notes: i.notes || undefined,
            modifiers: (i.modifiers ?? []).map((m: any) => ({ name: m.name })),
          })),
        subtotal: orden.subtotal ?? 0,
        discount: orden.discount ?? 0,
        tax: orden.tax ?? 0,
        deliveryFee: orden.delivery_fee ?? 0,
        total: orden.total ?? 0,
      };
    } catch (err: any) {
      toast.error(err?.message || "No se pudo abrir la cuenta para cobrarla");
      return null;
    }
  };

  const handleCreateOrder = async (silencioso = false): Promise<PosOrderSnapshot | null> => {
    if (cart.length === 0) return null;
    // Guarda síncrona contra el doble toque: `isPending` deshabilita el botón en
    // el siguiente repintado, y en una tablet lenta caben dos toques antes. Una
    // orden duplicada en hora punta es el peor fallo posible del POS.
    if (creatingOrderRef.current) return null;

    /*
      Sobre una cuenta de mesa ya abierta, el tipo y la mesa NO los decide el
      formulario: los decide la cuenta. Cantar una ronda sobre la mesa 7 y que
      saliera como venta de mostrador porque el selector se había quedado en
      "Llevar" es exactamente el error que la barra de cuenta viene a evitar.
    */
    const enMesa = cuentaActiva?.tipo === "mesa";
    const tipoEfectivo = enMesa ? "dine_in" : orderType;
    const mesaEfectiva = enMesa ? cuentaActiva!.tableId : tableId;

    if (tipoEfectivo === "delivery" && deliveryFeeInvalid) {
      toast.error("La tarifa de delivery debe ser un importe en soles (ej. 8.50)");
      return null;
    }
    const effectiveCustomerName = customer?.name || customerName.trim() || "Cliente POS";
    creatingOrderRef.current = true;

    try {
      const orderData: Record<string, unknown> = {
        type: tipoEfectivo,
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
      if (tipoEfectivo === "dine_in" && mesaEfectiva) orderData.tableId = mesaEfectiva;
      // Cliente: es este id, y no el nombre, lo que hace que la venta sume puntos.
      if (customer) orderData.customerId = customer.id;

      if (tipoEfectivo === "delivery") {
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
      if (tipoEfectivo === "dine_in" && mesaEfectiva) {
        void queryClient.invalidateQueries({ queryKey: ["tables"] });
        void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      }

      const snapshot: PosOrderSnapshot = {
        id: result.id,
        orderNumber: result.order_number ?? "",
        createdAt: result.created_at ?? new Date().toISOString(),
        type: tipoEfectivo,
        tableNumber: result.table_number ?? null,
        customerName: result.customer_name ?? effectiveCustomerName,
        notes: orderNotes.trim() || undefined,
        items: buildTicketLines(cart),
        subtotal: result.subtotal ?? subtotal,
        discount: result.discount ?? 0,
        tax: result.tax ?? tax,
        deliveryFee: result.delivery_fee ?? deliveryFeeCents,
        total: result.total ?? total,
      };
      setLastOrder(snapshot);
      // Una orden recién nacida no ha cobrado nada: debe su total entero.
      setPendienteCobro(undefined);

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
      if (!silencioso) setSuccessDialog(true);
      /*
        Mandado el pedido, el carrito vuelve a estar limpio y la cuenta se suelta.

        Quedarse pegado a la cuenta recién enviada es como se cantan las bebidas
        del siguiente cliente en la cuenta del anterior: en el mostrador se
        atiende a otra persona en cuanto se cierra la venta, y en el salón el
        mozo se va a otra mesa. Volver a entrar a una cuenta cuesta un toque
        desde la lista; equivocarse de cuenta cuesta una discusión.
      */
      setClaveCuenta(null);
      toast.success(
        tipoEfectivo === "dine_in" ? "Comanda enviada a cocina" : "Orden creada correctamente",
      );
      return snapshot;
    } catch (err: any) {
      toast.error(err?.message || "No se pudo crear la orden");
      return null;
    } finally {
      creatingOrderRef.current = false;
    }
  };

  /**
   * Entra en una cuenta abierta.
   *
   * El carrito NO se vacía: lo normal es venir de cantar dos platos y darse
   * cuenta de que van a la mesa 7. Lo que sí se ajusta es el tipo de pedido, que
   * a partir de aquí lo manda la cuenta.
   */
  const elegirCuenta = (cuenta: CuentaAbierta) => {
    setClaveCuenta(cuenta.clave);
    setCuentasAbiertasOpen(false);
    if (cuenta.tipo === "mesa") {
      setOrderType("dine_in");
      setTableId(cuenta.tableId);
    } else {
      setOrderType(cuenta.tipo === "delivery" ? "delivery" : "takeout");
      setTableId(null);
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
    onCreateOrder: () => void enviarPedido(),
    onCobrar: () => void handleCobrar(),
    cuenta: cuentaActiva,
    cuentas,
    onVerCuentas: () => {
      setMobileCartOpen(false);
      setCuentasAbiertasOpen(true);
    },
    onSoltarCuenta: () => setClaveCuenta(null),
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
        pieDelCarril={<TurnoResumen />}
      />

      <div className="hidden lg:flex lg:w-[24rem] xl:w-[28rem]">
        <CartSidebar
          className="h-full rounded-[28px] border bg-card/80 p-4 shadow-sm"
          {...cartCommonProps}
        />
      </div>

      <div className="fixed inset-x-0 bottom-16 z-30 flex gap-2 p-3 lg:hidden">
        {/*
          Las cuentas abiertas también en el móvil. En una tablet de mano el
          carrito vive detrás de una hoja, así que sin este botón la única
          entrada a la lista quedaba a dos toques de profundidad.
        */}
        {cuentas.length > 0 && (
          <Button
            variant="outline"
            className="h-14 shrink-0 rounded-2xl border-foreground/15 bg-background px-3.5 text-sm font-semibold shadow-lg"
            onClick={() => setCuentasAbiertasOpen(true)}
            aria-label={`Ver las ${cuentas.length} cuentas abiertas`}
          >
            <LayoutList className="mr-1.5 h-5 w-5" />
            {cuentas.length}
          </Button>
        )}
        <Button
          className="h-14 min-w-0 flex-1 justify-between rounded-2xl border border-foreground/10 bg-foreground px-4 text-base font-semibold text-background shadow-lg hover:bg-foreground/90"
          onClick={() => setMobileCartOpen(true)}
        >
          <span className="flex min-w-0 items-center gap-2">
            <ShoppingCart className="h-5 w-5 shrink-0" />
            <span className="truncate">
              {cuentaActiva ? cuentaActiva.nombre : totalQty > 0 ? `${totalQty} productos` : "Abrir pedido"}
            </span>
          </span>
          <span className="shrink-0">{totalQty > 0 ? formatCurrency(total) : "Sin productos"}</span>
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

      {cuentasAbiertasOpen && (
        <OpenAccounts
          cuentas={cuentas}
          claveActiva={claveCuenta}
          cargando={tablesLoading || ordersLoading}
          onElegir={elegirCuenta}
          onCerrar={() => setCuentasAbiertasOpen(false)}
          acciones={
            <Button
              variant="outline"
              className="h-10 shrink-0 rounded-xl px-3.5 text-sm font-semibold"
              onClick={() => {
                setClaveCuenta(null);
                setCuentasAbiertasOpen(false);
              }}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Cuenta nueva
            </Button>
          }
        />
      )}

      {/*
        Cobro completo de una mesa: dividir por producto, cobros parciales y
        liberar la mesa al saldar. Es el mismo diálogo que usa el plano del
        salón — una mesa no se cobra distinto según desde qué pantalla la mires.
      */}
      <CobrarDialog table={mesaACobrar} onClose={() => setMesaACobrar(null)} />

      <ChargeDialog
        open={chargeDialog}
        onOpenChange={(abierto) => {
          setChargeDialog(abierto);
          // Cerrado el cobro, la cuenta se suelta: lo siguiente que se cante es
          // de otro cliente. Si quedó saldo, sigue en la lista a un toque.
          if (!abierto) setClaveCuenta(null);
        }}
        order={lastOrder}
        pendiente={pendienteCobro}
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
