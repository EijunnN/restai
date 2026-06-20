import { z } from "zod";

// Auth validators
export const loginSchema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
});

export const registerOrgSchema = z.object({
  organizationName: z.string().min(2, "Nombre muy corto").max(255),
  slug: z.string().min(2).max(100).regex(/^[a-z0-9-]+$/, "Solo letras minúsculas, números y guiones"),
  email: z.string().email("Email inválido"),
  password: z.string().min(8, "Mínimo 8 caracteres"),
  name: z.string().min(2, "Nombre muy corto").max(255),
});

export const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2).max(255),
  role: z.enum(["org_admin", "branch_manager", "cashier", "waiter", "kitchen"]),
  branchIds: z.array(z.string().uuid()).min(1, "Debe asignar al menos una sede"),
});

// Branch validators
export const createBranchSchema = z.object({
  name: z.string().min(2).max(255),
  slug: z.string().min(2).max(100).regex(/^[a-z0-9-]+$/),
  address: z.string().max(500).optional(),
  phone: z.string().max(20).optional(),
  timezone: z.string().default("America/Lima"),
  currency: z.string().length(3).default("PEN"),
  taxRate: z.number().int().min(0).max(10000).default(1800),
});

export const updateBranchSchema = createBranchSchema.partial();

// Menu validators
export const createCategorySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(500).optional(),
  imageUrl: z.string().url().optional(),
  sortOrder: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});

export const updateCategorySchema = createCategorySchema.partial();

export const createMenuItemSchema = z.object({
  categoryId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  price: z.number().int().min(0, "El precio no puede ser negativo"),
  imageUrl: z.string().url().optional(),
  isAvailable: z.boolean().default(true),
  sortOrder: z.number().int().min(0).default(0),
  preparationTimeMin: z.number().int().min(1).max(120).optional(),
});

export const updateMenuItemSchema = createMenuItemSchema.partial();

export const createModifierGroupSchema = z.object({
  name: z.string().min(1).max(255),
  minSelections: z.number().int().min(0).default(0),
  maxSelections: z.number().int().min(1).default(1),
  isRequired: z.boolean().default(false),
});

export const createModifierSchema = z.object({
  groupId: z.string().uuid(),
  name: z.string().min(1).max(255),
  price: z.number().int().min(0).default(0),
  isAvailable: z.boolean().default(true),
});

export const updateModifierGroupSchema = createModifierGroupSchema.partial();
export const updateModifierSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  price: z.number().int().min(0).optional(),
  isAvailable: z.boolean().optional(),
});

// Space validators
export const createSpaceSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(500).optional(),
  floorNumber: z.number().int().min(0).default(1),
  sortOrder: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});

export const updateSpaceSchema = createSpaceSchema.partial();

// Table validators
export const createTableSchema = z.object({
  number: z.number().int().min(1),
  capacity: z.number().int().min(1).max(50).default(4),
  spaceId: z.string().uuid().optional(),
});

export const updateTableStatusSchema = z.object({
  status: z.enum(["available", "occupied", "reserved", "maintenance"]),
});

// Customer session (QR flow)
export const startSessionSchema = z.object({
  customerName: z.string().min(1, "Ingresa tu nombre").max(255),
  customerPhone: z.string().max(20).optional(),
});

// Order validators
export const createOrderItemSchema = z.object({
  menuItemId: z.string().uuid(),
  quantity: z.number().int().min(1).max(99),
  notes: z.string().max(500).optional(),
  modifiers: z.array(z.object({
    modifierId: z.string().uuid(),
  })).default([]),
});

export const createOrderSchema = z.object({
  type: z.enum(["dine_in", "takeout", "delivery"]).default("dine_in"),
  customerName: z.string().max(255).optional(),
  notes: z.string().max(500).optional(),
  items: z.array(createOrderItemSchema).min(1, "La orden debe tener al menos un item"),
  couponCode: z.string().max(50).optional(),
  redemptionId: z.string().uuid().optional(),
  // Delivery fields
  deliveryAddress: z.string().max(500).optional(),
  deliveryPhone: z.string().max(20).optional(),
  deliveryFee: z.number().int().min(0).optional(),
  deliveryDriverId: z.string().uuid().optional(),
  paymentMethod: z.enum(["cash", "card", "yape", "plin", "transfer", "other"]).optional(),
  isPaid: z.boolean().optional(),
});

