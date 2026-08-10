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
  /**
   * Posición en la carta. SIN valor por defecto a propósito.
   *
   * Con `.default(0)` todo lo que se creaba nacía en la posición 0, es decir,
   * el primero de la carta. Un plato recién dado de alta se colaba delante del
   * plato estrella sin que nadie lo pidiera. Omitirlo significa ahora "al
   * final", que es lo que espera quien añade algo.
   */
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().default(true),
});

export const updateCategorySchema = createCategorySchema.partial();

/**
 * Alérgenos con los que trabaja la carta.
 *
 * Lista cerrada a propósito: el comensal los lee traducidos, y con texto libre
 * cada sede escribiría "mariscos", "marisco" y "shellfish" para lo mismo, con lo
 * que el filtro por alergia dejaría de ser fiable justo donde importa.
 */
export const ALLERGENS = [
  "gluten",
  "crustaceans",
  "eggs",
  "fish",
  "peanuts",
  "soy",
  "milk",
  "nuts",
  "celery",
  "mustard",
  "sesame",
  "sulphites",
  "lupin",
  "molluscs",
  "shellfish",
] as const;

/** Etiquetas dietéticas. Mismo criterio que los alérgenos. */
export const DIETARY_TAGS = [
  "vegetarian",
  "vegan",
  "gluten_free",
  "dairy_free",
  "nut_free",
  "halal",
  "kosher",
  "keto",
  "low_carb",
] as const;

export const createMenuItemSchema = z.object({
  categoryId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  price: z.number().int().min(0, "El precio no puede ser negativo"),
  imageUrl: z.string().url().optional(),
  isAvailable: z.boolean().default(true),
  /**
   * Posición en la carta. SIN valor por defecto a propósito.
   *
   * Con `.default(0)` todo lo que se creaba nacía en la posición 0, es decir,
   * el primero de la carta. Un plato recién dado de alta se colaba delante del
   * plato estrella sin que nadie lo pidiera. Omitirlo significa ahora "al
   * final", que es lo que espera quien añade algo.
   */
  sortOrder: z.number().int().min(0).optional(),
  preparationTimeMin: z.number().int().min(1).max(120).optional(),
  /**
   * Alérgenos, dieta y picante.
   *
   * Las tres columnas existen desde la migración 0012 y la carta del comensal ya
   * las pinta, pero NO había forma de escribirlas: no estaban en este esquema ni
   * en la ruta, así que solo las poblaba el seed. El resultado era una carta que
   * prometía avisar de alergias y nunca tenía el dato.
   *
   * El picante va de 0 a 3 porque así lo restringe el CHECK de la base.
   */
  allergens: z.array(z.enum(ALLERGENS)).max(15).optional(),
  dietaryTags: z.array(z.enum(DIETARY_TAGS)).max(9).optional(),
  spiceLevel: z.number().int().min(0).max(3).nullable().optional(),
  /**
   * Anclado arriba de la carta del punto de venta.
   *
   * No toca la carta del comensal: es una ayuda para quien cobra, para que los
   * seis platos que se cantan cada noche no se busquen igual que un postre que
   * se pide dos veces por semana.
   */
  isFeatured: z.boolean().optional(),
});

/**
 * Edición de un producto.
 *
 * Los opcionales aceptan `null` para poder VACIARLOS: sin esto no había manera
 * de quitarle la foto a un plato ni de borrar una descripción una vez escrita,
 * porque `undefined` se omite del update y el esquema rechazaba el nulo.
 */
export const updateMenuItemSchema = createMenuItemSchema.partial().extend({
  description: z.string().max(1000).nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  preparationTimeMin: z.number().int().min(1).max(120).nullable().optional(),
});

/**
 * Cambio de varios productos a la vez.
 *
 * Existe para el caso real que lo justifica: se acabó la merluza y hay que
 * agotar los tres platos que la llevan. Uno a uno son tres peticiones sin
 * atomicidad, y si la segunda falla nadie sabe qué quedó aplicado.
 */
/**
 * Ajuste de precio en lote.
 *
 * `percent` va en PUNTOS BÁSICOS enteros (1000 = +10 %) y no en un decimal:
 * subir un 10 % con coma flotante da 4199 céntimos donde debía dar 4200, y ese
 * céntimo aparece en cada ticket. `delta` y `set` son céntimos, como todo el
 * dinero del sistema. El resultado nunca baja de cero: un descuento mayor que
 * el precio deja el plato gratis, no en negativo.
 */
