import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, or, gte, lt, desc, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { Context } from "hono";
import { db, schema } from "@restai/db";
import { authMiddleware } from "../middleware/auth.js";
import {
  tenantMiddleware,
  getAccessibleBranchIds,
  hasGlobalBranchAccess,
} from "../middleware/tenant.js";
import { requirePermission } from "../middleware/rbac.js";
import { peruCivilDayStart, peruCivilDayEnd } from "../lib/timezone.js";

/**
 * Consulta de la traza de auditoría.
 *
 * Escribir la traza (apps/api/src/lib/audit.ts) no sirve de nada si nadie puede
 * leerla. Aquí se expone paginada y filtrable para responder las preguntas que
 * un dueño hace de verdad: "¿quién anuló la venta de S/ 380 del viernes?",
 * "¿quién bajó el IGV?", "¿qué tocó este cajero durante su turno?".
 *
 * Se devuelven `user_email` y `user_role` tal y como se guardaron (snapshots):
 * la traza tiene que seguir siendo legible cuando el empleado ya no exista en
 * la tabla `users`. `user_name` viene del JOIN y es null si ya se borró: es
 * información de cortesía, no la fuente de verdad.
 */

const audit = new Hono<AppEnv>();

audit.use("*", authMiddleware);
audit.use("*", tenantMiddleware);

const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

const auditQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    action: z.string().max(100).optional(),
    entityType: z.string().max(50).optional(),
    entityId: z.string().uuid().optional(),
    userId: z.string().uuid().optional(),
    startDate: z.string().regex(CIVIL_DATE, "Formato de fecha inválido (YYYY-MM-DD)").optional(),
    endDate: z.string().regex(CIVIL_DATE, "Formato de fecha inválido (YYYY-MM-DD)").optional(),
  })
  .refine((q) => !(q.startDate && q.endDate) || q.startDate <= q.endDate, {
    message: "Rango de fechas inválido",
    path: ["startDate"],
  });

/**
 * Condiciones de visibilidad.
 *
 * - Siempre acotado a la organización del token.
 * - Si la petición trae x-branch-id (ya validado por tenantMiddleware), se
 *   filtra por esa sede. OJO: para los roles globales se incluyen ADEMÁS las
 *   entradas sin sede (ámbito organización: cambios de configuración global,
 *   alta de sedes, datos fiscales). El panel manda siempre x-branch-id porque
 *   tiene un selector de sede permanente, así que sin esta excepción el
 *   org_admin no vería NUNCA la mitad más sensible de su propia traza.
 * - Sin x-branch-id, los roles no globales solo ven las sedes de las que son
 *   miembros; las entradas sin sede quedan reservadas a org_admin/super_admin.
 *
 * Devuelve `null` cuando el usuario no puede ver absolutamente nada, para que
 * el endpoint responda vacío sin lanzar una consulta con `IN ()`.
 */
async function scopeConditions(c: Context<AppEnv>): Promise<SQL[] | null> {
  const tenant = c.get("tenant") as any;
  const user = c.get("user") as any;
  const conditions: SQL[] = [eq(schema.auditLogs.organization_id, tenant.organizationId)];

  if (tenant.branchId) {
    const branchMatch = eq(schema.auditLogs.branch_id, tenant.branchId);
    conditions.push(
      hasGlobalBranchAccess(user?.role)
        ? or(branchMatch, isNull(schema.auditLogs.branch_id))!
        : branchMatch,
    );
    return conditions;
  }

  const accessible = await getAccessibleBranchIds(c);
  if (accessible === null) return conditions;
  if (accessible.length === 0) return null;
  conditions.push(inArray(schema.auditLogs.branch_id, accessible));
  return conditions;
}