export const updateOrderStatusSchema = z.object({
  status: z.enum(["pending", "confirmed", "preparing", "ready", "served", "completed", "cancelled"]),
});

export const updateOrderItemStatusSchema = z.object({
  status: z.enum(["pending", "preparing", "ready", "served"]),
});

// Payment validators
export const createPaymentSchema = z.object({
  orderId: z.string().uuid(),
  method: z.enum(["cash", "card", "yape", "plin", "transfer", "other"]),
  amount: z.number().int().min(1),
  reference: z.string().max(255).optional(),
  tip: z.number().int().min(0).default(0),
});

// Invoice validators
export const createInvoiceSchema = z.object({
  orderId: z.string().uuid(),
  type: z.enum(["boleta", "factura"]),
  customerName: z.string().min(1).max(255),
  customerDocType: z.enum(["dni", "ruc", "ce"]),
  customerDocNumber: z.string().min(8).max(20),
});

// Inventory validators
export const createInventoryItemSchema = z.object({
  categoryId: z.string().uuid().optional(),
  name: z.string().min(1).max(255),
  unit: z.string().min(1).max(50),
  currentStock: z.number().min(0).default(0),
  minStock: z.number().min(0).default(0),
  costPerUnit: z.number().int().min(0).default(0),
});

export const createInventoryMovementSchema = z.object({
  itemId: z.string().uuid(),
  type: z.enum(["purchase", "consumption", "waste", "adjustment"]),
  quantity: z.number().positive("La cantidad debe ser mayor a cero"),
  reference: z.string().max(255).optional(),
  notes: z.string().max(500).optional(),
});

// Loyalty validators
export const createLoyaltyProgramSchema = z.object({
  name: z.string().min(1).max(255),
  pointsPerCurrencyUnit: z.number().int().min(1).default(1),
  currencyPerPoint: z.number().int().min(1).default(100),
  isActive: z.boolean().default(true),
});

export const createCustomerSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email().optional(),
  phone: z.string().max(20).optional(),
  birthDate: z.string().optional(),
});

// Coupon validators
export const createCouponSchema = z
  .object({
    code: z.string().min(1).max(50),
    name: z.string().min(1).max(255),
    description: z.string().max(500).optional(),
    type: z.enum([
      "percentage",
      "fixed",
      "item_free",
      "item_discount",
      "category_discount",
      "buy_x_get_y",
    ]),
    discountValue: z.number().int().min(0).optional(),
    menuItemId: z.string().uuid().optional(),
    categoryId: z.string().uuid().optional(),
    buyQuantity: z.number().int().min(1).optional(),
    getQuantity: z.number().int().min(1).optional(),
    minOrderAmount: z.number().int().min(0).optional(),
    maxDiscountAmount: z.number().int().min(0).optional(),
    maxUsesTotal: z.number().int().min(1).optional(),
    maxUsesPerCustomer: z.number().int().min(1).optional(),
    startsAt: z.string().optional(),
    expiresAt: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (
      data.type === "percentage" &&
      data.discountValue != null &&
      data.discountValue > 100
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["discountValue"],
        message: "El porcentaje no puede ser mayor a 100",
      });
    }
  });

export const updateCouponSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(500).optional(),
    status: z.enum(["active", "inactive", "expired"]).optional(),
    discountValue: z.number().int().min(0).optional(),
    menuItemId: z.string().uuid().nullable().optional(),
    categoryId: z.string().uuid().nullable().optional(),
    buyQuantity: z.number().int().min(1).nullable().optional(),
    getQuantity: z.number().int().min(1).nullable().optional(),
    minOrderAmount: z.number().int().min(0).nullable().optional(),
    maxDiscountAmount: z.number().int().min(0).nullable().optional(),
    maxUsesTotal: z.number().int().min(1).nullable().optional(),
    maxUsesPerCustomer: z.number().int().min(1).nullable().optional(),
    startsAt: z.string().nullable().optional(),
    expiresAt: z.string().nullable().optional(),
    // Allow updating type so percentage cap can be validated on edits too.
    type: z
      .enum([
        "percentage",
        "fixed",
        "item_free",
        "item_discount",
        "category_discount",
        "buy_x_get_y",
      ])
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (
      data.type === "percentage" &&
      data.discountValue != null &&
      data.discountValue > 100
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["discountValue"],
        message: "El porcentaje no puede ser mayor a 100",
      });
    }
  });

