import { eq, and, ne, inArray, sql, isNull } from "drizzle-orm";
import { db, schema , type DbOrTx } from "@restai/db";
import { generateOrderNumber } from "../lib/id.js";
import { logger } from "../lib/logger.js";
import { awardPoints } from "./loyalty.service.js";
import { deductForOrder, InsufficientStockError } from "./inventory.service.js";

// Types for order creation input
interface OrderItemInput {
  menuItemId: string;
  quantity: number;
  notes?: string;
  modifiers?: Array<{ modifierId: string }>;
}

interface CreateOrderParams {
  organizationId: string;
  branchId: string;
  items: OrderItemInput[];
  type: string;
  customerName?: string | null;
  notes?: string | null;
  tableSessionId?: string | null;
  customerId?: string | null;
  couponCode?: string | null;
  redemptionId?: string | null;
  // Delivery fields
  deliveryAddress?: string | null;
  deliveryPhone?: string | null;
  deliveryFee?: number;
  deliveryDriverId?: string | null;
}

interface CreateOrderResult {
  order: typeof schema.orders.$inferSelect;
  items: (typeof schema.orderItems.$inferSelect)[];
  /**
   * Motivo por el que el cupón enviado NO llegó a aplicarse (no produce ningún
   * descuento sobre este carrito). El pedido se registra igualmente y el cupón
   * NO se consume: un cupón que no encaja no puede impedir que el comensal pida.
   * `null` cuando no se envió cupón o cuando sí se aplicó.
   */
  couponIgnored: string | null;
}

/**
 * Validates menu items and creates an order with its items.
 * Returns the created order and items, or throws an error if validation fails.
 */
/** Una línea tal y como se va a guardar, con sus modificadores ya validados. */
export interface LineaPreciada {
  menu_item_id: string;
  name: string;
  unit_price: number;
  quantity: number;
  total: number;
  notes?: string;
  /**
   * Con nombre y precio ya resueltos: la instantánea que se guarda tiene que
   * salir de la MISMA lectura que validó el modificador, no de una segunda
   * consulta que podría ver otra cosa.
   */
  modifiers: Array<{ modifierId: string; name: string; price: number }>;
}

/**
 * Valida y pone precio a un conjunto de líneas.
 *
 * Estaba dentro de `createOrder` y ahora lo comparten DOS caminos: crear un
 * pedido y añadir platos a una cuenta ya abierta. Duplicarlo habría significado
 * dos sitios donde permitir un modificador que no pertenece al plato —el fallo
 * que convierte "Pollo a la brasa" en "Pollo a la brasa + doble langostino
 * gratis"— y dos sitios donde olvidar comprobar que el plato sigue disponible.
 *
 * Todo el precio se calcula AQUÍ, con los datos de la carta leídos en este
 * momento: nunca con lo que mande el cliente HTTP.
 */
