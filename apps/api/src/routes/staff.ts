import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { zValidator } from "@hono/zod-validator";
import { eq, and, desc, gte, lte, inArray, isNull, ne, count } from "drizzle-orm";
import { db, schema } from "@restai/db";
import { createUserSchema, idParamSchema } from "@restai/validators";
import { ROLES, PERMISSIONS } from "@restai/config";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware, requireBranch } from "../middleware/tenant.js";
import { requirePermission } from "../middleware/rbac.js";
import { hashPassword } from "../lib/hash.js";

/**
 * Role ceiling check: a caller may only create/assign a target role whose
 * level is STRICTLY GREATER than the caller's own (lower level = more power).
 * Returns true if the assignment is allowed.
 */
function canAssignRole(callerRole: string, targetRole: string): boolean {
  const caller = ROLES[callerRole as keyof typeof ROLES];
  const target = ROLES[targetRole as keyof typeof ROLES];
  if (!caller || !target) return false;
  return target.level > caller.level;
}

const staff = new Hono<AppEnv>();

staff.use("*", authMiddleware);
staff.use("*", tenantMiddleware);
staff.use("*", requireBranch);

// GET / - List staff for org with branch assignments
staff.get("/", requirePermission("staff:read"), async (c) => {
  const tenant = c.get("tenant") as any;
  const includeInactive = c.req.query("includeInactive") === "true";

  const conditions = [eq(schema.users.organization_id, tenant.organizationId)];
  if (!includeInactive) {
    conditions.push(eq(schema.users.is_active, true));
  }

  // Get all users in this org
  const users = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      role: schema.users.role,
      is_active: schema.users.is_active,
      created_at: schema.users.created_at,
    })
    .from(schema.users)
    .where(and(...conditions));

  if (users.length === 0) {
    return c.json({ success: true, data: [] });
  }

  const userIds = users.map((u) => u.id);

  // Get branch assignments for these users
  const branchAssignments = await db
    .select({
      user_id: schema.userBranches.user_id,
      branch_id: schema.userBranches.branch_id,
      branch_name: schema.branches.name,
    })
    .from(schema.userBranches)
    .innerJoin(schema.branches, eq(schema.userBranches.branch_id, schema.branches.id))
    .where(inArray(schema.userBranches.user_id, userIds));

  // Group branches by user
  const branchesByUser = new Map<string, { id: string; name: string }[]>();
  for (const ba of branchAssignments) {
    const list = branchesByUser.get(ba.user_id) || [];
    list.push({ id: ba.branch_id, name: ba.branch_name });
    branchesByUser.set(ba.user_id, list);
  }

  const result = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    isActive: u.is_active,
    createdAt: u.created_at,
    branches: branchesByUser.get(u.id) || [],
  }));

  return c.json({ success: true, data: result });
});

// POST / - Create new staff user
staff.post(
  "/",
  requirePermission("staff:create"),
  zValidator("json", createUserSchema),
  async (c) => {
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;
    const caller = c.get("user") as any;

    // Role ceiling: caller may only assign a role strictly weaker than their own
    if (!canAssignRole(caller.role, body.role)) {
      return c.json(
        { success: false, error: { code: "FORBIDDEN", message: "No puedes asignar este rol" } },
        403,
      );
    }

    // Verify all requested branches belong to this organization
    const ownedBranches = await db
      .select({ id: schema.branches.id })
      .from(schema.branches)
      .where(
        and(
          inArray(schema.branches.id, body.branchIds),
          eq(schema.branches.organization_id, tenant.organizationId),
        ),
      );
    if (ownedBranches.length !== body.branchIds.length) {
      return c.json(
        { success: false, error: { code: "BAD_REQUEST", message: "Una o más sedes no son válidas" } },
        400,
      );
    }

    // Check email uniqueness (generic message: do not disclose cross-tenant existence)
    const [existing] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, body.email));

    if (existing) {
      return c.json(
        { success: false, error: { code: "CONFLICT", message: "No se pudo crear el usuario" } },
        409,
      );
    }

    const passwordHash = await hashPassword(body.password);

    const [newUser] = await db
      .insert(schema.users)
      .values({
        organization_id: tenant.organizationId,
        email: body.email,
        password_hash: passwordHash,
        name: body.name,
        role: body.role,
      })
      .returning();

    // Insert branch assignments
    if (body.branchIds.length > 0) {
      await db.insert(schema.userBranches).values(
        body.branchIds.map((branchId) => ({
          user_id: newUser.id,
          branch_id: branchId,
        })),
      );
    }

    return c.json({
      success: true,
      data: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        isActive: newUser.is_active,
      },
    }, 201);
  },
);

