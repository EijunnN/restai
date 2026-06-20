import { eq, and, inArray, sql, isNull } from "drizzle-orm";
import { db, schema } from "@restai/db";
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
}

/**
 * Validates menu items and creates an order with its items.
 * Returns the created order and items, or throws an error if validation fails.
 */
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

  // Get menu items for price calculation (exclude soft-deleted, scope to tenant)
  const menuItemIds = items.map((i) => i.menuItemId);
  const menuItemsResult = await db
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
    const modifierRecords = await db
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
    const linkedGroups = await db
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
    modifiers: Array<{ modifierId: string }>;
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
      modifiers: item.modifiers || [],
    });
  }

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
    let couponId: string | null = null;

    if (couponCode) {
      const couponResult = await applyCoupon({
        couponCode,
        organizationId,
        orderItems: orderItemsData,
        subtotal,
        customerId: customerId || null,
      }, tx);
      discount = couponResult.discount;
      couponId = couponResult.couponId;
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
          itemData.modifiers.map((mod) => {
            const modifier = modifierMap.get(mod.modifierId);
            return {
              order_item_id: createdItems[i].id,
              modifier_id: mod.modifierId,
              name: modifier?.name || "Modificador",
              price: modifier?.price || 0,
            };
          }),
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
        discount_applied: discount,
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

    return { order, items: createdItems };
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

async function applyCoupon(params: ApplyCouponParams, tx: TxOrDb): Promise<{ discount: number; couponId: string }> {
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

  let discount = 0;

  switch (coupon.type) {
    case "percentage": {
      discount = Math.round(subtotal * ((coupon.discount_value || 0) / 100));
      break;
    }
    case "fixed": {
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
        const cheapest = orderItems.reduce(
          (min, i) => (effectiveUnitPrice(i) < effectiveUnitPrice(min) ? i : min),
          orderItems[0],
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
      if (coupon.category_id) {
        const categoryItemIds = await tx
          .select({ id: schema.menuItems.id })
          .from(schema.menuItems)
          .where(and(
            eq(schema.menuItems.category_id, coupon.category_id),
            eq(schema.menuItems.organization_id, organizationId),
          ));
        const catIds = new Set(categoryItemIds.map((c) => c.id));
        const matchingTotal = orderItems
          .filter((i) => catIds.has(i.menu_item_id))
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
  discount = Math.min(discount, subtotal);

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

  return { discount, couponId: coupon.id };
}

// ---------------------------------------------------------------------------
// Reward redemption discount calculation
// ---------------------------------------------------------------------------

interface ApplyRedemptionParams {
  redemptionId: string;
  organizationId: string;
  customerId: string | null;
  subtotal: number;
  couponDiscount: number;
}

/**
 * Validates a reward redemption (ownership + org scope + not-yet-used) and
 * computes its discount. Locks the redemption row FOR UPDATE so the eventual
 * atomic claim (order_id guard, performed by the caller after order insert) is
 * race-free. Does NOT mutate the redemption.
 */
async function applyRedemption(params: ApplyRedemptionParams, tx: TxOrDb): Promise<{ discount: number }> {
  const { redemptionId, organizationId, customerId, subtotal, couponDiscount } = params;

  // A redemption can only be applied when we can verify its owner.
  if (!customerId) {
    throw new OrderValidationError("Se requiere identificar al cliente para aplicar un canje");
  }

  // Verify the redemption belongs to this customer AND this organization,
  // resolving the owning org via customer_loyalty -> program -> organization_id.
  // FOR UPDATE OF reward_redemptions locks the redemption row to serialize
  // concurrent attempts to use it.
  const [redemption] = await tx
    .select({
      id: schema.rewardRedemptions.id,
      order_id: schema.rewardRedemptions.order_id,
      customer_id: schema.customerLoyalty.customer_id,
      organization_id: schema.loyaltyPrograms.organization_id,
      discount_type: schema.rewards.discount_type,
      discount_value: schema.rewards.discount_value,
    })
    .from(schema.rewardRedemptions)
    .innerJoin(schema.rewards, eq(schema.rewardRedemptions.reward_id, schema.rewards.id))
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

  // Calculate discount on the remaining amount after coupon
  const remainingSubtotal = subtotal - couponDiscount;
  let discount = 0;

  if (redemption.discount_type === "percentage") {
    discount = Math.round(remainingSubtotal * (redemption.discount_value / 100));
  } else {
    // fixed amount
    discount = Math.min(redemption.discount_value, remainingSubtotal);
  }

  discount = Math.max(0, Math.min(discount, remainingSubtotal));

  return { discount };
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