export async function validarYPreciarLineas(
  params: {
    organizationId: string;
    branchId: string;
    items: CreateOrderParams["items"];
  },
  ejecutor: DbOrTx = db,
): Promise<{ lineas: LineaPreciada[]; subtotal: number }> {
  const { organizationId, branchId, items } = params;

  // Get menu items for price calculation (exclude soft-deleted, scope to tenant)
  const menuItemIds = items.map((i) => i.menuItemId);
  const menuItemsResult = await ejecutor
    .select()
    .from(schema.menuItems)
    .where(and(
      inArray(schema.menuItems.id, menuItemIds),
      eq(schema.menuItems.organization_id, organizationId),
      eq(schema.menuItems.branch_id, branchId),
      isNull(schema.menuItems.deleted_at),
    ));

  const menuItemMap = new Map(menuItemsResult.map((mi) => [mi.id, mi]));

  // Collect all modifier IDs and fetch their prices.
  // Modifiers have no tenant column, so scope via their modifier group's
  // organization_id + branch_id (innerJoin). Also fetch is_available.
  const allModifierIds = items.flatMap(
    (i) => i.modifiers?.map((m) => m.modifierId) || [],
  );

  const modifierMap = new Map<
    string,
    { id: string; name: string; price: number; is_available: boolean; group_id: string }
  >();
  // Map each requested modifier to its owning group (for selection counting)
  const modifierGroupOfModifier = new Map<string, string>();
  if (allModifierIds.length > 0) {
    const modifierRecords = await ejecutor
      .select({
        id: schema.modifiers.id,
        name: schema.modifiers.name,
        price: schema.modifiers.price,
        is_available: schema.modifiers.is_available,
        group_id: schema.modifiers.group_id,
      })
      .from(schema.modifiers)
      .innerJoin(
        schema.modifierGroups,
        eq(schema.modifiers.group_id, schema.modifierGroups.id),
      )
      .where(and(
        inArray(schema.modifiers.id, allModifierIds),
        eq(schema.modifierGroups.organization_id, organizationId),
        eq(schema.modifierGroups.branch_id, branchId),
      ));
    for (const m of modifierRecords) {
      modifierMap.set(m.id, m);
      modifierGroupOfModifier.set(m.id, m.group_id);
    }
  }

  // Resolve each menu item's linked modifier groups for server-side rule
  // enforcement (required groups, min/max selections).
  const itemModifierGroupMap = new Map<
    string,
    Array<{ group_id: string; min_selections: number; max_selections: number; is_required: boolean }>
  >();
  if (menuItemIds.length > 0) {
    const linkedGroups = await ejecutor
      .select({
        item_id: schema.menuItemModifierGroups.item_id,
        group_id: schema.modifierGroups.id,
        min_selections: schema.modifierGroups.min_selections,
        max_selections: schema.modifierGroups.max_selections,
        is_required: schema.modifierGroups.is_required,
      })
      .from(schema.menuItemModifierGroups)
      .innerJoin(
        schema.modifierGroups,
        eq(schema.menuItemModifierGroups.group_id, schema.modifierGroups.id),
      )
      .where(and(
        inArray(schema.menuItemModifierGroups.item_id, menuItemIds),
        eq(schema.modifierGroups.organization_id, organizationId),
        eq(schema.modifierGroups.branch_id, branchId),
      ));
    for (const lg of linkedGroups) {
      const arr = itemModifierGroupMap.get(lg.item_id) || [];
      arr.push({
        group_id: lg.group_id,
        min_selections: lg.min_selections,
        max_selections: lg.max_selections,
        is_required: lg.is_required,
      });
      itemModifierGroupMap.set(lg.item_id, arr);
    }
  }

  // Validate items and calculate totals
  let subtotal = 0;
  const orderItemsData: Array<{
    menu_item_id: string;
    name: string;
    unit_price: number;
    quantity: number;
    total: number;
    notes?: string;
    modifiers: Array<{ modifierId: string; name: string; price: number }>;
  }> = [];

  for (const item of items) {
    const menuItem = menuItemMap.get(item.menuItemId);
    if (!menuItem) {
      throw new OrderValidationError(`Item no encontrado: ${item.menuItemId}`);
    }
    if (!menuItem.is_available) {
      throw new OrderValidationError(`Item no disponible: ${menuItem.name}`);
    }

    // Set of modifier-group ids actually linked to this menu item.
    const linkedGroups = itemModifierGroupMap.get(item.menuItemId) || [];
    const linkedGroupIds = new Set(linkedGroups.map((g) => g.group_id));

    let modifierPricePerUnit = 0;
    // Count selections per group for min/max enforcement
    const selectionsPerGroup = new Map<string, number>();
    if (item.modifiers?.length) {
      for (const mod of item.modifiers) {
        const modifier = modifierMap.get(mod.modifierId);
        if (!modifier) {
          throw new OrderValidationError(`Modificador no encontrado: ${mod.modifierId}`);
        }
        if (!modifier.is_available) {
          throw new OrderValidationError(`Modificador no disponible: ${modifier.name}`);
        }

        const groupId = modifierGroupOfModifier.get(mod.modifierId);
        // Reject modifiers whose group is not linked to this menu item
        // (prevents cross-item modifier injection / pricing of unlinked groups).
        if (!groupId || !linkedGroupIds.has(groupId)) {
          throw new OrderValidationError(
            `Modificador inválido para "${menuItem.name}": ${modifier.name}`,
          );
        }

        modifierPricePerUnit += modifier.price;
        selectionsPerGroup.set(groupId, (selectionsPerGroup.get(groupId) || 0) + 1);
      }
    }

    // Enforce modifier group selection rules (required, min/max selections)
    for (const group of linkedGroups) {
      const count = selectionsPerGroup.get(group.group_id) || 0;
      const minRequired = group.is_required
        ? Math.max(group.min_selections, 1)
        : group.min_selections;
      if (count < minRequired) {
        throw new OrderValidationError(
          `Selección insuficiente de modificadores para "${menuItem.name}"`,
        );
      }
      if (group.max_selections > 0 && count > group.max_selections) {
        throw new OrderValidationError(
          `Demasiados modificadores seleccionados para "${menuItem.name}"`,
        );
      }
    }

    const itemTotal = (menuItem.price + modifierPricePerUnit) * item.quantity;
    subtotal += itemTotal;

    orderItemsData.push({
      menu_item_id: menuItem.id,
      name: menuItem.name,
      unit_price: menuItem.price,
      quantity: item.quantity,
      total: itemTotal,
      notes: item.notes,
      modifiers: (item.modifiers || []).map((m) => {
        const modificador = modifierMap.get(m.modifierId)!;
        return { modifierId: m.modifierId, name: modificador.name, price: modificador.price };
      }),
    });
  }

  return { lineas: orderItemsData, subtotal };
}