export const priceAdjustmentSchema = z.object({
  mode: z.enum(["percent", "delta", "set"]),
  value: z.number().int(),
});

export const bulkUpdateMenuItemsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  patch: z.object({
    isAvailable: z.boolean().optional(),
    categoryId: z.string().uuid().optional(),
    spiceLevel: z.number().int().min(0).max(3).nullable().optional(),
    allergens: z.array(z.enum(ALLERGENS)).max(15).optional(),
    dietaryTags: z.array(z.enum(DIETARY_TAGS)).max(9).optional(),
    price: priceAdjustmentSchema.optional(),
    /**
     * Destacar o quitar el destacado a varios platos de golpe.
     *
     * Es lo que aplica la sugerencia de "tus diez más vendidos" de una vez y con
     * atomicidad: diez peticiones sueltas pueden fallar por la mitad y dejar la
     * caja con media lista nueva y media vieja.
     */
    isFeatured: z.boolean().optional(),
  }),
});

export const bulkItemIdsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
});

/**
 * Reordenar: se envía la lista COMPLETA del ámbito, en su orden final.
 *
 * No se envía "este va al puesto 4". Con posiciones relativas, dos personas
 * moviendo a la vez dejan dos elementos en el mismo puesto y un hueco; con la
 * lista entera, el servidor puede comprobar que no falta ni sobra nadie y
 * rechazar el envío si alguien creó algo mientras tanto.
 */
export const reorderSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
});

/** Reordenar platos: siempre dentro de UNA categoría, nunca entre categorías. */
export const reorderItemsSchema = reorderSchema.extend({
  categoryId: z.string().uuid(),
});

export const bulkLinkModifierGroupSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  groupId: z.string().uuid(),
});

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
  /**
   * Viene marcada de serie: lo que el plato lleva salvo que digan lo contrario.
   * El punto de venta la premarca, así que el cajero solo toca las excepciones.
   */
  isDefault: z.boolean().default(false),
});

export const updateModifierGroupSchema = createModifierGroupSchema.partial();
export const updateModifierSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  price: z.number().int().min(0).optional(),
  isAvailable: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

// Space validators
export const createSpaceSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(500).optional(),
  floorNumber: z.number().int().min(0).default(1),
  /**
   * Posición en la carta. SIN valor por defecto a propósito.
   *
   * Con `.default(0)` todo lo que se creaba nacía en la posición 0, es decir,
   * el primero de la carta. Un plato recién dado de alta se colaba delante del
   * plato estrella sin que nadie lo pidiera. Omitirlo significa ahora "al
   * final", que es lo que espera quien añade algo.
   */
  sortOrder: z.number().int().min(0).optional(),
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
  /**
   * Comensales sentados. Opcional: el comensal que escanea el QR no lo declara
   * y el mozo tampoco debería quedarse bloqueado por él en hora punta. El tope
   * es una defensa contra el tecleo, no una regla de negocio.
   */
  guests: z.number().int().min(1).max(200).optional(),
});

// Customer email-code (OTP) login
export const requestCustomerCodeSchema = z.object({
  email: z.string().email("Email inválido"),
});

