// WebSocket message types
/**
 * Eventos que viajan por el canal de tiempo real.
 *
 * Esta unión debe cubrir TODO lo que publica la API. Se había quedado corta: la
 * cocina recibía `order:item_cancelled` y `menu:availability` y no podía
 * compararlos sin castear a string, así que el tablero seguía mostrando platos
 * que ya nadie iba a servir.
 */
export type WsMessageType =
  // ── Comandas ──
  | "order:new"
  | "order:updated"
  | "order:item_status"
  | "order:cancelled"
  /** Un plato concreto se anuló ("86" de cocina). */
  | "order:item_cancelled"
  // ── Carta ──
  /** Cambió la disponibilidad de un plato: hay que releer la carta. */
  | "menu:availability"
  // ── Caja ──
  /** Se anuló un cobro: los saldos de la mesa y del día cambian. */
  | "payment:voided"
  // ── Mesas y visitas ──
  | "table:status"
  | "table:call_waiter"
  | "table:request_bill"
  | "session:started"
  | "session:ended"
  | "session:pending"
  | "session:approved"
  | "session:rejected"
  /** La cuenta se movió a otra mesa. */
  | "session:moved"
  /** Varias mesas se juntaron en una. */
  | "session:merged"
  // ── Avisos de mesa (bandeja del mozo) ──
  | "service_request:created"
  | "service_request:acknowledged"
  | "service_request:resolved"
  | "service_request:cancelled"
  // ── Cocina e infraestructura ──
  | "kitchen:alert"
  | "ping"
  | "pong"
  | "auth:success"
  | "auth:error"
  | "auth:expired";

export interface WsMessage<T = unknown> {
  type: WsMessageType;
  payload: T;
  timestamp: number;
}

export interface WsOrderPayload {
  orderId: string;
  orderNumber: string;
  status: string;
  tableName?: string;
  items?: WsOrderItemPayload[];
}

export interface WsOrderItemPayload {
  id: string;
  name: string;
  quantity: number;
  status: string;
  notes?: string;
}

export interface WsTablePayload {
  tableId: string;
  number: number;
  status: string;
}

// API response types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: PaginationMeta;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, string[]>;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// Auth types
export interface JwtPayload {
  sub: string; // user id
  org: string; // organization id
  role: string;
  branches: string[];
  iat: number;
  exp: number;
}

export interface CustomerJwtPayload {
  sub: string; // session id
  org: string;
  branch: string;
  table: string;
  role: "customer";
  iat: number;
  exp: number;
}

// Tenant context
export interface TenantContext {
  organizationId: string;
  branchId: string;
}

// Dashboard types
export interface DashboardStats {
  totalOrders: number;
  totalRevenue: number; // in cents
  averageOrderValue: number; // in cents
  activeOrders: number;
  occupiedTables: number;
  totalTables: number;
}

export interface SalesReport {
  period: string;
  totalOrders: number;
  totalRevenue: number;
  totalTax: number;
  totalDiscount: number;
  byPaymentMethod: Record<string, number>;
  topItems: { name: string; quantity: number; revenue: number }[];
}

// Cart types (for frontend)
export interface CartItem {
  /**
   * Stable identifier for a cart LINE = product + its exact set of modifiers.
   * The same product with different modifiers is two lines; the plain
   * (no-modifier) line has lineId === menuItemId. Operations (qty/remove/notes)
   * key on this, not menuItemId, so modifier variants never collide.
   */
  lineId: string;
  menuItemId: string;
  name: string;
  unitPrice: number; // cents (bare product price, EXCLUDES modifiers)
  quantity: number;
  notes?: string;
  modifiers: CartModifier[];
}

export interface CartModifier {
  modifierId: string;
  name: string;
  price: number; // cents
}

export interface Cart {
  items: CartItem[];
  subtotal: number; // cents
  tax: number; // cents
  total: number; // cents
}