export async function createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
  const {
    organizationId,
    branchId,
    items,
    type,
    customerName,
    notes,
    tableSessionId,
    customerId,
    couponCode,
    redemptionId,
    deliveryAddress,
    deliveryPhone,
    deliveryFee = 0,
    deliveryDriverId,
  } = params;

  const { lineas: orderItemsData, subtotal } = await validarYPreciarLineas(
    { organizationId, branchId, items },
  );

  // Get branch tax rate
  const [branch] = await db
    .select({ tax_rate: schema.branches.tax_rate })
    .from(schema.branches)
    .where(eq(schema.branches.id, branchId))
    .limit(1);

  const taxRate = branch?.tax_rate || 1800;
  const orderNumber = generateOrderNumber();

  // Create order + items + coupon/redemption claims in a single transaction so
  // every side effect (usage increments, redemption claim) is atomic with the
  // order. Coupon/redemption validation happens INSIDE the tx to prevent races.
  return await db.transaction(async (tx) => {
    // Calculate coupon discount inside tx (atomic usage claim happens here)
    let discount = 0;
    // Parte del descuento que aporta EL CUPÓN. Se guarda aparte del canje para
    // poder registrarla tal cual en coupon_redemptions.discount_applied: mezclar
    // ambas cifras inflaba el descuento atribuido al cupón en los informes.
    let couponDiscount = 0;
    let couponId: string | null = null;
    let couponIgnored: string | null = null;

    if (couponCode) {
      const couponResult = await applyCoupon({
        couponCode,
        organizationId,
        orderItems: orderItemsData,
        subtotal,
        customerId: customerId || null,
      }, tx);
      couponDiscount = couponResult.discount;
      discount = couponDiscount;
      couponId = couponResult.couponId;
      couponIgnored = couponResult.ignoredReason;
      if (couponIgnored) {
        logger.info("Cupón no aplicado: el pedido continúa sin consumirlo", {
          couponCode,
          organizationId,
          reason: couponIgnored,
        });
      }
    }

    // Validate the reward redemption (ownership + org scope) and compute its
    // discount. The authoritative atomic claim (order_id guard) happens AFTER
    // the order row is inserted, because the order_id FK is not deferrable.
    let redemptionDiscount = 0;
    if (redemptionId) {
      const rd = await applyRedemption({
        redemptionId,
        organizationId,
        customerId: customerId || null,
        orderItems: orderItemsData,
        subtotal,
        couponDiscount: discount,
      }, tx);
      redemptionDiscount = rd.discount;
    }

    discount += redemptionDiscount;

    // IGV se calcula sobre la base imponible (subtotal - descuento)
    const taxableBase = subtotal - discount;
    const tax = Math.round((taxableBase * taxRate) / 10000);
    const total = taxableBase + tax + deliveryFee;

    const [order] = await tx
      .insert(schema.orders)
      .values({
        organization_id: organizationId,
        branch_id: branchId,
        table_session_id: tableSessionId || null,
        customer_id: customerId || null,
        order_number: orderNumber,
        type: type as any,
        status: "pending",
        customer_name: customerName || null,
        subtotal,
        tax,
        discount,
        total,
        notes: notes || null,
        delivery_address: deliveryAddress || null,
        delivery_phone: deliveryPhone || null,
        delivery_fee: deliveryFee,
        delivery_driver_id: deliveryDriverId || null,
      })
      .returning();

    const createdItems = await tx
      .insert(schema.orderItems)
      .values(
        orderItemsData.map(({ modifiers: _mods, ...item }) => ({
          order_id: order.id,
          ...item,
        })),
      )
      .returning();

    // Insert order item modifiers
    for (let i = 0; i < createdItems.length; i++) {
      const itemData = orderItemsData[i];
      if (itemData.modifiers.length > 0) {
        await tx.insert(schema.orderItemModifiers).values(
          itemData.modifiers.map((mod) => ({
            order_item_id: createdItems[i].id,
            modifier_id: mod.modifierId,
            name: mod.name,
            price: mod.price,
          })),
        );
      }
    }

    // Atomically claim the reward redemption now that the order row exists.
    // Guarded on order_id IS NULL so a concurrent order cannot double-spend it;
    // 0 rows => already utilized, which aborts (rolls back) this transaction.
    if (redemptionId) {
      const claimed = await tx
        .update(schema.rewardRedemptions)
        .set({ order_id: order.id })
        .where(
          and(
            eq(schema.rewardRedemptions.id, redemptionId),
            isNull(schema.rewardRedemptions.order_id),
          ),
        )
        .returning({ id: schema.rewardRedemptions.id });

      if (claimed.length === 0) {
        throw new OrderValidationError("Canje ya utilizado");
      }
    }

    // Record coupon redemption.
    // The coupon usage cap was already enforced + current_uses incremented
    // atomically inside applyCoupon — no separate increment here.
    if (couponId) {
      await tx.insert(schema.couponRedemptions).values({
        coupon_id: couponId,
        customer_id: customerId || null,
        order_id: order.id,
        // Solo la parte del cupón: el canje de fidelización tiene su propio
        // registro en reward_redemptions.
        discount_applied: couponDiscount,
      });

      // Update couponAssignment used_at if customer is known
      if (customerId) {
        await tx
          .update(schema.couponAssignments)
          .set({ used_at: new Date() })
          .where(
            and(
              eq(schema.couponAssignments.coupon_id, couponId),
              eq(schema.couponAssignments.customer_id, customerId),
            ),
          );
      }
    }

    return { order, items: createdItems, couponIgnored };
  });
}

// ---------------------------------------------------------------------------
// Coupon discount calculation
// ---------------------------------------------------------------------------

interface ApplyCouponParams {
  couponCode: string;
  organizationId: string;
  orderItems: Array<{ menu_item_id: string; unit_price: number; quantity: number; total: number }>;
  subtotal: number;
  customerId: string | null;
}

type TxOrDb = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Effective per-unit price of an order line INCLUDING its modifiers.
 * Uses line total / quantity so free-item valuations reflect what the
 * customer actually paid per unit, not the bare menu unit_price.
 */
function effectiveUnitPrice(item: { unit_price: number; quantity: number; total: number }): number {
  if (item.quantity > 0) {
    return Math.round(item.total / item.quantity);
  }
  return item.unit_price;
}

/** Línea de pedido, con lo justo para calcular descuentos. Todo en céntimos. */
interface PricedLine {
  menu_item_id: string;
  unit_price: number;
  quantity: number;
  total: number;
}

/**
 * Reglas de un cupón que intervienen en el importe del descuento. Se declara
 * aparte de la fila de `coupons` para poder calcular con ella tanto al crear el
 * pedido como al re-tarifarlo después de anular una línea.
 */
interface CouponRules {
  type: string;
  discount_value: number | null;
  menu_item_id: string | null;
  category_id: string | null;
  buy_quantity: number | null;
  get_quantity: number | null;
  max_discount_amount: number | null;
}

