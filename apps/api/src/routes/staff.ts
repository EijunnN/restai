import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { zValidator } from "@hono/zod-validator";
import { eq, and, desc, gte, lte, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@restai/db";
import { createUserSchema, idParamSchema } from "@restai/validators";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware, requireBranch } from "../middleware/tenant.js";
import { requirePermission } from "../middleware/rbac.js";
import { hashPassword } from "../lib/hash.js";

const staff = new Hono<AppEnv>();

staff.use("*", authMiddleware);
staff.use("*", tenantMiddleware);
staff.use("*", requireBranch);

// GET / - List staff for org with branch assignments
staff.get("/", requirePermission("staff:read"), async (c) => {
  const tenant = c.get("tenant") as any;

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
    .where(eq(schema.users.organization_id, tenant.organizationId));

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

    // Check email uniqueness
    const [existing] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, body.email));

    if (existing) {
      return c.json(
        { success: false, error: { code: "CONFLICT", message: "El email ya esta registrado" } },
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

    // Verify user belongs to this org
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

    // Build update object
    const updateData: any = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.role !== undefined) updateData.role = body.role;
    if (body.isActive !== undefined) updateData.is_active = body.isActive;

    if (Object.keys(updateData).length > 0) {
      await db
        .update(schema.users)
        .set(updateData)
        .where(eq(schema.users.id, id));
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

// POST /shifts - Create shift (clock in)
staff.post(
  "/shifts",
  requirePermission("staff:create"),
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
staff.patch(
  "/shifts/:id",
  requirePermission("staff:update"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    const [shift] = await db
      .select()
      .from(schema.shifts)
      .where(
        and(
          eq(schema.shifts.id, id),
          eq(schema.shifts.branch_id, tenant.branchId),
        ),
      );

    if (!shift) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Turno no encontrado" } },
        404,
      );
    }

    if (shift.end_time) {
      return c.json(
        { success: false, error: { code: "BAD_REQUEST", message: "El turno ya fue cerrado" } },
        400,
      );
    }

    const [updated] = await db
      .update(schema.shifts)
      .set({ end_time: new Date() })
      .where(eq(schema.shifts.id, id))
      .returning();

    return c.json({ success: true, data: updated });
  },
);

export { staff };
