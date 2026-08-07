// Roles hierarchy and permissions
// Las etiquetas se muestran TAL CUAL en la interfaz (barra lateral, tablas de
// ventas por empleado, exportaciones CSV), así que van en español: tres de ellas
// estaban en inglés y salían mezcladas con el resto de la aplicación.
export const ROLES = {
  super_admin: { level: 0, label: "Superadministrador" },
  org_admin: { level: 1, label: "Administrador" },
  branch_manager: { level: 2, label: "Gerente de sede" },
  cashier: { level: 3, label: "Cajero" },
  waiter: { level: 4, label: "Mesero" },
  kitchen: { level: 5, label: "Cocina" },
} as const;

export type Role = keyof typeof ROLES;

// Permission definitions per role.
//
// Convenciones:
// - `recurso:*` concede todo el recurso (lo resuelve requirePermission).
// - Las acciones destructivas o sensibles tienen su propio verbo y NUNCA se
//   conceden por el verbo genérico `update`: `orders:void`, `payments:void`,
//   `tables:delete`, `tables:layout`. Así el mesero puede operar mesas sin poder
//   borrar la configuración del local, y la cocina puede avanzar estados sin
//   poder anular una venta.
export const PERMISSIONS = {
  super_admin: ["*"],
  org_admin: [
    "org:read", "org:update",
    "branch:*",
    "menu:*", "orders:*", "tables:*",
    "staff:*", "inventory:*", "loyalty:*",
    "customers:*",
    "payments:*", "cash:*", "reports:*", "invoices:*",
    "sunat:*", "audit:read",
    "settings:*",
  ],
  branch_manager: [
    "branch:read", "branch:update",
    "menu:*", "orders:*", "tables:*",
    "staff:read", "staff:create", "staff:update",
    "inventory:*", "loyalty:*",
    "customers:*",
    "payments:*", "cash:*", "reports:read",
    "invoices:*", "sunat:read", "audit:read",
    "settings:read",
  ],
  cashier: [
    "branch:read",
    // Lectura de la configuración de la sede: nombre y logo del local (cabecera
    // y tickets), tasa de IGV y los interruptores de funciones. Sin esto, TODAS
    // las pantallas devolvían un 403 al montarse. No expone nada sensible: las
    // credenciales de SUNAT viven cifradas en su propia tabla, tras `sunat:read`.
    "settings:read",
    // Sin menu:read el POS abría vacío: el rol que vende no podía ver la carta.
    "menu:read",
    "orders:read", "orders:create", "orders:update",
    "orders:update_status", "orders:update_item_status", "orders:void",
    "tables:read",
    "payments:create", "payments:read", "payments:void",
    "cash:read", "cash:manage",
    "customers:*",
    // Para atender "quiero usar mis puntos" en caja.
    "loyalty:read", "loyalty:redeem",
    // Para asignar repartidor en delivery.
    "staff:read",
    // El cajero emite el comprobante y también lo corrige: es quien descubre el
    // error de RUC o el cobro duplicado en el mostrador, con el cliente delante.
    "invoices:create", "invoices:read", "invoices:void",
  ],
  waiter: [
    "branch:read",
    // Imprescindible: el interruptor "cada mozo ve solo sus mesas" vive en
    // `branches.settings`. Sin `settings:read` la consulta daba 403, el flag
    // quedaba en `undefined`, y el filtrado por asignación se desactivaba en
    // silencio para TODOS los mozos aunque el gerente lo tuviera encendido.
    "settings:read",
    "tables:read", "tables:update",
    "orders:create", "orders:read", "orders:update",
    "orders:update_status", "orders:update_item_status",
    "menu:read",
    // Cobrar en mesa es la definición del trabajo del mozo. Sin payments:create
    // la UI le abría el diálogo completo y moría en "Sin permisos".
    "payments:create", "payments:read",
    "customers:read", "customers:create",
    "loyalty:read",
    // Emitir el comprobante de su mesa, sí. Anularlo ante SUNAT o emitir una
    // nota de crédito, NO: eso vive en `invoices:void`, igual que `orders:void`
    // y `payments:void` están fuera de su alcance.
    "invoices:create", "invoices:read",
  ],
  kitchen: [
    "branch:read",
    // El layout pinta el nombre y el logo del local en toda pantalla, incluido
    // el KDS: sin este permiso la tablet de cocina arrancaba con un 403.
    "settings:read",
    "menu:read",
    "orders:read",
    "orders:update_status",
    "orders:update_item_status",
    // Para ver stock y marcar un plato agotado (86).
    "inventory:read", "menu:availability",
  ],
} as const;

