import { describe, it, expect } from "bun:test";
import {
  computeCouponDiscount,
  computeRedemptionDiscount,
  computeTotals,
  effectiveUnitPrice,
  type DiscountableLine,
} from "./cart-discounts";

/**
 * Aritmética de descuentos.
 *
 * Se prueba con dureza porque de aquí sale la cifra que el mesero por voz dice
 * en voz alta y la que la pantalla del carrito muestra. Si las dos se separan
 * del servidor, el comensal oye un precio y en caja le cobran otro — y eso no
 * se descubre en desarrollo, se descubre discutiendo con un cliente.
 */

const line = (over: Partial<DiscountableLine> = {}): DiscountableLine => ({
  menuItemId: "item-1",
  unitPrice: 1000,
  quantity: 1,
  modifiers: [],
  ...over,
});

describe("cart-discounts", () => {
  it("el precio efectivo incluye los modificadores", () => {
    const item = line({ modifiers: [{ price: 300 }, { price: 200 }] });
    expect(effectiveUnitPrice(item)).toBe(1500);
  });

  it("retiene el cupón cuando no se llega al pedido mínimo, con el importe que falta", () => {
    const result = computeCouponDiscount({
      coupon: {
        code: "X",
        name: "10%",
        type: "percentage",
        discount_value: 10,
        min_order_amount: 5000,
      },
      items: [line()],
      subtotal: 1000,
    });

    expect(result.discount).toBe(0);
    expect(result.blockedReason).toContain("faltan");
  });

  it("respeta el tope máximo de descuento", () => {
    const result = computeCouponDiscount({
      coupon: {
        code: "X",
        name: "50%",
        type: "percentage",
        discount_value: 50,
        max_discount_amount: 1000,
      },
      items: [line({ unitPrice: 10000 })],
      subtotal: 10000,
    });

    // 50% de 10000 son 5000, pero el tope es 1000.
    expect(result.discount).toBe(1000);
  });

  it("nunca descuenta más que el subtotal", () => {
    const result = computeCouponDiscount({
      coupon: { code: "X", name: "Fijo enorme", type: "fixed", discount_value: 999999 },
      items: [line()],
      subtotal: 1000,
    });
    expect(result.discount).toBe(1000);
  });

  it("un producto gratis exige que el producto esté en el carrito", () => {
    const blocked = computeCouponDiscount({
      coupon: {
        code: "X",
        name: "Postre gratis",
        type: "item_free",
        discount_value: 0,
        menu_item_id: "item-ausente",
      },
      items: [line()],
      subtotal: 1000,
      menuItemNames: { "item-ausente": "Suspiro limeño" },
    });

    expect(blocked.discount).toBe(0);
    // El motivo tiene que nombrar el plato: "agrega algo" no le sirve a nadie.
    expect(blocked.blockedReason).toContain("Suspiro limeño");
  });

  it("el producto gratis descuenta el precio CON modificadores", () => {
    const result = computeCouponDiscount({
      coupon: {
        code: "X",
        name: "Gratis",
        type: "item_free",
        discount_value: 0,
        menu_item_id: "item-1",
      },
      items: [line({ modifiers: [{ price: 500 }], quantity: 2 })],
      subtotal: 3000,
    });
    // Una unidad, a 1000 + 500 de modificadores.
    expect(result.discount).toBe(1500);
  });

  it("marca como serverOnly los cupones que no puede estimar", () => {
    for (const type of ["buy_x_get_y", "category_discount"]) {
      const result = computeCouponDiscount({
        coupon: { code: "X", name: "2x1", type, discount_value: 0 },
        items: [line()],
        subtotal: 1000,
      });
      // Ni descuento inventado ni bloqueo: el importe lo pone el servidor, y
      // quien lo diga en voz alta debe saber que no es definitivo.
      expect(result.serverOnly).toBe(true);
      expect(result.discount).toBe(0);
      expect(result.blockedReason).toBeNull();
    }
  });

  it("retiene un cupón que demostrablemente no descuenta nada", () => {
    const result = computeCouponDiscount({
      coupon: { code: "X", name: "Roto", type: "percentage", discount_value: 0 },
      items: [line()],
      subtotal: 1000,
    });
    // Enviarlo gastaría un uso del cupón a cambio de cero.
    expect(result.discount).toBe(0);
    expect(result.blockedReason).toBeTruthy();
  });

  it("el canje se aplica sobre lo que queda tras el cupón", () => {
    const result = computeRedemptionDiscount({
      redemption: {
        id: "r1",
        reward_name: "20% de descuento",
        discount_type: "percentage",
        discount_value: 20,
      },
      items: [line({ unitPrice: 10000 })],
      subtotal: 10000,
      couponDiscount: 5000,
    });
    // 20% de los 5000 restantes, no de los 10000 iniciales.
    expect(result.discount).toBe(1000);
  });

  it("un canje de producto gratis avisa si el plato no está en el carrito", () => {
    const result = computeRedemptionDiscount({
      redemption: {
        id: "r1",
        reward_name: "Postre gratis",
        reward_type: "free_item",
        discount_type: null,
        discount_value: 0,
        menu_item_id: "item-ausente",
      },
      items: [line()],
      subtotal: 1000,
      couponDiscount: 0,
      menuItemNames: { "item-ausente": "Picarones" },
    });

    expect(result.discount).toBe(0);
    expect(result.blockedReason).toContain("Picarones");
  });

  it("el canje no descuenta nada si el cupón ya se comió el pedido", () => {
    const result = computeRedemptionDiscount({
      redemption: {
        id: "r1",
        reward_name: "Descuento",
        discount_type: "fixed",
        discount_value: 5000,
      },
      items: [line()],
      subtotal: 1000,
      couponDiscount: 1000,
    });
    expect(result.discount).toBe(0);
  });

  it("el IGV se calcula sobre la base YA descontada", () => {
    const { taxableBase, tax, total } = computeTotals({
      subtotal: 10000,
      totalDiscount: 2000,
      taxRate: 1800,
    });
    expect(taxableBase).toBe(8000);
    // Cobrar el IGV sobre el subtotal bruto inflaría el impuesto de todo pedido
    // con descuento, y el total dicho dejaría de cuadrar con la caja.
    expect(tax).toBe(1440);
    expect(total).toBe(9440);
  });
});