/** Platos de una categoría, para el cupón de tipo `category_discount`. */
async function loadCategoryItemIds(
  tx: TxOrDb,
  categoryId: string,
  organizationId: string,
): Promise<Set<string>> {
  const rows = await tx
    .select({ id: schema.menuItems.id })
    .from(schema.menuItems)
    .where(and(
      eq(schema.menuItems.category_id, categoryId),
      eq(schema.menuItems.organization_id, organizationId),
    ));
  return new Set(rows.map((r) => r.id));
}

/**
 * Descuento EN CÉNTIMOS que produce un cupón sobre un conjunto de líneas.
 *
 * Es la ÚNICA definición del cálculo: la usa `applyCoupon` al crear el pedido y
 * `repriceOrderAfterCancel` al re-tarifarlo tras anular un plato. Que dos
 * caminos calculen el mismo descuento de formas distintas es exactamente lo que
 * convertía un 20 % en un 40 % al hacer un "86".
 *
 * No consulta la base de datos ni valida vigencia/usos: solo aritmética.
 */
function computeCouponDiscountCents(
  coupon: CouponRules,
  orderItems: PricedLine[],
  subtotal: number,
  categoryItemIds: ReadonlySet<string> | null,
): number {
  let discount = 0;

  switch (coupon.type) {
    case "percentage": {
      discount = Math.round(subtotal * ((coupon.discount_value || 0) / 100));
      break;
    }
    case "fixed": {
      // Importe fijo: se recorta al subtotal para que un descuento nunca supere
      // lo que se está comprando.
      discount = Math.min(coupon.discount_value || 0, subtotal);
      break;
    }
    case "item_free": {
      // Make one unit of a qualifying item free. Use the EFFECTIVE per-unit
      // price (includes modifiers): total / quantity.
      if (coupon.menu_item_id) {
        // Specific item must be free
        const match = orderItems.find((i) => i.menu_item_id === coupon.menu_item_id);
        if (match) {
          discount = effectiveUnitPrice(match); // 1 unit free
        }
      } else {
        // No specific item — cheapest item is free
        const cheapest = orderItems.reduce<PricedLine | undefined>(
          (min, i) => (!min || effectiveUnitPrice(i) < effectiveUnitPrice(min) ? i : min),
          undefined,
        );
        if (cheapest) {
          discount = effectiveUnitPrice(cheapest);
        }
      }
      break;
    }
    case "item_discount": {
      // Discount on a specific item
      if (coupon.menu_item_id) {
        const match = orderItems.find((i) => i.menu_item_id === coupon.menu_item_id);
        if (match) {
          discount = Math.round(match.total * ((coupon.discount_value || 0) / 100));
        }
      }
      break;
    }
    case "category_discount": {
      // Discount on items in a category — need to check category
      if (coupon.category_id && categoryItemIds) {
        const matchingTotal = orderItems
          .filter((i) => categoryItemIds.has(i.menu_item_id))
          .reduce((sum, i) => sum + i.total, 0);
        discount = Math.round(matchingTotal * ((coupon.discount_value || 0) / 100));
      }
      break;
    }
    case "buy_x_get_y": {
      // Buy X items, get Y free (cheapest ones). Use the EFFECTIVE per-unit
      // price (includes modifiers) for each free unit.
      const totalQty = orderItems.reduce((sum, i) => sum + i.quantity, 0);
      const buyQty = coupon.buy_quantity || 0;
      const getQty = coupon.get_quantity || 0;
      if (totalQty >= buyQty + getQty) {
        // Sort units by effective unit price ascending, make the cheapest
        // getQty units free.
        const expanded = orderItems.flatMap((i) =>
          Array.from({ length: i.quantity }, () => effectiveUnitPrice(i)),
        );
        expanded.sort((a, b) => a - b);
        discount = expanded.slice(0, getQty).reduce((sum, p) => sum + p, 0);
      }
      break;
    }
  }

  // Apply max discount cap
  if (coupon.max_discount_amount && discount > coupon.max_discount_amount) {
    discount = coupon.max_discount_amount;
  }

  // Ensure discount doesn't exceed subtotal
  return Math.max(0, Math.min(discount, subtotal));
}

