import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../types.js";
import { zValidator } from "@hono/zod-validator";
import { eq, and, ne, inArray, asc, count } from "drizzle-orm";
import { db, schema } from "@restai/db";
import { generarCodigoPublicoDeSede } from "../lib/branch-code.js";
import { createBranchSchema, updateBranchSchema, idParamSchema } from "@restai/validators";
import { authMiddleware } from "../middleware/auth.js";
import {
  tenantMiddleware,
  getAccessibleBranchIds,
  hasGlobalBranchAccess,
} from "../middleware/tenant.js";
import { requirePermission } from "../middleware/rbac.js";
import { audit, actorFromContext } from "../lib/audit.js";

const branches = new Hono<AppEnv>();

branches.use("*", authMiddleware);
branches.use("*", tenantMiddleware);

/**
 * Actor de auditoría enriquecido.
 *
 * El JWT no lleva el email del usuario, así que `actorFromContext` dejaría el
 * snapshot `user_email` en null y la traza sería ilegible en cuanto el empleado
 * dejara la empresa. Aquí se completa desde la BD (una sola consulta, solo en
 * los endpoints que escriben) y se fija la sede afectada, que no tiene por qué
 * coincidir con la sede seleccionada en la cabecera.
 */
async function branchAuditActor(c: Context, branchId: string | null) {
  const actor = actorFromContext(c);
  if (!actor) return null;
  actor.branchId = branchId;
  if (!actor.userEmail && actor.userId) {
    const [row] = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, actor.userId))
      .limit(1);
    actor.userEmail = row?.email ?? null;
  }
  return actor;
}

/**
 * ¿Es una violación de índice único de Postgres?
 *
 * `branches_org_slug_unique` existe en la BD, así que comprobar el choque de
 * slug ANTES del insert/update reduce la carrera pero no la elimina: dos
 * peticiones simultáneas pueden pasar ambas la comprobación. Sin esto la
 * segunda recibía un 500 con un mensaje de driver; con esto recibe el mismo 409
 * que si hubiera llegado un segundo después.
 */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

const slugConflict = {
  success: false as const,
  error: { code: "CONFLICT", message: "El slug de sucursal ya existe" },
};

// GET / - Sedes visibles para el usuario dentro de su organización.
//
// La autorización baja aquí a nivel de sede: un gerente solo ve las sedes de
// las que es miembro. org_admin y super_admin ven todas las de la organización.
branches.get("/", requirePermission("branch:read"), async (c) => {
  const tenant = c.get("tenant") as any;
  const accessible = await getAccessibleBranchIds(c);

  if (accessible !== null && accessible.length === 0) {
    return c.json({ success: true, data: [] });
  }

  const conditions = [eq(schema.branches.organization_id, tenant.organizationId)];
  if (accessible !== null) {
    conditions.push(inArray(schema.branches.id, accessible));
  }

  const result = await db
    .select()
    .from(schema.branches)
    .where(and(...conditions))
    .orderBy(asc(schema.branches.name));

  // Cabecera fiscal del emisor, adjunta a cada sede.
  //
  // El RUC y la razón social viven en `organizations`, cuyo endpoint exige
  // `settings:read` — permiso que NI el cajero NI el mozo tienen. Resultado: el
  // recibo que imprimen justamente ellos salía sin el dato que identifica al
  // negocio. No son datos sensibles (van impresos en cada comprobante), así que
  // se exponen aquí, donde basta `branch:read`.
  const [org] = await db
    .select({
      name: schema.organizations.name,
      legal_name: schema.organizations.legal_name,
      ruc: schema.organizations.ruc,
      logo_url: schema.organizations.logo_url,
    })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, tenant.organizationId))
    .limit(1);

  const withIssuer = result.map((branch) => ({
    ...branch,
    issuer: org
      ? {
          name: org.name,
          legal_name: org.legal_name,
          ruc: org.ruc,
          logo_url: org.logo_url,
        }
      : null,
  }));

  return c.json({ success: true, data: withIssuer });
});

