import { formatCurrency } from "@/lib/utils";

/**
 * Estimación de descuentos del carrito.
 *
 * Todo lo de aquí es una PREVISUALIZACIÓN: el servidor recalcula al confirmar y
 * es el único que manda (`order.service.ts`). Existe para que el comensal sepa
 * lo que va a pagar ANTES de pagarlo, y la aritmética está calcada de la del
 * servidor para que las dos cifras coincidan.
 *
 * ── Por qué vive en su propio módulo ─────────────────────────────────────────
 * Nació dentro de la pantalla del carrito. Cuando el mesero por voz tuvo que
 * decir el total en voz alta necesitaba exactamente el mismo cálculo, y copiarlo
 * habría dejado dos versiones de la misma aritmética de dinero: la primera vez
 * que alguien corrigiera un redondeo en una, la otra empezaría a mentir. Y aquí
 * mentir significa que el comensal oye un precio y en caja le cobran otro.
 */

/** Línea de carrito, en lo mínimo que necesitan estos cálculos. */
export interface DiscountableLine {
  menuItemId: string;
  unitPrice: number;
  quantity: number;
  modifiers: { price: number }[];
}

export interface AppliedCoupon {
  code: string;
  name: string;
  type: string;
  discount_value: number;
  menu_item_id?: string | null;
  min_order_amount?: number | null;
  max_discount_amount?: number | null;
}

/**
 * Canje pendiente tal y como lo sirve GET /my-redemptions. `reward_type` es lo
 * que permite distinguir un producto gratis (discount_value = 0) de un
 * descuento: sin él, la recompensa se anunciaba como "S/ 0.00 de descuento".
 */
export interface PendingRedemption {
  id: string;
  reward_name: string;
  reward_type?: string | null;
  discount_type: string | null;
  discount_value: number | null;
  menu_item_id?: string | null;
}

export interface DiscountResult {
  discount: number;
  blockedReason: string | null;
  /**
   * El importe NO se puede estimar aquí y lo pondrá el servidor al confirmar.
   * Quien muestre esto —o lo diga en voz alta— no debe prometer un total exacto.
   */
  serverOnly: boolean;
}

// Precio por unidad INCLUYENDO modificadores. Refleja el effectiveUnitPrice del
// servidor (total de línea / cantidad) para que las estimaciones de producto
// gratis y 2x1 cuadren con el total confirmado.
export function effectiveUnitPrice(item: DiscountableLine): number {
  return item.unitPrice + item.modifiers.reduce((sum, m) => sum + m.price, 0);
}

/** Total de línea (con modificadores, × cantidad). Coincide con el `total` del servidor. */
export function effectiveLineTotal(item: DiscountableLine): number {
  return effectiveUnitPrice(item) * item.quantity;
}

/**
 * Descuento estimado de un cupón, o el motivo legible por el que aún no aplica.
 *
 * Los cupones que se puede DEMOSTRAR que no descuentan nada se retienen con una
 * explicación, en vez de mandarlos y gastar un uso a cambio de cero. Los
 * `serverOnly` sí se envían: si allí tampoco aplican, el pedido pasa igual y el
 * cupón no se consume.
 */
