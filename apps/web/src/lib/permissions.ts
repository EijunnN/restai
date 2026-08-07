import { PERMISSIONS, ROLES, type Role } from "@restai/config";

/**
 * Permisos en el cliente.
 *
 * MISMA matriz que aplica la API (packages/config), no una copia. Antes el
 * sidebar mantenía su propia lista de rutas por rol, que se desincronizó de los
 * permisos reales: el cajero veía el POS sin poder leer la carta y el cocinero
 * aterrizaba en un panel que devolvía dos 403.
 *
 * Esto es UX, no seguridad: la autorización real vive en el servidor. Aquí solo
 * evitamos enseñar puertas que se van a cerrar en la cara del usuario.
 */

/** Réplica exacta de requirePermission (apps/api/src/middleware/rbac.ts). */
export function hasPermission(role: string | undefined, permission: string): boolean {
  if (!role) return false;
  const granted = PERMISSIONS[role as Role] as readonly string[] | undefined;
  if (!granted) return false;
  if (granted.includes("*")) return true;

  const [resource] = permission.split(":");
  return granted.some((p) => p === permission || p === `${resource}:*`);
}

/** ¿Tiene TODOS los permisos indicados? */
export function hasAllPermissions(role: string | undefined, permissions: string[]): boolean {
  return permissions.every((p) => hasPermission(role, p));
}

/** ¿Tiene AL MENOS UNO de los permisos indicados? */
export function hasAnyPermission(role: string | undefined, permissions: string[]): boolean {
  return permissions.some((p) => hasPermission(role, p));
}

/** Etiqueta legible del rol. Sustituye a las comparaciones contra 'owner'/'admin', que no existen. */
export function roleLabel(role: string | undefined): string {
  if (!role) return "Personal";
  return ROLES[role as Role]?.label ?? "Personal";
}

/**
 * Permiso mínimo que exige cada pantalla del dashboard.
 *
 * Debe coincidir con lo que exige el primer endpoint que la pantalla llama al
 * montarse. Si una pantalla necesita varios, se pone el que la haría inútil sin él.
 */
export const ROUTE_PERMISSIONS: Record<string, string> = {
  "/": "reports:read",
  "/pos": "orders:create",
  "/orders": "orders:read",
  "/tables": "tables:read",
  "/kitchen": "orders:read",
  "/connections": "tables:read",
  "/menu": "menu:read",
  "/inventory": "inventory:read",
  "/staff": "staff:read",
  "/payments": "payments:read",
  "/caja": "cash:read",
  "/invoices": "invoices:read",
  "/loyalty": "loyalty:read",
  "/campaigns": "loyalty:read",
  "/referrals": "loyalty:read",
  "/reports": "reports:read",
  "/audit": "audit:read",
  "/settings": "settings:read",
};

/** ¿Puede este rol abrir esta ruta? Desconocida => denegar. */
export function canAccessRoute(role: string | undefined, href: string): boolean {
  const permission = ROUTE_PERMISSIONS[href];
  if (!permission) return false;
  return hasPermission(role, permission);
}

/**
 * Primera ruta que el rol puede abrir de verdad.
 *
 * El cocinero no tiene `reports:read`, así que mandarlo a "/" le mostraba dos
 * bandas rojas de error nada más entrar. Cada rol aterriza donde trabaja.
 */
export function landingRouteForRole(role: string | undefined): string {
  const preferred: Record<string, string[]> = {
    kitchen: ["/kitchen"],
    waiter: ["/tables", "/orders", "/pos"],
    cashier: ["/pos", "/orders", "/payments"],
  };
  for (const href of preferred[role ?? ""] ?? []) {
    if (canAccessRoute(role, href)) return href;
  }
  if (canAccessRoute(role, "/")) return "/";
  const first = Object.keys(ROUTE_PERMISSIONS).find((href) => canAccessRoute(role, href));
  return first ?? "/login";
}