// POST / - Create branch
branches.post(
  "/",
  requirePermission("branch:create"),
  zValidator("json", createBranchSchema),
  async (c) => {
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;
    const user = c.get("user") as any;

    // Check slug uniqueness within org
    const existing = await db
      .select({ id: schema.branches.id })
      .from(schema.branches)
      .where(
        and(
          eq(schema.branches.organization_id, tenant.organizationId),
          eq(schema.branches.slug, body.slug),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      return c.json(slugConflict, 409);
    }

    let branch: typeof schema.branches.$inferSelect;
    try {
      branch = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(schema.branches)
          .values({
            organization_id: tenant.organizationId,
            name: body.name,
            slug: body.slug,
            address: body.address,
            phone: body.phone,
            timezone: body.timezone,
            currency: body.currency,
            tax_rate: body.taxRate,
            public_code: await generarCodigoPublicoDeSede(tx),
          })
          .returning();

        // Si quien crea la sede no es un rol global, se le da de alta como miembro:
        // de otro modo acabaría de crear una sede que no puede ni ver.
        if (!hasGlobalBranchAccess(user?.role) && user?.sub) {
          await tx
            .insert(schema.userBranches)
            .values({ user_id: user.sub, branch_id: created.id })
            .onConflictDoNothing();
        }

        return created;
      });
    } catch (err) {
      if (isUniqueViolation(err)) return c.json(slugConflict, 409);
      throw err;
    }

    await audit(await branchAuditActor(c, branch.id), {
      action: "branch.create",
      entityType: "branch",
      entityId: branch.id,
      summary: `Sede creada: ${branch.name} (${branch.slug})`,
      after: { name: branch.name, slug: branch.slug, tax_rate: branch.tax_rate },
    });

    return c.json({ success: true, data: branch }, 201);
  },
);

// GET /:id
branches.get(
  "/:id",
  requirePermission("branch:read"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;
    const accessible = await getAccessibleBranchIds(c);

    if (accessible !== null && !accessible.includes(id)) {
      return c.json(
        { success: false, error: { code: "FORBIDDEN", message: "No tienes acceso a esta sucursal" } },
        403,
      );
    }

    const [branch] = await db
      .select()
      .from(schema.branches)
      .where(
        and(
          eq(schema.branches.id, id),
          eq(schema.branches.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!branch) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Sucursal no encontrada" } },
        404,
      );
    }

    return c.json({ success: true, data: branch });
  },
);