// Report validators
export const reportQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha inválido (YYYY-MM-DD)"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha inválido (YYYY-MM-DD)"),
});

// Pagination
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ID param
export const idParamSchema = z.object({
  id: z.string().uuid(),
});

// Settings validators
export const updateOrgSettingsSchema = z.object({
  name: z.string().min(2).max(255).optional(),
  logoUrl: z.string().url().nullable().optional(),
  settings: z.record(z.unknown()).optional(),
});

export const updateBranchSettingsSchema = z.object({
  name: z.string().min(2).max(255).optional(),
  address: z.string().max(500).optional(),
  phone: z.string().max(20).optional(),
  taxRate: z.number().int().min(0).max(10000).optional(),
  timezone: z.string().optional(),
  currency: z.string().length(3).optional(),
  settings: z.record(z.unknown()).optional(),
  inventoryEnabled: z.boolean().optional(),
  waiterTableAssignmentEnabled: z.boolean().optional(),
});

// Query validators for GET endpoints
export const orderQuerySchema = z.object({
  status: z.enum(["pending", "confirmed", "preparing", "ready", "served", "completed", "cancelled"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const inventoryQuerySchema = z.object({
  categoryId: z.string().uuid().optional(),
});

export const movementQuerySchema = z.object({
  itemId: z.string().uuid().optional(),
});

export const customerSearchSchema = z.object({
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const couponQuerySchema = z.object({
  status: z.enum(["active", "inactive", "expired"]).optional(),
  type: z.enum(["percentage", "fixed", "item_free", "item_discount", "category_discount", "buy_x_get_y"]).optional(),
});

export const kitchenQuerySchema = z.object({
  status: z.enum(["pending", "confirmed", "preparing", "ready"]).optional(),
});

// Export types inferred from schemas
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterOrgInput = z.infer<typeof registerOrgSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type CreateBranchInput = z.infer<typeof createBranchSchema>;
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type CreateMenuItemInput = z.infer<typeof createMenuItemSchema>;
export type CreateModifierGroupInput = z.infer<typeof createModifierGroupSchema>;
export type CreateModifierInput = z.infer<typeof createModifierSchema>;
export type CreateSpaceInput = z.infer<typeof createSpaceSchema>;
export type UpdateSpaceInput = z.infer<typeof updateSpaceSchema>;
export type CreateTableInput = z.infer<typeof createTableSchema>;
export type StartSessionInput = z.infer<typeof startSessionSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type CreateInventoryItemInput = z.infer<typeof createInventoryItemSchema>;
export type CreateInventoryMovementInput = z.infer<typeof createInventoryMovementSchema>;
export type CreateLoyaltyProgramInput = z.infer<typeof createLoyaltyProgramSchema>;
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type CreateCouponInput = z.infer<typeof createCouponSchema>;
export type UpdateCouponInput = z.infer<typeof updateCouponSchema>;
export type ReportQueryInput = z.infer<typeof reportQuerySchema>;
export type PaginationInput = z.infer<typeof paginationSchema>;
export type UpdateModifierGroupInput = z.infer<typeof updateModifierGroupSchema>;
export type UpdateModifierInput = z.infer<typeof updateModifierSchema>;
export type UpdateOrgSettingsInput = z.infer<typeof updateOrgSettingsSchema>;
export type UpdateBranchSettingsInput = z.infer<typeof updateBranchSettingsSchema>;
export type OrderQueryInput = z.infer<typeof orderQuerySchema>;
