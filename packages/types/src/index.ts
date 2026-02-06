// WebSocket message types
export type WsMessageType =
  | "order:new"
  | "order:updated"
  | "order:item_status"
  | "order:cancelled"
  | "table:status"
  | "session:started"
  | "session:ended"
  | "kitchen:alert"
  | "ping"
  | "pong";

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
  menuItemId: string;
  name: string;
  unitPrice: number; // cents
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