// PATCH /:id
branches.patch(
  "/:id",
  requirePermission("branch:update"),
  zValidator("param", idParamSchema),
  zValidator("json", updateBranchSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    // La autorización también baja a nivel de sede al escribir: sin esto, el
    // gerente de una sede podía renombrar (y re-sluggear) cualquier otra de la
    // cadena.
    const accessible = await getAccessibleBranchIds(c);
    if (accessible !== null && !accessible.includes(id)) {
      return c.json(
        { success: false, error: { code: "FORBIDDEN", message: "No tienes acceso a esta sucursal" } },
        403,
      );
    }

    // Campos escribibles: clave del body -> columna. Se declara una sola vez
    // para que el `set`, el diff auditado y el summary no puedan divergir.
    const FIELD_MAP = [
      ["name", "name"],
      ["slug", "slug"],
      ["address", "address"],
      ["phone", "phone"],
      ["timezone", "timezone"],
      ["currency", "currency"],
      ["taxRate", "tax_rate"],
    ] as const;

    type PatchOutcome =
      | { kind: "not_found" }
      | { kind: "conflict" }
      | {
          kind: "ok";
          updated: typeof schema.branches.$inferSelect;
          slugChanged: boolean;
          affectedTables: number;
          changedFields: string[];
          before: Record<string, unknown>;
          after: Record<string, unknown>;
          previousSlug: string;
        };

    // Todo dentro de una transacción con la fila bloqueada: el slug es estado
    // compartido (de él cuelgan los QR impresos de la sede). Sin el bloqueo, dos
    // PATCH simultáneos podían leer el mismo `current`, pasar los dos la
    // comprobación de choque y dejar una traza de auditoría con un `before` que
    // nunca existió.
    let outcome: PatchOutcome;
    try {
      outcome = await db.transaction(async (tx): Promise<PatchOutcome> => {
        const [current] = await tx
          .select()
          .from(schema.branches)
          .where(
            and(
              eq(schema.branches.id, id),
              eq(schema.branches.organization_id, tenant.organizationId),
            ),
          )
          .limit(1)
          .for("update");

        if (!current) return { kind: "not_found" };

        const row = current as unknown as Record<string, unknown>;

        // Solo se consideran cambios los que cambian de verdad: reenviar el
        // formulario entero sin tocar nada no debe ensuciar la traza ni disparar
        // el aviso de QR invalidados.
        const updateData: Record<string, unknown> = {};
        const before: Record<string, unknown> = {};
        const after: Record<string, unknown> = {};
        for (const [bodyKey, column] of FIELD_MAP) {
          const value = (body as Record<string, unknown>)[bodyKey];
          if (value === undefined) continue;
          if (value === row[column]) continue;
          updateData[column] = value;
          before[column] = row[column];
          after[column] = value;
        }

        const changedFields = Object.keys(updateData);
        const slugChanged = changedFields.includes("slug");

        // El slug es único por organización a nivel de BD; comprobarlo antes
        // permite responder 409 en vez de un 500 por violación de constraint.
        if (slugChanged) {
          const [clash] = await tx
            .select({ id: schema.branches.id })
            .from(schema.branches)
            .where(
              and(
                eq(schema.branches.organization_id, tenant.organizationId),
                eq(schema.branches.slug, body.slug!),
                ne(schema.branches.id, id),
              ),
            )
            .limit(1);

          if (clash) return { kind: "conflict" };
        }

        let updated = current;
        if (changedFields.length > 0) {
          const [written] = await tx
            .update(schema.branches)
            .set({ ...updateData, updated_at: new Date() })
            .where(
              and(
                eq(schema.branches.id, id),
                eq(schema.branches.organization_id, tenant.organizationId),
              ),
            )
            .returning();
          if (!written) return { kind: "not_found" };
          updated = written;
        }

        // Cambiar el slug rompe TODOS los QR impresos de la sede: la URL del
        // comensal es /:branchSlug/:tableCode, así que los stickers de las mesas
        // apuntan a una sede que ya no resuelve. Se avisa explícitamente con el
        // número de mesas afectadas para que la UI pueda exigir confirmación y
        // ofrecer la reimpresión.
        let affectedTables = 0;
        if (slugChanged) {
          const [counted] = await tx
            .select({ n: count() })
            .from(schema.tables)
            .where(eq(schema.tables.branch_id, id));
          affectedTables = counted?.n ?? 0;
        }

        return {
          kind: "ok",
          updated,
          slugChanged,
          affectedTables,
          changedFields,
          before,
          after,
          previousSlug: current.slug,
        };
      });
    } catch (err) {
      if (isUniqueViolation(err)) return c.json(slugConflict, 409);
      throw err;
    }

    if (outcome.kind === "not_found") {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Sucursal no encontrada" } },
        404,
      );
    }
    if (outcome.kind === "conflict") {
      return c.json(slugConflict, 409);
    }

    const { updated, slugChanged, affectedTables, changedFields, before, after } = outcome;

    // La traza solo se escribe si hubo cambio real: un PATCH que no cambia nada
    // no es un hecho auditable.
    if (changedFields.length > 0) {
      await audit(await branchAuditActor(c, id), {
        action: "branch.update",
        entityType: "branch",
        entityId: id,
        summary: slugChanged
          ? `Sede ${updated.name}: slug ${outcome.previousSlug} → ${updated.slug} (invalida ${affectedTables} QR impresos)`
          : `Sede ${updated.name}: ${changedFields.join(", ")}`,
        before,
        after,
      });
    }

    return c.json({
      success: true,
      data: updated,
      qr_invalidated: slugChanged,
      affected_tables: affectedTables,
    });
  },
);

export { branches };