// PATCH /:id - Update staff
staff.patch(
  "/:id",
  requirePermission("staff:update"),
  zValidator("param", idParamSchema),
  zValidator(
    "json",
    z.object({
      name: z.string().min(2).max(255).optional(),
      role: z.enum(["org_admin", "branch_manager", "cashier", "waiter", "kitchen"]).optional(),
      isActive: z.boolean().optional(),
      branchIds: z.array(z.string().uuid()).optional(),
    }),
  ),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;
    const caller = c.get("user") as any;

    // Verify user belongs to this org
    const [user] = await db
      .select({ id: schema.users.id, role: schema.users.role })
      .from(schema.users)
      .where(
        and(
          eq(schema.users.id, id),
          eq(schema.users.organization_id, tenant.organizationId),
        ),
      );

    if (!user) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Usuario no encontrado" } },
        404,
      );
    }

    // Role ceiling: caller may only modify OTHER users whose current role is
    // strictly weaker than their own (cannot touch peers or those above them).
    // Self-edits are allowed here; role/active changes have dedicated guards below.
    if (id !== caller.sub && !canAssignRole(caller.role, user.role)) {
      return c.json(
        { success: false, error: { code: "FORBIDDEN", message: "No puedes modificar este usuario" } },
        403,
      );
    }

    // Role change guards
    if (body.role !== undefined && body.role !== user.role) {
      // Caller may only assign a role strictly weaker than their own
      if (!canAssignRole(caller.role, body.role)) {
        return c.json(
          { success: false, error: { code: "FORBIDDEN", message: "No puedes asignar este rol" } },
          403,
        );
      }

      // Block self-demotion (changing your own role)
      if (id === caller.sub) {
        return c.json(
          { success: false, error: { code: "FORBIDDEN", message: "No puedes cambiar tu propio rol" } },
          403,
        );
      }

      // Block demoting the last active org_admin
      if (user.role === "org_admin" && body.role !== "org_admin") {
        const [adminCount] = await db
          .select({ count: count() })
          .from(schema.users)
          .where(
            and(
              eq(schema.users.organization_id, tenant.organizationId),
              eq(schema.users.role, "org_admin"),
              eq(schema.users.is_active, true),
              ne(schema.users.id, id),
            ),
          );
        if ((adminCount?.count ?? 0) === 0) {
          return c.json(
            { success: false, error: { code: "CONFLICT", message: "No puedes quitar al último administrador" } },
            409,
          );
        }
      }
    }

    // Block deactivating the last active org_admin
    if (body.isActive === false && user.role === "org_admin") {
      if (id === caller.sub) {
        return c.json(
          { success: false, error: { code: "FORBIDDEN", message: "No puedes desactivarte a ti mismo" } },
          403,
        );
      }
      const [adminCount] = await db
        .select({ count: count() })
        .from(schema.users)
        .where(
          and(
            eq(schema.users.organization_id, tenant.organizationId),
            eq(schema.users.role, "org_admin"),
            eq(schema.users.is_active, true),
            ne(schema.users.id, id),
          ),
        );
      if ((adminCount?.count ?? 0) === 0) {
        return c.json(
          { success: false, error: { code: "CONFLICT", message: "No puedes desactivar al último administrador" } },
          409,
        );
      }
    }

    // Verify all requested branches belong to this organization
    if (body.branchIds !== undefined && body.branchIds.length > 0) {
      const ownedBranches = await db
        .select({ id: schema.branches.id })
        .from(schema.branches)
        .where(
          and(
            inArray(schema.branches.id, body.branchIds),
            eq(schema.branches.organization_id, tenant.organizationId),
          ),
        );
      if (ownedBranches.length !== body.branchIds.length) {
        return c.json(
          { success: false, error: { code: "BAD_REQUEST", message: "Una o más sedes no son válidas" } },
          400,
        );
      }
    }

    // Build update object
    const updateData: any = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.role !== undefined) updateData.role = body.role;
    if (body.isActive !== undefined) updateData.is_active = body.isActive;

    if (Object.keys(updateData).length > 0) {
      await db
        .update(schema.users)
        .set(updateData)
        .where(
          and(
            eq(schema.users.id, id),
            eq(schema.users.organization_id, tenant.organizationId),
          ),
        );
    }

    // Update branch assignments if provided
    if (body.branchIds !== undefined) {
      await db
        .delete(schema.userBranches)
        .where(eq(schema.userBranches.user_id, id));

      if (body.branchIds.length > 0) {
        await db.insert(schema.userBranches).values(
          body.branchIds.map((branchId) => ({
            user_id: id,
            branch_id: branchId,
          })),
        );
      }
    }

    return c.json({ success: true, data: { id } });
  },
);

