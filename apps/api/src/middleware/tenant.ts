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
