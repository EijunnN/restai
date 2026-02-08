import { eq, and, inArray, sql } from "drizzle-orm";
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
  } = params;

  // Get menu items for price calculation
  const menuItemIds = items.map((i) => i.menuItemId);
  const menuItemsResult = await db
    .select()
    .from(schema.menuItems)
    .where(inArray(schema.menuItems.id, menuItemIds));

  const menuItemMap = new Map(menuItemsResult.map((mi) => [mi.id, mi]));

  // Validate items and calculate totals
  let subtotal = 0;
  const orderItemsData: Array<{
    menu_item_id: string;
    name: string;
    unit_price: number;
    quantity: number;
    total: number;
    notes?: string;
  }> = [];

  for (const item of items) {
    const menuItem = menuItemMap.get(item.menuItemId);
    if (!menuItem) {
      throw new OrderValidationError(`Item no encontrado: ${item.menuItemId}`);
    }
    if (!menuItem.is_available) {
      throw new OrderValidationError(`Item no disponible: ${menuItem.name}`);
    }

    const itemTotal = menuItem.price * item.quantity;
    subtotal += itemTotal;

    orderItemsData.push({
      menu_item_id: menuItem.id,
      name: menuItem.name,
      unit_price: menuItem.price,
      quantity: item.quantity,
      total: itemTotal,
      notes: item.notes,
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
        orderItemsData.map((item) => ({
          order_id: order.id,
          ...item,
        })),
      )
      .returning();

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