// PATCH /:id/password - Change staff password
staff.patch(
  "/:id/password",
  requirePermission("staff:update"),
  zValidator("param", idParamSchema),
  zValidator(
    "json",
    z.object({
      password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres").max(255),
    }),
  ),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const [user] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(
        and(
          eq(schema.users.id, id),
          eq(schema.users.organization_id, tenant.organizationId),
        ),
      );

    if (!user) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Usuario no encontrado" } },
        404,
      );
    }

    const passwordHash = await hashPassword(body.password);

    await db
      .update(schema.users)
      .set({ password_hash: passwordHash })
      .where(eq(schema.users.id, id));

    return c.json({ success: true, data: { id } });
  },
);

// POST /shifts - Create shift (clock in)
// No requirePermission: any authenticated staff member can clock themselves in
// (ownership enforced via user.sub). Line staff (waiter/kitchen) lack staff:create.
staff.post(
  "/shifts",
  zValidator(
    "json",
    z.object({
      notes: z.string().max(500).optional(),
    }).optional(),
  ),
  async (c) => {
    const user = c.get("user") as any;
    const tenant = c.get("tenant") as any;
    const body = c.req.valid("json") || {};

    // Check if user already has an open shift
    const [existingShift] = await db
      .select({ id: schema.shifts.id })
      .from(schema.shifts)
      .where(
        and(
          eq(schema.shifts.user_id, user.sub),
          eq(schema.shifts.branch_id, tenant.branchId),
          isNull(schema.shifts.end_time),
        ),
      );

    if (existingShift) {
      return c.json(
        { success: false, error: { code: "CONFLICT", message: "Ya tienes un turno activo" } },
        409,
      );
    }

    const [shift] = await db
      .insert(schema.shifts)
      .values({
        user_id: user.sub,
        branch_id: tenant.branchId,
        organization_id: tenant.organizationId,
        start_time: new Date(),
        notes: body.notes,
      })
      .returning();

    return c.json({ success: true, data: shift }, 201);
  },
);

// GET /shifts - List shifts with user names
staff.get("/shifts", requirePermission("staff:read"), async (c) => {
  const tenant = c.get("tenant") as any;

  const startDateParam = c.req.query("startDate");
  const endDateParam = c.req.query("endDate");

  const conditions = [
    eq(schema.shifts.branch_id, tenant.branchId),
    eq(schema.shifts.organization_id, tenant.organizationId),
  ];

  if (startDateParam) {
    conditions.push(gte(schema.shifts.start_time, new Date(startDateParam)));
  }
  if (endDateParam) {
    const end = new Date(endDateParam);
    end.setHours(23, 59, 59, 999);
    conditions.push(lte(schema.shifts.start_time, end));
  }

  const result = await db
    .select({
      id: schema.shifts.id,
      user_id: schema.shifts.user_id,
      user_name: schema.users.name,
      start_time: schema.shifts.start_time,
      end_time: schema.shifts.end_time,
      notes: schema.shifts.notes,
    })
    .from(schema.shifts)
    .innerJoin(schema.users, eq(schema.shifts.user_id, schema.users.id))
    .where(and(...conditions))
    .orderBy(desc(schema.shifts.start_time))
    .limit(50);

  return c.json({ success: true, data: result });
});

// PATCH /shifts/:id - End shift (clock out)
// No requirePermission: a user may close their OWN shift; managers/admins
// (those with staff:update) may close any shift in the branch.
staff.patch(
  "/shifts/:id",
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;
    const caller = c.get("user") as any;

    const [shift] = await db
      .select()
      .from(schema.shifts)
      .where(
        and(
          eq(schema.shifts.id, id),
          eq(schema.shifts.branch_id, tenant.branchId),
          eq(schema.shifts.organization_id, tenant.organizationId),
        ),
      );

    if (!shift) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Turno no encontrado" } },
        404,
      );
    }

    // Ownership: only the shift owner, or a manager with staff:update, may close it
    const callerPerms =
      (PERMISSIONS[caller.role as keyof typeof PERMISSIONS] as readonly string[] | undefined) ?? [];
    const canManageShifts =
      callerPerms.includes("*") ||
      callerPerms.includes("staff:*") ||
      callerPerms.includes("staff:update");
    if (shift.user_id !== caller.sub && !canManageShifts) {
      return c.json(
        { success: false, error: { code: "FORBIDDEN", message: "No puedes cerrar este turno" } },
        403,
      );
    }

    if (shift.end_time) {
      return c.json(
        { success: false, error: { code: "BAD_REQUEST", message: "El turno ya fue cerrado" } },
        400,
      );
    }

    // Atomic clock-out: only update if still open (guards concurrent close)
    const [updated] = await db
      .update(schema.shifts)
      .set({ end_time: new Date() })
      .where(
        and(
          eq(schema.shifts.id, id),
          eq(schema.shifts.organization_id, tenant.organizationId),
          isNull(schema.shifts.end_time),
        ),
      )
      .returning();

    if (!updated) {
      return c.json(
        { success: false, error: { code: "CONFLICT", message: "El turno ya fue cerrado" } },
        409,
      );
    }

    return c.json({ success: true, data: updated });
  },
);

export { staff };