export const verifyCustomerCodeSchema = z.object({
  email: z.string().email("Email inválido"),
  code: z.string().regex(/^\d{6}$/, "El código debe tener 6 dígitos"),
  // Table the customer is logging in at — on success we create a pending table
  // session (waiter approval) bound to the recognized customer.
  tableCode: z.string().min(1).max(100),
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

/**
 * Añadir platos a una cuenta ya abierta.
 *
 * Es lo que hace posible el servicio de salón de verdad: la mesa pide, se manda
 * a cocina, y media hora después pide otra ronda SOBRE LA MISMA CUENTA. Sin
 * esto, ampliar un pedido obligaba a levantar una comanda nueva y la mesa
 * acababa con tres cuentas que había que cobrar por separado.
 */
export const addOrderItemsSchema = z.object({
  items: z.array(createOrderItemSchema).min(1, "Hay que añadir al menos un plato").max(60),
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

// SUNAT validators
export const sunatConfigSchema = z.object({
  ruc: z.string().regex(/^(10|15|16|17|20)\d{9}$/, "RUC inválido (11 dígitos)"),
  razonSocial: z.string().min(1).max(255),
  nombreComercial: z.string().max(255).optional(),
  ubigeo: z.string().length(6).optional(),
  departamento: z.string().max(100).optional(),
  provincia: z.string().max(100).optional(),
  distrito: z.string().max(100).optional(),
  direccion: z.string().max(500).optional(),
  ambiente: z.enum(["beta", "production"]).default("beta"),
  endpointOverride: z.string().url().nullable().optional(),
  // Credenciales y certificado (en claro al recibirlos; se cifran al guardar)
  solUser: z.string().min(1).max(100).optional(),
  solPass: z.string().min(1).max(100).optional(),
  /** Certificado: PFX/P12 en base64 o PEM (clave + certificado). */
  certificate: z.string().min(1).optional(),
  certificatePassword: z.string().max(200).optional(),
  certificateFormat: z.enum(["pfx", "pem"]).default("pfx"),
  enabled: z.boolean().optional(),
});

export const notaCreditoSchema = z.object({
  // Catálogo 09: 01 anulación, 02 anulación por error en RUC, 03 corrección, etc.
  motivoCodigo: z
    .enum(["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "13"])
    .default("01"),
  motivoDescripcion: z.string().min(1).max(250),
});

export const bajaSchema = z.object({
  motivo: z.string().min(3).max(250),
  correlativo: z.number().int().min(1).max(99999).default(1),
});

export const resumenDiarioSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha debe ser YYYY-MM-DD"),
  correlativo: z.number().int().min(1).max(99999).default(1),
});

export const consultarTicketSchema = z.object({
  ticket: z.string().min(1).max(50),
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
  /**
   * RUC del emisor. Sin él no se puede imprimir un ticket válido ni emitir un
   * comprobante electrónico. El formato peruano lo valida también un CHECK en la
   * base (migración 0012).
   */
  // MISMO patrón que usan el validador de facturación (línea ~178) y
  // PUT /api/sunat/config. Incluye el prefijo 16 (no domiciliados), que este
  // regex omitía: un emisor con RUC 16 podía configurar SUNAT pero no guardar
  // sus propios datos fiscales.
  ruc: z
    .string()
    .regex(
      /^(10|15|16|17|20)\d{9}$/,
      "El RUC debe tener 11 dígitos y empezar por 10, 15, 16, 17 o 20",
    )
    .nullable()
    .optional(),
  legalName: z.string().max(255).nullable().optional(),
  /**
   * Ajustes libres. OJO: se FUSIONAN con los existentes en el servidor, no los
   * reemplazan; enviar `{a:1}` no borra `{b:2}`.
   */
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
  /**
   * Modo de carta: `dynamic` (el comensal pide desde la mesa) o `static` (el QR
   * solo enseña la carta).
   *
   * Es COLUMNA y no una clave del jsonb `settings`, a diferencia de los dos
   * interruptores de arriba. La fusión de `settings` es superficial y no
   * atómica: dos guardados a la vez pierden una clave en silencio, y un ajuste
   * que decide si el local puede cobrar no puede desaparecer así.
   */
  menuMode: z.enum(["dynamic", "static"]).optional(),
});

// Query validators for GET endpoints
export const orderQuerySchema = z.object({
  status: z.enum(["pending", "confirmed", "preparing", "ready", "served", "completed", "cancelled"]).optional(),
  /**
   * `open` = el servicio en curso; `closed` = lo cerrado o anulado.
   *
   * Sin esta separación, la pantalla trataba igual una orden de hace tres
   * minutos y una cobrada hace dos horas: el servicio vivo quedaba enterrado
   * entre meses de historial y solo se llegaba a él paginando a ciegas.
   */
  scope: z.enum(["open", "closed"]).optional(),
  /** Busca en número de orden, nombre del cliente y número de mesa. */
  q: z.string().trim().max(120).optional(),
  /** Rango de fechas (ISO). Se interpretan como día completo en hora de Lima. */
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  /**
   * El tope sube a 300 por el servicio en curso, que se sirve entero y sin
   * paginar: partir en páginas lo que está abierto obliga a buscar la mesa que
   * reclama en la página 2. Un local con más de 300 órdenes vivas a la vez no
   * existe; si existiera, el recorte se avisa en la respuesta.
   */
  limit: z.coerce.number().int().min(1).max(300).default(20),
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
export type RequestCustomerCodeInput = z.infer<typeof requestCustomerCodeSchema>;
export type VerifyCustomerCodeInput = z.infer<typeof verifyCustomerCodeSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type SunatConfigInput = z.infer<typeof sunatConfigSchema>;
export type NotaCreditoInput = z.infer<typeof notaCreditoSchema>;
export type BajaInput = z.infer<typeof bajaSchema>;
export type ResumenDiarioInput = z.infer<typeof resumenDiarioSchema>;
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