export function computeCouponDiscount(params: {
  coupon: AppliedCoupon | null;
  items: DiscountableLine[];
  subtotal: number;
  /** Nombres de plato por id, para poder decir QUÉ falta en el carrito. */
  menuItemNames?: Record<string, string>;
}): DiscountResult {
  const { coupon, items, subtotal, menuItemNames = {} } = params;
  if (!coupon) return { discount: 0, blockedReason: null, serverOnly: false };

  // Pedido mínimo (el servidor rechaza el cupón por debajo de este umbral).
  if (coupon.min_order_amount != null && subtotal < coupon.min_order_amount) {
    const faltan = coupon.min_order_amount - subtotal;
    return {
      discount: 0,
      serverOnly: false,
      blockedReason: `Pedido mínimo ${formatCurrency(coupon.min_order_amount)} · faltan ${formatCurrency(faltan)}`,
    };
  }

  /** Cupón que exige un plato concreto que no está en el carrito. */
  const faltaElPlato = (): string => {
    const nombre = coupon.menu_item_id ? menuItemNames[coupon.menu_item_id] : null;
    return nombre
      ? `Agrega ${nombre} al carrito para usar este cupón`
      : "Agrega al carrito el producto de este cupón";
  };

  let discount = 0;
  switch (coupon.type) {
    case "percentage":
      discount = Math.round(subtotal * (coupon.discount_value / 100));
      break;
    case "fixed":
      discount = Math.min(coupon.discount_value, subtotal);
      break;
    case "item_free": {
      // 1 unidad gratis al precio unitario efectivo (con modificadores).
      if (coupon.menu_item_id) {
        const match = items.find((i) => i.menuItemId === coupon.menu_item_id);
        if (!match) return { discount: 0, blockedReason: faltaElPlato(), serverOnly: false };
        discount = effectiveUnitPrice(match);
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
      // Porcentaje sobre el total de línea de un plato concreto.
      if (coupon.menu_item_id) {
        const match = items.find((i) => i.menuItemId === coupon.menu_item_id);
        if (!match) return { discount: 0, blockedReason: faltaElPlato(), serverOnly: false };
        discount = Math.round(effectiveLineTotal(match) * (coupon.discount_value / 100));
      }
      break;
    }
    // 2x1 y descuento por categoría: la validación pública no devuelve
    // buy_quantity/get_quantity/category_id, así que el importe lo calcula el
    // servidor al confirmar.
    case "buy_x_get_y":
    case "category_discount":
      return { discount: 0, blockedReason: null, serverOnly: true };
    default:
      discount = 0;
  }

  // Tope máximo y recorte al subtotal, en ese orden (igual que el servidor).
  if (coupon.max_discount_amount != null && discount > coupon.max_discount_amount) {
    discount = coupon.max_discount_amount;
  }
  discount = Math.min(discount, subtotal);

  if (discount <= 0) {
    return {
      discount: 0,
      blockedReason: "Este cupón no descuenta nada en tu pedido actual",
      serverOnly: false,
    };
  }

  return { discount, blockedReason: null, serverOnly: false };
}

/**
 * Estimación del canje, calcada de applyRedemption() en el servidor.
 *
 * Un canje de PRODUCTO GRATIS solo descuenta si ese plato está en el carrito:
 * si no lo está, el servidor descuenta 0 y el comensal se llevaría la sorpresa
 * al pagar. Aquí se dice antes, con el nombre del plato que falta.
 */
export function computeRedemptionDiscount(params: {
  redemption: PendingRedemption | null;
  items: DiscountableLine[];
  subtotal: number;
  /** Se aplica sobre lo que queda TRAS el cupón, igual que el servidor. */
  couponDiscount: number;
  menuItemNames?: Record<string, string>;
}): { discount: number; blockedReason: string | null } {
  const { redemption, items, subtotal, couponDiscount, menuItemNames = {} } = params;
  if (!redemption) return { discount: 0, blockedReason: null };

  const remaining = subtotal - couponDiscount;
  if (remaining <= 0) return { discount: 0, blockedReason: null };

  if (redemption.reward_type === "free_item") {
    const itemId = redemption.menu_item_id;
    const match = itemId ? items.find((i) => i.menuItemId === itemId) : undefined;
    if (!match) {
      const name = itemId ? menuItemNames[itemId] : null;
      return {
        discount: 0,
        blockedReason: name
          ? `Agrega ${name} al carrito para aprovechar esta recompensa`
          : "Agrega al carrito el producto de esta recompensa",
      };
    }
    return { discount: Math.min(effectiveUnitPrice(match), remaining), blockedReason: null };
  }

  if (redemption.discount_type === "percentage") {
    return {
      discount: Math.round(remaining * ((redemption.discount_value ?? 0) / 100)),
      blockedReason: null,
    };
  }
  return {
    discount: Math.min(redemption.discount_value ?? 0, remaining),
    blockedReason: null,
  };
}

/**
 * Totales finales. El IGV se calcula sobre (subtotal − descuento), igual que el
 * servidor: cobrarlo sobre el subtotal bruto inflaría el impuesto de todo pedido
 * con descuento.
 */
export function computeTotals(params: {
  subtotal: number;
  totalDiscount: number;
  taxRate: number;
}): { taxableBase: number; tax: number; total: number } {
  const { subtotal, totalDiscount, taxRate } = params;
  const taxableBase = subtotal - totalDiscount;
  const tax = Math.round((taxableBase * taxRate) / 10000);
  return { taxableBase, tax, total: taxableBase + tax };
}
