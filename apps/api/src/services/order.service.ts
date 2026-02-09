import { eq, and, inArray, sql, isNull } from "drizzle-orm";
import { db, schema } from "@restai/db";
import { generateOrderNumber } from "../lib/id.js";
import { logger } from "../lib/logger.js";
import { awardPoints } from "./loyalty.service.js";
import { deductForOrder } from "./inventory.service.js";

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
  } = params;

  // Get menu items for price calculation
  const menuItemIds = items.map((i) => i.menuItemId);
  const menuItemsResult = await db
    .select()
    .from(schema.menuItems)
    .where(inArray(schema.menuItems.id, menuItemIds));

  const menuItemMap = new Map(menuItemsResult.map((mi) => [mi.id, mi]));

  // Collect all modifier IDs and fetch their prices
  const allModifierIds = items.flatMap(
    (i) => i.modifiers?.map((m) => m.modifierId) || [],
  );

  let modifierMap = new Map<
    string,
    { id: string; name: string; price: number }
  >();
  if (allModifierIds.length > 0) {
    const modifierRecords = await db
      .select({
        id: schema.modifiers.id,
        name: schema.modifiers.name,
        price: schema.modifiers.price,
      })
      .from(schema.modifiers)
      .where(inArray(schema.modifiers.id, allModifierIds));
    modifierMap = new Map(modifierRecords.map((m) => [m.id, m]));
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

    let modifierPricePerUnit = 0;
    if (item.modifiers?.length) {
      for (const mod of item.modifiers) {
        const modifier = modifierMap.get(mod.modifierId);
        if (modifier) modifierPricePerUnit += modifier.price;
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

  // Create order + items + coupon redemption in a transaction
  // Coupon validation is INSIDE the transaction to prevent race conditions on current_uses
  return await db.transaction(async (tx) => {
    // Calculate coupon discount inside tx
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

    // Apply reward redemption discount (stacks with coupon)
    let redemptionDiscount = 0;
    if (redemptionId) {
      const rd = await applyRedemption({ redemptionId, customerId: customerId || null, subtotal, couponDiscount: discount }, tx);
      redemptionDiscount = rd.discount;
    }

    discount += redemptionDiscount;

    // IGV se calcula sobre la base imponible (subtotal - descuento)
    const taxableBase = subtotal - discount;
    const tax = Math.round((taxableBase * taxRate) / 10000);
    const total = taxableBase + tax;

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

    // Link reward redemption to order
    if (redemptionId && redemptionDiscount > 0) {
      await tx
        .update(schema.rewardRedemptions)
        .set({ order_id: order.id })
        .where(eq(schema.rewardRedemptions.id, redemptionId));
    }

    // Record coupon redemption
    if (couponId) {
      await tx.insert(schema.couponRedemptions).values({
        coupon_id: couponId,
        customer_id: customerId || null,
        order_id: order.id,
        discount_applied: discount,
      });
      // Increment current_uses
      await tx
        .update(schema.coupons)
        .set({ current_uses: sql`${schema.coupons.current_uses} + 1` })
        .where(eq(schema.coupons.id, couponId));

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

  // Validate usage limits
  if (coupon.max_uses_total && coupon.current_uses >= coupon.max_uses_total) {
    throw new OrderValidationError("El cupón ha alcanzado el límite de usos");
  }

  // Validate per-customer usage limit
  if (coupon.max_uses_per_customer && customerId) {
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
      // Make one unit of a qualifying item free
      if (coupon.menu_item_id) {
        // Specific item must be free
        const match = orderItems.find((i) => i.menu_item_id === coupon.menu_item_id);
        if (match) {
          discount = match.unit_price; // 1 unit free
        }
      } else {
        // No specific item — cheapest item is free
        const cheapest = orderItems.reduce(
          (min, i) => (i.unit_price < min.unit_price ? i : min),
          orderItems[0],
        );
        if (cheapest) {
          discount = cheapest.unit_price;
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
          .where(eq(schema.menuItems.category_id, coupon.category_id));
        const catIds = new Set(categoryItemIds.map((c) => c.id));
        const matchingTotal = orderItems
          .filter((i) => catIds.has(i.menu_item_id))
          .reduce((sum, i) => sum + i.total, 0);
        discount = Math.round(matchingTotal * ((coupon.discount_value || 0) / 100));
      }
      break;
    }
    case "buy_x_get_y": {
      // Buy X items, get Y free (cheapest ones)
      const totalQty = orderItems.reduce((sum, i) => sum + i.quantity, 0);
      const buyQty = coupon.buy_quantity || 0;
      const getQty = coupon.get_quantity || 0;
      if (totalQty >= buyQty + getQty) {
        // Sort items by unit price ascending, make the cheapest getQty items free
        const expanded = orderItems.flatMap((i) =>
          Array.from({ length: i.quantity }, () => i.unit_price),
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

  return { discount, couponId: coupon.id };
}

// ---------------------------------------------------------------------------
// Reward redemption discount calculation
// ---------------------------------------------------------------------------

interface ApplyRedemptionParams {
  redemptionId: string;
  customerId: string | null;
  subtotal: number;
  couponDiscount: number;
}

async function applyRedemption(params: ApplyRedemptionParams, tx: TxOrDb): Promise<{ discount: number }> {
  const { redemptionId, customerId, subtotal, couponDiscount } = params;

  // Fetch the pending redemption (order_id IS NULL = not yet used)
  const [redemption] = await tx
    .select({
      id: schema.rewardRedemptions.id,
      customer_loyalty_id: schema.rewardRedemptions.customer_loyalty_id,
      discount_type: schema.rewards.discount_type,
      discount_value: schema.rewards.discount_value,
    })
    .from(schema.rewardRedemptions)
    .innerJoin(schema.rewards, eq(schema.rewardRedemptions.reward_id, schema.rewards.id))
    .where(
      and(
        eq(schema.rewardRedemptions.id, redemptionId),
        isNull(schema.rewardRedemptions.order_id),
      ),
    )
    .limit(1);

  if (!redemption) {
    throw new OrderValidationError("Canje no encontrado o ya fue utilizado");
  }

  // Validate ownership: redemption must belong to this customer
  if (customerId) {
    const [enrollment] = await tx
      .select({ customer_id: schema.customerLoyalty.customer_id })
      .from(schema.customerLoyalty)
      .where(eq(schema.customerLoyalty.id, redemption.customer_loyalty_id))
      .limit(1);

    if (!enrollment || enrollment.customer_id !== customerId) {
      throw new OrderValidationError("Este canje no te pertenece");
    }
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
 * - Awards loyalty points (if customer has enrollment)
 * - Deducts inventory (if enabled and not already deducted)
 */
export async function handleOrderCompletion(params: {
  orderId: string;
  orderNumber: string;
  orderTotal: number;
  customerId: string | null;
  organizationId: string;
  branchId: string;
  inventoryDeducted: boolean;
}): Promise<void> {
  const {
    orderId,
    orderNumber,
    orderTotal,
    customerId,
    organizationId,
    branchId,
    inventoryDeducted,
  } = params;

  // Award loyalty points
  if (customerId) {
    try {
      await awardPoints({
        customerId,
        orderId,
        orderTotal,
        orderNumber,
        organizationId,
      });
    } catch (err) {
      logger.error("Error awarding loyalty points", { orderId, error: (err as Error).message });
    }
  }

  // Deduct inventory
  if (!inventoryDeducted) {
    try {
      await deductForOrder({
        orderId,
        orderNumber,
        branchId,
      });
    } catch (err) {
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