// GET / - Traza paginada, del cambio más reciente al más antiguo.
audit.get(
  "/",
  requirePermission("audit:read"),
  zValidator("query", auditQuerySchema),
  async (c) => {
    const { page, limit, action, entityType, entityId, userId, startDate, endDate } =
      c.req.valid("query");

    const scope = await scopeConditions(c);
    if (!scope) {
      return c.json({
        success: true,
        data: [],
        pagination: { page, limit, total: 0, totalPages: 0 },
      });
    }

    const conditions = [...scope];
    if (action) conditions.push(eq(schema.auditLogs.action, action));
    if (entityType) conditions.push(eq(schema.auditLogs.entity_type, entityType));
    if (entityId) conditions.push(eq(schema.auditLogs.entity_id, entityId));
    if (userId) conditions.push(eq(schema.auditLogs.user_id, userId));
    // Fechas civiles peruanas: el usuario elige "07/08" en el DatePicker y
    // espera el día 7 de Lima, no la ventana UTC equivalente.
    if (startDate) conditions.push(gte(schema.auditLogs.created_at, peruCivilDayStart(startDate)));
    if (endDate) conditions.push(lt(schema.auditLogs.created_at, peruCivilDayEnd(endDate)));

    const whereClause = and(...conditions);
    const offset = (page - 1) * limit;

    const [rows, countResult] = await Promise.all([
      db
        .select({
          id: schema.auditLogs.id,
          action: schema.auditLogs.action,
          entity_type: schema.auditLogs.entity_type,
          entity_id: schema.auditLogs.entity_id,
          summary: schema.auditLogs.summary,
          before: schema.auditLogs.before,
          after: schema.auditLogs.after,
          ip: schema.auditLogs.ip,
          created_at: schema.auditLogs.created_at,
          user_id: schema.auditLogs.user_id,
          user_email: schema.auditLogs.user_email,
          user_role: schema.auditLogs.user_role,
          user_name: schema.users.name,
          branch_id: schema.auditLogs.branch_id,
          branch_name: schema.branches.name,
        })
        .from(schema.auditLogs)
        .leftJoin(schema.users, eq(schema.auditLogs.user_id, schema.users.id))
        .leftJoin(schema.branches, eq(schema.auditLogs.branch_id, schema.branches.id))
        .where(whereClause)
        // `id` como desempate para que la paginación sea estable cuando dos
        // entradas comparten el mismo instante (pasa dentro de una transacción).
        .orderBy(desc(schema.auditLogs.created_at), desc(schema.auditLogs.id))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(schema.auditLogs)
        .where(whereClause),
    ]);

    const total = countResult[0]?.count ?? 0;

    return c.json({
      success: true,
      data: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  },
);

// GET /filters - Valores presentes en la traza, para poblar los desplegables.
//
// Sin esto la pantalla de auditoría obliga a teclear "payment.void" de memoria.
// Se listan solo los valores que existen realmente en el ámbito del usuario.
audit.get("/filters", requirePermission("audit:read"), async (c) => {
  const scope = await scopeConditions(c);
  if (!scope) {
    return c.json({ success: true, data: { actions: [], entityTypes: [], users: [] } });
  }

  const whereClause = and(...scope);

  const [actions, entityTypes, users] = await Promise.all([
    db
      .selectDistinct({ action: schema.auditLogs.action })
      .from(schema.auditLogs)
      .where(whereClause)
      .orderBy(schema.auditLogs.action),
    db
      .selectDistinct({ entityType: schema.auditLogs.entity_type })
      .from(schema.auditLogs)
      .where(whereClause)
      .orderBy(schema.auditLogs.entity_type),
    db
      .selectDistinct({
        userId: schema.auditLogs.user_id,
        userEmail: schema.auditLogs.user_email,
        userRole: schema.auditLogs.user_role,
      })
      .from(schema.auditLogs)
      .where(whereClause)
      .orderBy(schema.auditLogs.user_email),
  ]);

  // `selectDistinct` distingue por la TERNA (id, email, rol), así que un usuario
  // que cambió de correo o de rol salía repetido en el desplegable —y las dos
  // entradas filtran exactamente lo mismo, porque el filtro es por `userId`—.
  // Se colapsa por id quedándose con el snapshot más reciente.
  const usersById = new Map<string, { id: string; email: string | null; role: string | null }>();
  for (const u of users) {
    if (!u.userId) continue;
    usersById.set(u.userId, { id: u.userId, email: u.userEmail, role: u.userRole });
  }

  return c.json({
    success: true,
    data: {
      actions: actions.map((a) => a.action),
      entityTypes: entityTypes.map((e) => e.entityType),
      users: [...usersById.values()].sort((a, b) =>
        (a.email ?? "").localeCompare(b.email ?? ""),
      ),
    },
  });
});

export { audit };