async function applyCoupon(
  params: ApplyCouponParams,
  tx: TxOrDb,
): Promise<{ discount: number; couponId: string | null; ignoredReason: string | null }> {
  const { couponCode, organizationId, orderItems, subtotal, customerId } = params;

  const [coupon] = await tx
    .select()
    .from(schema.coupons)
    .where(
      and(
        eq(schema.coupons.organization_id, organizationId),
        eq(schema.coupons.code, couponCode.toUpperCase()),
        eq(schema.coupons.status, "active"),
      ),
    )
    .limit(1);

  if (!coupon) {
    throw new OrderValidationError("Cupón no encontrado o inactivo");
  }

  // A per-customer limit cannot be enforced for anonymous orders — reject.
  if (coupon.max_uses_per_customer && !customerId) {
    throw new OrderValidationError(
      "Este cupón requiere identificar al cliente para aplicarse",
    );
  }

  // Validate per-customer usage limit under a coupon row lock so concurrent
  // orders by the same customer are serialized for this coupon.
  if (coupon.max_uses_per_customer && customerId) {
    // Lock the coupon row to serialize concurrent redemptions of this coupon.
    await tx
      .select({ id: schema.coupons.id })
      .from(schema.coupons)
      .where(eq(schema.coupons.id, coupon.id))
      .limit(1)
      .for("update");

    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.couponRedemptions)
      .where(
        and(
          eq(schema.couponRedemptions.coupon_id, coupon.id),
          eq(schema.couponRedemptions.customer_id, customerId),
        ),
      );
    if (count >= coupon.max_uses_per_customer) {
      throw new OrderValidationError("Ya usaste este cupón el máximo de veces permitido");
    }
  }

  // Validate date range
  const now = new Date();
  if (coupon.starts_at && now < coupon.starts_at) {
    throw new OrderValidationError("El cupón aún no está vigente");
  }
  if (coupon.expires_at && now > coupon.expires_at) {
    throw new OrderValidationError("El cupón ha expirado");
  }

  // Validate min order amount
  if (coupon.min_order_amount && subtotal < coupon.min_order_amount) {
    throw new OrderValidationError(
      `El pedido mínimo para este cupón es S/ ${(coupon.min_order_amount / 100).toFixed(2)}`,
    );
  }

  const categoryItemIds =
    coupon.type === "category_discount" && coupon.category_id
      ? await loadCategoryItemIds(tx, coupon.category_id, organizationId)
      : null;

  const discount = computeCouponDiscountCents(coupon, orderItems, subtotal, categoryItemIds);

  // Cupón que no produce ningún descuento sobre ESTE carrito (el plato de la
  // promoción no está, el 2x1 no llega a la cantidad mínima, la categoría no
  // aparece...). Antes se lanzaba un error y el comensal se quedaba SIN PODER
  // PEDIR hasta adivinar cuál de sus cupones sobraba. Ahora el pedido pasa, el
  // cupón NO se consume (no se incrementa current_uses ni se registra canje) y
  // el motivo vuelve al llamador para que la pantalla lo cuente.
  if (discount <= 0) {
    return {
      discount: 0,
      couponId: null,
      ignoredReason: "El cupón no aplica a los productos de este pedido",
    };
  }

  // Atomically claim a use of this coupon, enforcing the total cap in the same
  // statement. If max_uses_total is set, only increment when current_uses is
  // still below it; 0 rows returned => the cap was reached (race-safe).
  const claimed = await tx
    .update(schema.coupons)
    .set({ current_uses: sql`${schema.coupons.current_uses} + 1` })
    .where(
      and(
        eq(schema.coupons.id, coupon.id),
        coupon.max_uses_total != null
          ? sql`${schema.coupons.current_uses} < ${coupon.max_uses_total}`
          : sql`true`,
      ),
    )
    .returning({ id: schema.coupons.id });

  if (claimed.length === 0) {
    throw new OrderValidationError("El cupón ha alcanzado el límite de usos");
  }

  return { discount, couponId: coupon.id, ignoredReason: null };
}

// ---------------------------------------------------------------------------
// Reward redemption discount calculation
// ---------------------------------------------------------------------------

interface ApplyRedemptionParams {
  redemptionId: string;
  organizationId: string;
  customerId: string | null;
  orderItems: Array<{ menu_item_id: string; unit_price: number; quantity: number; total: number }>;
  subtotal: number;
  couponDiscount: number;
}

/**
 * Validates a reward redemption (ownership + org scope + not-yet-used) and
 * computes its discount. Locks the redemption row FOR UPDATE so the eventual
 * atomic claim (order_id guard, performed by the caller after order insert) is
 * race-free. Does NOT mutate the redemption.
 *
 * The discount is computed from the SNAPSHOT columns stored on the redemption
 * row at redeem time (reward_type / discount_type / discount_value /
 * menu_item_id), NOT from the live rewards table — so an admin editing or
 * deactivating the reward after redemption can never retroactively change the
 * value of an already-claimed redemption.
 */
async function applyRedemption(params: ApplyRedemptionParams, tx: TxOrDb): Promise<{ discount: number }> {
  const { redemptionId, organizationId, customerId, orderItems, subtotal, couponDiscount } = params;

  // A redemption can only be applied when we can verify its owner.
  if (!customerId) {
    throw new OrderValidationError("Se requiere identificar al cliente para aplicar un canje");
  }

  // Verify the redemption belongs to this customer AND this organization,
  // resolving the owning org via customer_loyalty -> program -> organization_id.
  // FOR UPDATE OF reward_redemptions locks the redemption row to serialize
  // concurrent attempts to use it. We read the SNAPSHOT value columns off the
  // redemption itself (not the rewards table) so post-redeem reward edits cannot
  // change an already-claimed redemption's value.
  const [redemption] = await tx
    .select({
      id: schema.rewardRedemptions.id,
      order_id: schema.rewardRedemptions.order_id,
      customer_id: schema.customerLoyalty.customer_id,
      organization_id: schema.loyaltyPrograms.organization_id,
      reward_type: schema.rewardRedemptions.reward_type,
      discount_type: schema.rewardRedemptions.discount_type,
      discount_value: schema.rewardRedemptions.discount_value,
      menu_item_id: schema.rewardRedemptions.menu_item_id,
    })
    .from(schema.rewardRedemptions)
    .innerJoin(
      schema.customerLoyalty,
      eq(schema.rewardRedemptions.customer_loyalty_id, schema.customerLoyalty.id),
    )
    .innerJoin(
      schema.loyaltyPrograms,
      eq(schema.customerLoyalty.program_id, schema.loyaltyPrograms.id),
    )
    .where(eq(schema.rewardRedemptions.id, redemptionId))
    .limit(1)
    .for("update", { of: schema.rewardRedemptions });

  if (!redemption) {
    throw new OrderValidationError("Canje no encontrado");
  }

  // Tenant scope: redemption's owning org must match the order's org.
  if (redemption.organization_id !== organizationId) {
    throw new OrderValidationError("Este canje no pertenece a esta organización");
  }

  // Ownership: redemption must belong to this customer.
  if (redemption.customer_id !== customerId) {
    throw new OrderValidationError("Este canje no te pertenece");
  }

  // Already used (order linked) => reject early. The authoritative atomic claim
  // happens in the caller after the order is inserted (FK is not deferrable).
  if (redemption.order_id) {
    throw new OrderValidationError("Canje ya utilizado");
  }

  // Calculate discount on the remaining amount after coupon, using the
  // snapshot value columns captured at redeem time.
  const discount = computeRedemptionDiscountCents(
    redemption,
    orderItems,
    subtotal - couponDiscount,
  );

  return { discount };
}