// Order status state machine
//
// El ciclo de COCINA (pending → preparing → ready → served) es reversible: en un
// servicio real el toque errado es constante —guantes, prisa, dos pantallas—, y
// sin marcha atrás el cocinero tenía que buscar a alguien con más permisos para
// arreglar un plato que él mismo acababa de mover. El botón "volver" y el
// "Deshacer" del tablero se apoyan en estas transiciones.
//
// `completed` y `cancelled` NO son reversibles y no deben serlo: disparan
// efectos contables (descuento de inventario, puntos de fidelidad, cierre de la
// venta) que no se pueden deshacer con un toque desde la cocina. Revertir eso
// tiene su propio camino, auditado: `orders:void` y la anulación de cobros.
export const ORDER_STATUS_TRANSITIONS: Record<string, string[]> = {
  pending: ["confirmed", "preparing", "cancelled"],
  confirmed: ["pending", "preparing", "cancelled"],
  preparing: ["pending", "ready", "cancelled"],
  ready: ["preparing", "served"],
  served: ["ready", "completed"],
  completed: [],
  cancelled: [],
};

/**
 * Retroceso de un paso dentro del tablero de cocina, por estado actual.
 *
 * Se declara aquí —y no en la pantalla— para que el botón "volver" y el
 * "Deshacer" no puedan ofrecer un movimiento que el servidor vaya a rechazar.
 */
export const KITCHEN_BACK_TRANSITIONS: Record<string, string> = {
  preparing: "pending",
  ready: "preparing",
  served: "ready",
};

// Un ítem puede anularse ("86" en jerga de cocina) mientras no se haya servido.
// Es la situación más frecuente del servicio: se acabó el plato.
export const ORDER_ITEM_STATUS_TRANSITIONS: Record<string, string[]> = {
  pending: ["preparing", "ready", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["served", "cancelled"],
  served: [],
  cancelled: [],
};

// Table status transitions
export const TABLE_STATUS_TRANSITIONS: Record<string, string[]> = {
  available: ["occupied", "reserved", "maintenance"],
  occupied: ["available", "maintenance"],
  reserved: ["occupied", "available", "maintenance"],
  maintenance: ["available"],
};

// Peru-specific constants
export const PERU = {
  CURRENCY: "PEN",
  TIMEZONE: "America/Lima",
  DEFAULT_TAX_RATE: 1800, // 18.00% IGV stored as basis points
  TAX_NAME: "IGV",
} as const;

// JWT config
export const JWT_CONFIG = {
  ACCESS_TOKEN_TTL: "15m",
  REFRESH_TOKEN_TTL: "7d",
  CUSTOMER_TOKEN_TTL: "4h",
} as const;

// Pagination defaults
export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
} as const;

// Payment methods with labels
export const PAYMENT_METHODS = {
  cash: { label: "Efectivo" },
  card: { label: "Tarjeta" },
  yape: { label: "Yape" },
  plin: { label: "Plin" },
  transfer: { label: "Transferencia" },
  other: { label: "Otro" },
} as const;

// Invoice types
export const INVOICE_TYPES = {
  boleta: { label: "Boleta de Venta", doc_types: ["dni", "ce"] },
  factura: { label: "Factura", doc_types: ["ruc"] },
} as const;
