import { createMiddleware } from "hono/factory";
import { PERMISSIONS } from "@restai/config";
import type { AppEnv } from "../types.js";

export function requirePermission(permission: string) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get("user") as any;
    if (!user) {
      return c.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "No autenticado" } },
        401,
      );
    }

    const userPermissions =
      PERMISSIONS[user.role as keyof typeof PERMISSIONS] as readonly string[] | undefined;
    if (!userPermissions) {
      return c.json(
        { success: false, error: { code: "FORBIDDEN", message: "Rol no válido" } },
        403,
      );
    }

    // Super admin has all permissions
    if (userPermissions.includes("*")) return next();

    // Check exact match or wildcard (e.g., "menu:*" matches "menu:read")
    const [resource] = permission.split(":");
    const hasPermission = userPermissions.some((p) => {
      if (p === permission) return true;
      if (p === `${resource}:*`) return true;
      return false;
    });

    if (!hasPermission) {
      return c.json(
        { success: false, error: { code: "FORBIDDEN", message: "Sin permisos" } },
        403,
      );
    }

    return next();
  });
}

// Convenience helpers
export const requireAdmin = () => requirePermission("org:read");
export const requireManager = () => requirePermission("branch:read");