/** Valores congelados del canje en el momento de canjear. */
interface RedemptionSnapshot {
  reward_type: string;
  discount_type: string | null;
  discount_value: number | null;
  menu_item_id: string | null;
}

/**
 * Descuento EN CÉNTIMOS que produce un canje de fidelización sobre la base que
 * queda tras el cupón. Única definición del cálculo: la usan `applyRedemption`
 * (al crear el pedido) y `repriceOrderAfterCancel` (al anular un plato).
 */
function computeRedemptionDiscountCents(
  redemption: RedemptionSnapshot,
  orderItems: PricedLine[],
  remainingSubtotal: number,
): number {
  if (remainingSubtotal <= 0) return 0;

  let discount = 0;

  if (redemption.reward_type === "free_item") {
    // One unit of the snapshotted menu item is free, valued at its EFFECTIVE
    // per-unit price (incl. modifiers) IF that item is present in this order;
    // otherwise the reward yields no discount here.
    if (redemption.menu_item_id) {
      const match = orderItems.find((i) => i.menu_item_id === redemption.menu_item_id);
      discount = match ? effectiveUnitPrice(match) : 0;
    } else {
      discount = 0;
    }
  } else if (redemption.discount_type === "percentage") {
    discount = Math.round(remainingSubtotal * ((redemption.discount_value || 0) / 100));
  } else {
    // fixed amount (discount_type === "fixed" or null fallback)
    discount = Math.min(redemption.discount_value || 0, remainingSubtotal);
  }

  return Math.max(0, Math.min(discount, remainingSubtotal));
}

// ---------------------------------------------------------------------------
// Re-tarifado tras anular una línea ("86" de cocina)
// ---------------------------------------------------------------------------

/** Importes de la orden ya recalculados. Todo en céntimos enteros. */
export interface RepricedOrderTotals {
  subtotal: number;
  discount: number;
  tax: number;
  delivery_fee: number;
  total: number;
  /** true cuando no queda ninguna línea viva: la orden entera se anula. */
  allCancelled: boolean;
  /**
   * Fila de `coupon_redemptions` cuyo `discount_applied` queda desfasado con el
   * nuevo cálculo. NO se escribe aquí: el re-tarifado es de solo lectura para
   * que el llamador pueda validar antes de tocar nada (devolver un error desde
   * el callback de una transacción de Drizzle NO la aborta). Se persiste con
   * `persistRepricedDiscount` ya en la fase de escritura.
   */
  couponRedemptionUpdate: { id: string; discount_applied: number } | null;
}

/**
 * Escribe los efectos colaterales del re-tarifado que caen FUERA de la fila
 * `orders` (hoy, el importe registrado del canje de cupón). Se llama en la fase
 * de escritura, junto al UPDATE de la orden y dentro de la misma transacción.
 */
export async function persistRepricedDiscount(
  totals: RepricedOrderTotals,
  tx: TxOrDb,
): Promise<void> {
  const pendiente = totals.couponRedemptionUpdate;
  if (!pendiente) return;
  await tx
    .update(schema.couponRedemptions)
    .set({ discount_applied: pendiente.discount_applied })
    .where(eq(schema.couponRedemptions.id, pendiente.id));
}

/**
 * Recalcula los importes de una orden cuando desaparecen líneas.
 *
 * Es la ÚNICA implementación del recálculo: la anulación de cocina y cualquier
 * otro camino que anule una línea deben llamarla, porque dos caminos que
 * calculen el mismo total con reglas distintas son una bomba contable.
 *
 * La clave es que el descuento NO se arrastra como importe absoluto: se vuelve
 * a calcular con las mismas funciones que lo calcularon al crear el pedido, a
 * partir del cupón y del canje realmente aplicados. Arrastrarlo convertía un
 * cupón del 20 % en un 40 % en cuanto se anulaba la mitad de la comanda.
 *
 * Debe llamarse DENTRO de la transacción que ya bloqueó la fila de la orden
 * (`SELECT ... FOR UPDATE`): esa es la que serializa cobros y anulaciones.
 *
 * @param params.excludeItemIds líneas que van a anularse pero que todavía no se
 *   han escrito, para poder validar los importes ANTES de tocar nada.
 */
