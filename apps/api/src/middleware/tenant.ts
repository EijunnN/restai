import { createMiddleware } from "hono/factory";
import { eq, and } from "drizzle-orm";
import { db, schema } from "@restai/db";
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

  if (branchId) {
    // super_admin is the ONLY true global bypass: it may address any branch
    // across organizations without an ownership check.
    if (user.role === "super_admin") {
      c.set("tenant", { organizationId, branchId });
      return next();
    }

    if (user.role === "org_admin") {
      // org_admin has global access *within its own org* only: the supplied
      // branch must belong to the caller's organization. Verify ownership
      // against the DB before trusting the client-supplied branch id.
      const [branch] = await db
        .select({ id: schema.branches.id })
        .from(schema.branches)
        .where(
          and(
            eq(schema.branches.id, branchId),
            eq(schema.branches.organization_id, organizationId),
          ),
        )
        .limit(1);

      if (!branch) {
        return c.json(
          { success: false, error: { code: "FORBIDDEN", message: "No tienes acceso a esta sucursal" } },
          403,
        );
      }
    } else {
      // Non-global staff roles: must be an explicit member of the branch.
      if (!user.branches || !user.branches.includes(branchId)) {
        return c.json(
          { success: false, error: { code: "FORBIDDEN", message: "No tienes acceso a esta sucursal" } },
          403,
        );
      }
    }
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
