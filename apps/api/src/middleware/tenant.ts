import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types.js";

export const tenantMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get("user") as any;
  if (!user) {
    return c.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "No autenticado" } },
      401,
    );
  }

  if (user.role === "customer") {
    c.set("tenant", {
      organizationId: user.org,
      branchId: user.branch,
    });
    return next();
  }

  // Staff user
  const organizationId = user.org;
  const branchId =
    c.req.header("x-branch-id") || c.req.query("branchId") || null;

  // Validate staff has access to the requested branch
  const hasGlobalBranchAccess =
    user.role === "super_admin" || user.role === "org_admin";

  if (
    branchId &&
    !hasGlobalBranchAccess &&
    user.branches &&
    !user.branches.includes(branchId)
  ) {
    return c.json(
      { success: false, error: { code: "FORBIDDEN", message: "No tienes acceso a esta sucursal" } },
      403,
    );
  }

  c.set("tenant", { organizationId, branchId: branchId! });
  return next();
});

export const requireBranch = createMiddleware<AppEnv>(async (c, next) => {
  const tenant = c.get("tenant");
  if (!tenant?.branchId) {
    return c.json(
      {
        success: false,
        error: { code: "BAD_REQUEST", message: "Se requiere x-branch-id header o branchId query param" },
      },
      400,
    );
  }
  return next();
});