export async function repriceOrderAfterCancel(
  params: {
    orderId: string;
    organizationId: string;
    branchId: string;
    /** Descuento guardado hoy en la orden: techo del recalculado. */
    previousDiscount: number;
    deliveryFee: number;
    excludeItemIds?: string[];
    /**
     * El pedido CRECIÓ: se añadieron líneas en vez de anularlas.
     *
     * Cambia una sola cosa, y es de dinero: el techo del descuento. Al anular,
     * un cupón del 20 % no puede subir —sería regalar más por servir menos— y
     * por eso el importe guardado hace de tope. Al AÑADIR, ese mismo tope
     * congelaría el descuento en el valor del pedido pequeño, y el comensal
     * perdería en silencio parte de su cupón por el simple hecho de haber
     * pedido en dos veces en lugar de una.
     */
    ampliacion?: boolean;
  },
  tx: TxOrDb,
): Promise<RepricedOrderTotals> {
  const { orderId, organizationId, branchId, previousDiscount, deliveryFee } = params;
  const excluded = new Set(params.excludeItemIds ?? []);

  // `order_items.total` YA incluye el precio de los modificadores de la línea,
  // de modo que sumar las líneas que sobreviven descuenta la línea anulada Y
  // sus modificadores.
  const allLines = await tx
    .select({
      id: schema.orderItems.id,
      menu_item_id: schema.orderItems.menu_item_id,
      unit_price: schema.orderItems.unit_price,
      quantity: schema.orderItems.quantity,
      total: schema.orderItems.total,
    })
    .from(schema.orderItems)
    .where(and(
      eq(schema.orderItems.order_id, orderId),
      ne(schema.orderItems.status, "cancelled"),
    ));

  const survivors: PricedLine[] = allLines.filter((l) => !excluded.has(l.id));
  const allCancelled = survivors.length === 0;
  const subtotal = survivors.reduce((acc, l) => acc + l.total, 0);

  // Si no queda nada que servir no se cobra nada: ni impuesto, ni reparto.
  if (allCancelled) {
    // El importe registrado del cupón también baja a cero. Si no, el caso MÁS
    // frecuente del "86" —comanda de un solo plato que se agota— dejaba en
    // `coupon_redemptions` un descuento de S/ 20 atribuido a una comanda que se
    // anuló entera, y el informe de cupones contaba dinero que nunca se regaló.
    const couponRow =
      previousDiscount > 0
        ? await loadOrderCouponRedemption(orderId, organizationId, tx)
        : null;
    return {
      subtotal: 0,
      discount: 0,
      tax: 0,
      delivery_fee: 0,
      total: 0,
      allCancelled: true,
      couponRedemptionUpdate: couponRow
        ? { id: couponRow.redemption_id, discount_applied: 0 }
        : null,
    };
  }

  // Tasa de impuesto de la SEDE (no 18 % cableado: hay locales exonerados y la
  // tasa puede cambiar por norma).
  const [branch] = await tx
    .select({ tax_rate: schema.branches.tax_rate })
    .from(schema.branches)
    .where(and(
      eq(schema.branches.id, branchId),
      eq(schema.branches.organization_id, organizationId),
    ))
    .limit(1);
  const taxRate = branch?.tax_rate ?? 1800;

  const { discount, couponRedemptionUpdate } = await recomputeOrderDiscount(
    { orderId, organizationId, survivors, subtotal, previousDiscount, ampliacion: params.ampliacion },
    tx,
  );

  const taxableBase = subtotal - discount;
  const tax = Math.round((taxableBase * taxRate) / 10000);
  const total = taxableBase + tax + deliveryFee;

  return {
    subtotal,
    discount,
    tax,
    delivery_fee: deliveryFee,
    total,
    allCancelled: false,
    couponRedemptionUpdate,
  };
}

/**
 * Vuelve a calcular el descuento de una orden sobre las líneas que sobreviven.
 *
 * Relee el cupón y el canje que se aplicaron de verdad (coupon_redemptions y
 * reward_redemptions) y repite su aritmética sobre el nuevo subtotal: un
 * porcentaje se recalcula, un importe fijo se recorta. Si la orden tiene un
 * descuento cuyo origen no consta (carga manual, migración antigua) se conserva
 * el comportamiento anterior: recortarlo al nuevo subtotal.
 *
 * El resultado nunca supera el descuento que ya tenía la orden: así una edición
 * del cupón posterior al pedido no puede inflar retroactivamente lo que se
 * regala.
 *
 * Solo lee: el ajuste pendiente de `coupon_redemptions.discount_applied` vuelve
 * como dato para que el llamador lo escriba cuando ya no pueda echarse atrás.
 */
