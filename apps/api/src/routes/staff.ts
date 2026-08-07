import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../types.js";
import { zValidator } from "@hono/zod-validator";
import { eq, and, desc, gte, lte, inArray, isNull, ne, count } from "drizzle-orm";
import { db, schema } from "@restai/db";
import { createUserSchema, idParamSchema } from "@restai/validators";
import { ROLES, PERMISSIONS } from "@restai/config";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import {
  tenantMiddleware,
  requireBranch,
  getAccessibleBranchIds,
} from "../middleware/tenant.js";
import { requirePermission } from "../middleware/rbac.js";
import { hashPassword } from "../lib/hash.js";
import { auditFromContext } from "../lib/audit.js";

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

/**
 * Valida la lista de sedes que se pretende asignar a un empleado.
 *
 * Dos comprobaciones, y las dos hacen falta:
 *
 * 1. Las sedes existen y son de esta organización. Sin esto se escribe una
 *    pertenencia a la sede de otro cliente.
 * 2. El llamador ALCANZA esas sedes. Sin esto, la autorización por sede es
 *    decorativa: quien solo gestiona Surco se asigna Miraflores y pasa a leer
 *    sus ventas, su auditoría y a renombrar la sede (lo que invalida los QR ya
 *    impresos). Los roles globales (super_admin, org_admin) no tienen techo
 *    aquí, que es justo lo que los hace globales.
 *
 * Devuelve `null` si todo es correcto, o el error a responder.
 */
async function validateAssignableBranches(
  c: Context<AppEnv>,
  branchIds: string[],
): Promise<{ code: string; message: string; status: 400 | 403 } | null> {
  if (branchIds.length === 0) return null;
  const tenant = c.get("tenant") as any;

  const ownedBranches = await db
    .select({ id: schema.branches.id })
    .from(schema.branches)
    .where(
      and(
        inArray(schema.branches.id, branchIds),
        eq(schema.branches.organization_id, tenant.organizationId),
      ),
    );

  // `branchIds` puede traer repetidos: comparar longitudes sin deduplicar
  // rechazaría una lista válida, así que se comprueba la pertenencia real.
  const owned = new Set(ownedBranches.map((b) => b.id));
  if (branchIds.some((id) => !owned.has(id))) {
    return { code: "BAD_REQUEST", message: "Una o más sedes no son válidas", status: 400 };
  }

  const accessible = await getAccessibleBranchIds(c);
  if (accessible === null) return null; // rol global: sin techo de sede

  const reachable = new Set(accessible);
  if (branchIds.some((id) => !reachable.has(id))) {
    return {
      code: "FORBIDDEN",
      message: "No puedes asignar sedes que tú mismo no gestionas",
      status: 403,
    };
  }

  return null;
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

    // Las sedes deben ser de esta organización Y estar al alcance del llamador:
    // si no, un gerente daría de alta empleados en sedes que él no gestiona.
    const branchError = await validateAssignableBranches(c, body.branchIds);
    if (branchError) {
      return c.json(
        { success: false, error: { code: branchError.code, message: branchError.message } },
        branchError.status,
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

    // Verify user belongs to this org.
    // Se traen también nombre y estado porque son el "antes" de la traza de
    // auditoría que se escribe al final.
    const [user] = await db
      .select({
        id: schema.users.id,
        role: schema.users.role,
        name: schema.users.name,
        email: schema.users.email,
        is_active: schema.users.is_active,
      })
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

    // Cambio de sedes.
    //
    // Nadie reescribe sus PROPIAS sedes, por la misma razón por la que nadie se
    // cambia su propio rol: sería la vía directa para saltarse el techo. Un
    // gerente de una sede se asignaba toda la organización con un
    // `PATCH /api/staff/<su id>` y, como la pertenencia se lee de la base y no
    // del token, el ascenso surtía efecto de inmediato y sin dejar rastro.
    if (body.branchIds !== undefined) {
      if (id === caller.sub) {
        return c.json(
          {
            success: false,
            error: { code: "FORBIDDEN", message: "No puedes cambiar tus propias sedes" },
          },
          403,
        );
      }

      const branchError = await validateAssignableBranches(c, body.branchIds);
      if (branchError) {
        return c.json(
          { success: false, error: { code: branchError.code, message: branchError.message } },
          branchError.status,
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
    let sedesAntes: string[] | undefined;
    if (body.branchIds !== undefined) {
      // Se leen ANTES de borrarlas: son el "antes" de la traza, y una vez hecho
      // el DELETE ya no hay forma de reconstruir a qué sedes pertenecía.
      const previas = await db
        .select({ branch_id: schema.userBranches.branch_id })
        .from(schema.userBranches)
        .where(eq(schema.userBranches.user_id, id));
      sedesAntes = previas.map((p) => p.branch_id);

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

    // Traza. Cambiar el rol o las sedes de un empleado decide qué dinero puede
    // mover y qué locales puede ver: sin registro, un ascenso indebido era
    // indistinguible de un alta legítima al revisar el histórico.
    await auditFromContext(c, {
      action: "staff.update",
      entityType: "user",
      entityId: id,
      summary: `Se modificó a ${user.name ?? user.email}`,
      before: {
        name: user.name,
        role: user.role,
        is_active: user.is_active,
        ...(sedesAntes !== undefined ? { branch_ids: sedesAntes } : {}),
      },
      after: {
        name: body.name ?? user.name,
        role: body.role ?? user.role,
        is_active: body.isActive ?? user.is_active,
        ...(body.branchIds !== undefined ? { branch_ids: body.branchIds } : {}),
      },
    });

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
    const caller = c.get("user") as any;

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

    // Techo de rol, idéntico al de PATCH /:id. Sin esto, cualquiera con
    // `staff:update` (un branch_manager) podía reescribir la contraseña de un
    // org_admin y entrar como dueño: escalada vertical en dos clics.
    if (id !== caller.sub && !canAssignRole(caller.role, user.role)) {
      return c.json(
        {
          success: false,
          error: {
            code: "FORBIDDEN",
            message: "No puedes cambiar la contraseña de este usuario",
          },
        },
        403,
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