async function recomputeOrderDiscount(
  params: {
    orderId: string;
    organizationId: string;
    survivors: PricedLine[];
    subtotal: number;
    previousDiscount: number;
    ampliacion?: boolean;
  },
  tx: TxOrDb,
): Promise<{
  discount: number;
  couponRedemptionUpdate: { id: string; discount_applied: number } | null;
}> {
  const { orderId, organizationId, survivors, subtotal, previousDiscount } = params;

  if (previousDiscount <= 0) return { discount: 0, couponRedemptionUpdate: null };

  // ── Cupón ────────────────────────────────────────────────────────────────
  const couponRow = await loadOrderCouponRedemption(orderId, organizationId, tx);

  let couponDiscount = 0;
  let couponRedemptionUpdate: { id: string; discount_applied: number } | null = null;
  if (couponRow) {
    const categoryItemIds =
      couponRow.type === "category_discount" && couponRow.category_id
        ? await loadCategoryItemIds(tx, couponRow.category_id, organizationId)
        : null;
    couponDiscount = computeCouponDiscountCents(couponRow, survivors, subtotal, categoryItemIds);

    // El canje registrado debe reflejar lo que de verdad se descontó, o los
    // informes de cupones seguirán contando el importe viejo.
    couponRedemptionUpdate = {
      id: couponRow.redemption_id,
      discount_applied: couponDiscount,
    };
  }

  // ── Canje de fidelización ────────────────────────────────────────────────
  const [redemptionRow] = await tx
    .select({
      reward_type: schema.rewardRedemptions.reward_type,
      discount_type: schema.rewardRedemptions.discount_type,
      discount_value: schema.rewardRedemptions.discount_value,
      menu_item_id: schema.rewardRedemptions.menu_item_id,
    })
    .from(schema.rewardRedemptions)
    .where(eq(schema.rewardRedemptions.order_id, orderId))
    .limit(1);

  const redemptionDiscount = redemptionRow
    ? computeRedemptionDiscountCents(redemptionRow, survivors, subtotal - couponDiscount)
    : 0;

  // Descuento de origen desconocido: no hay regla que reaplicar, así que se
  // mantiene la única garantía posible (no superar lo que se está comprando).
  if (!couponRow && !redemptionRow) {
    return { discount: Math.min(previousDiscount, subtotal), couponRedemptionUpdate: null };
  }

  const recomputed = couponDiscount + redemptionDiscount;
  // Al ampliar, el único límite es lo que se está comprando: la regla del cupón
  // ya se ha vuelto a aplicar sobre el subtotal nuevo, con sus propios topes.
  const discount = params.ampliacion
    ? Math.max(0, Math.min(recomputed, subtotal))
    : Math.max(0, Math.min(recomputed, subtotal, previousDiscount));

  // Lo registrado en `coupon_redemptions` no puede superar el descuento que de
  // verdad se aplicó a la orden: el tope de `previousDiscount` puede haber
  // recortado el recálculo, y sin este ajuste el informe de cupones diría que se
  // regaló más de lo que se restó del total.
  if (couponRedemptionUpdate && couponRedemptionUpdate.discount_applied > discount) {
    couponRedemptionUpdate.discount_applied = discount;
  }

  return { discount, couponRedemptionUpdate };
}

/**
 * Cupón realmente aplicado a una orden, con las reglas necesarias para volver a
 * calcular su descuento. Acotado por organización: un canje solo cuenta si su
 * cupón pertenece al mismo local.
 */
async function loadOrderCouponRedemption(
  orderId: string,
  organizationId: string,
  tx: TxOrDb,
): Promise<(CouponRules & { redemption_id: string }) | null> {
  const [row] = await tx
    .select({
      redemption_id: schema.couponRedemptions.id,
      type: schema.coupons.type,
      discount_value: schema.coupons.discount_value,
      menu_item_id: schema.coupons.menu_item_id,
      category_id: schema.coupons.category_id,
      buy_quantity: schema.coupons.buy_quantity,
      get_quantity: schema.coupons.get_quantity,
      max_discount_amount: schema.coupons.max_discount_amount,
    })
    .from(schema.couponRedemptions)
    .innerJoin(schema.coupons, eq(schema.couponRedemptions.coupon_id, schema.coupons.id))
    .where(and(
      eq(schema.couponRedemptions.order_id, orderId),
      eq(schema.coupons.organization_id, organizationId),
    ))
    .limit(1);

  return row ?? null;
}

/**
 * Handles side effects when an order transitions to "completed":
 * - Awards loyalty points (if customer has enrollment) on the taxable base
 *   (subtotal - discount), excluding tax and delivery fee.
 * - Deducts inventory (idempotent; re-checked inside the inventory service tx).
 *
 * Idempotency is provided downstream: awardPoints skips if a transaction already
 * exists for the order, and deductForOrder is guarded inside its own transaction.
 * We therefore do NOT pre-gate on the (potentially stale) inventory_deducted flag.
 */
export async function handleOrderCompletion(params: {
  orderId: string;
  orderNumber: string;
  /** @deprecated retained for callers; loyalty no longer uses gross total */
  orderTotal?: number;
  orderSubtotal: number;
  orderDiscount: number;
  customerId: string | null;
  organizationId: string;
  branchId: string;
  /** @deprecated stale-prone; not used to gate deduction anymore */
  inventoryDeducted?: boolean;
}): Promise<void> {
  const {
    orderId,
    orderNumber,
    orderSubtotal,
    orderDiscount,
    customerId,
    organizationId,
    branchId,
  } = params;

  // Loyalty earns on the taxable base (subtotal - discount), excluding tax/delivery.
  const loyaltyBase = Math.max(0, orderSubtotal - orderDiscount);

  // Award loyalty points
  if (customerId) {
    try {
      await awardPoints({
        customerId,
        orderId,
        orderTotal: loyaltyBase,
        orderNumber,
        organizationId,
      });
    } catch (err) {
      logger.error("Error awarding loyalty points", { orderId, error: (err as Error).message });
    }
  }

  // Deduct inventory. Completion stays non-blocking: deductForOrder is idempotent
  // (guarded inside its own transaction), so we call it unconditionally rather
  // than gating on the caller-passed (stale) inventory_deducted flag.
  try {
    await deductForOrder({
      orderId,
      orderNumber,
      branchId,
    });
  } catch (err) {
    if (err instanceof InsufficientStockError) {
      // Non-blocking: completion still succeeds, but flag for operator attention.
      logger.warn(
        "Order completed but inventory deduction skipped due to insufficient stock",
        {
          orderId,
          orderNumber,
          item: err.itemName,
          required: err.required,
          available: err.available,
        },
      );
    } else {
      logger.error("Inventory deduction error", { orderId, error: (err as Error).message });
    }
  }
}

/**
 * Custom error class for order validation failures.
 * Route handlers catch this to return 400 responses.
 */
export class OrderValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderValidationError";
  }
}
