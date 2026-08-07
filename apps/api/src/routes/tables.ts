import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { zValidator } from "@hono/zod-validator";
import { eq, and, isNull, desc, ne, inArray, notInArray, sql } from "drizzle-orm";
import { db, schema } from "@restai/db";
import {
  createTableSchema,
  updateTableStatusSchema,
  startSessionSchema,
  idParamSchema,
} from "@restai/validators";
import { z } from "zod";
import { TABLE_STATUS_TRANSITIONS, PERMISSIONS } from "@restai/config";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware, requireBranch } from "../middleware/tenant.js";
import { requirePermission } from "../middleware/rbac.js";
import { generateQrCode, generateShortCode } from "../lib/id.js";
import { signCustomerToken } from "../lib/jwt.js";
import { auditFromContext, auditMoney } from "../lib/audit.js";
import { realtime } from "../infrastructure/container.js";
import * as sessionService from "../services/session.service.js";
import { handleOrderCompletion } from "../services/order.service.js";
import type { Context } from "hono";

const tables = new Hono<AppEnv>();

tables.use("*", authMiddleware);
tables.use("*", tenantMiddleware);
tables.use("*", requireBranch);

// ── Esquemas propios de este módulo ─────────────────────────────────
// Definidos aquí a propósito: son contratos que solo usa esta ruta.

const moveSessionSchema = z.object({
  targetTableId: z.string().uuid(),
});

const mergeSessionsSchema = z.object({
  sourceTableIds: z.array(z.string().uuid()).min(1).max(20),
});

/** Traducción de los errores de mover/juntar a HTTP. */
const TRANSFER_ERROR_STATUS = {
  TABLE_NOT_FOUND: 404,
  TARGET_TABLE_NOT_FOUND: 404,
  SOURCE_TABLE_NOT_FOUND: 404,
  SAME_TABLE: 400,
  NO_ACTIVE_SESSION: 409,
  TARGET_NOT_AVAILABLE: 409,
  TARGET_HAS_SESSION: 409,
  SOURCE_WITHOUT_SESSION: 409,
} as const satisfies Record<string, 400 | 404 | 409>;

/**
 * Comprobación de permiso dentro del handler, para las decisiones que dependen
 * del cuerpo/query y no del endpoint (liberar una mesa con saldo pendiente).
 * Replica la resolución de comodines de `requirePermission`.
 */
function callerHasPermission(c: Context, permission: string): boolean {
  const user = c.get("user") as any;
  const perms =
    (PERMISSIONS[user?.role as keyof typeof PERMISSIONS] as readonly string[] | undefined) ?? [];
  if (perms.includes("*")) return true;
  const [resource] = permission.split(":");
  return perms.includes(permission) || perms.includes(`${resource}:*`);
}

// GET / - List tables for branch (optional spaceId filter)
tables.get("/", requirePermission("tables:read"), async (c) => {
  const tenant = c.get("tenant") as any;
  const spaceId = c.req.query("spaceId");

  const conditions = [
    eq(schema.tables.branch_id, tenant.branchId),
    eq(schema.tables.organization_id, tenant.organizationId),
  ];

  if (spaceId === "none") {
    conditions.push(isNull(schema.tables.space_id));
  } else if (spaceId) {
    conditions.push(eq(schema.tables.space_id, spaceId));
  }

  // Lista explícita de columnas: `short_code` es parte del contrato con la UI
  // (va impreso en el cartel de la mesa, junto al QR, como plan B para el
  // comensal que no puede escanear), así que no puede depender de un `select()`
  // implícito que un cambio de esquema podría alterar sin avisar.
  const result = await db
    .select({
      id: schema.tables.id,
      branch_id: schema.tables.branch_id,
      organization_id: schema.tables.organization_id,
      space_id: schema.tables.space_id,
      number: schema.tables.number,
      capacity: schema.tables.capacity,
      qr_code: schema.tables.qr_code,
      short_code: schema.tables.short_code,
      status: schema.tables.status,
      position_x: schema.tables.position_x,
      position_y: schema.tables.position_y,
      created_at: schema.tables.created_at,
    })
    .from(schema.tables)
    .where(and(...conditions));

  const [branch] = await db
    .select({ slug: schema.branches.slug })
    .from(schema.branches)
    .where(eq(schema.branches.id, tenant.branchId))
    .limit(1);

  return c.json({ success: true, data: { tables: result, branchSlug: branch?.slug || "" } });
});

// POST / - Create table
tables.post(
  "/",
  requirePermission("tables:create"),
  zValidator("json", createTableSchema),
  async (c) => {
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    // Verify space belongs to this tenant/branch when provided
    if (body.spaceId) {
      const [space] = await db
        .select({ id: schema.spaces.id })
        .from(schema.spaces)
        .where(
          and(
            eq(schema.spaces.id, body.spaceId),
            eq(schema.spaces.branch_id, tenant.branchId),
            eq(schema.spaces.organization_id, tenant.organizationId),
          ),
        )
        .limit(1);

      if (!space) {
        return c.json(
          { success: false, error: { code: "BAD_REQUEST", message: "Espacio no encontrado" } },
          400,
        );
      }
    }

    // Get branch slug for QR code
    const [branch] = await db
      .select({ slug: schema.branches.slug })
      .from(schema.branches)
      .where(eq(schema.branches.id, tenant.branchId))
      .limit(1);

    const qrCode = generateQrCode(branch?.slug || "branch", body.number);

    // El código corto es único por sede. La colisión es improbable (30^5) pero
    // posible, y la garantiza el índice único: se reintenta ante 23505 en vez de
    // confiar en un SELECT previo, que sería vulnerable a carrera.
    let table;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        [table] = await db
          .insert(schema.tables)
          .values({
            branch_id: tenant.branchId,
            organization_id: tenant.organizationId,
            space_id: body.spaceId || null,
            number: body.number,
            capacity: body.capacity,
            qr_code: qrCode,
            short_code: generateShortCode(),
          })
          .returning();
        break;
      } catch (err: any) {
        const isShortCodeCollision =
          err?.code === "23505" && String(err?.constraint_name ?? err?.constraint ?? "").includes("short_code");
        if (!isShortCodeCollision || attempt === 4) throw err;
      }
    }

    return c.json({ success: true, data: table }, 201);
  },
);

// PATCH /:id - Update table
tables.patch(
  "/:id",
  requirePermission("tables:update"),
  zValidator("param", idParamSchema),
  zValidator("json", z.object({
    capacity: z.number().int().min(1).max(50).optional(),
    spaceId: z.string().uuid().nullable().optional(),
  })),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    // Verify space belongs to this tenant/branch when provided (non-null)
    if (body.spaceId) {
      const [space] = await db
        .select({ id: schema.spaces.id })
        .from(schema.spaces)
        .where(
          and(
            eq(schema.spaces.id, body.spaceId),
            eq(schema.spaces.branch_id, tenant.branchId),
            eq(schema.spaces.organization_id, tenant.organizationId),
          ),
        )
        .limit(1);

      if (!space) {
        return c.json(
          { success: false, error: { code: "BAD_REQUEST", message: "Espacio no encontrado" } },
          400,
        );
      }
    }

    const updateData: Record<string, any> = {};
    if (body.capacity !== undefined) updateData.capacity = body.capacity;
    if (body.spaceId !== undefined) updateData.space_id = body.spaceId;

    const [updated] = await db
      .update(schema.tables)
      .set(updateData)
      .where(
        and(
          eq(schema.tables.id, id),
          eq(schema.tables.branch_id, tenant.branchId),
          eq(schema.tables.organization_id, tenant.organizationId),
        ),
      )
      .returning();

    if (!updated) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Mesa no encontrada" } },
        404,
      );
    }

    return c.json({ success: true, data: updated });
  },
);

// PATCH /:id/position - Persiste la posición de la mesa en el plano del local.
// Exige `tables:layout` y no `tables:update`: mover el plano es configurar el
// local, no operar una mesa. El mozo arrastra mesas en su pantalla, pero no
// puede rehacer la distribución del salón para todos.
tables.patch(
  "/:id/position",
  requirePermission("tables:layout"),
  zValidator("param", idParamSchema),
  zValidator("json", z.object({ x: z.number(), y: z.number() })),
  async (c) => {
    const { id } = c.req.valid("param");
    const { x, y } = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const [updated] = await db
      .update(schema.tables)
      .set({ position_x: x, position_y: y })
      .where(
        and(
          eq(schema.tables.id, id),
          eq(schema.tables.branch_id, tenant.branchId),
          eq(schema.tables.organization_id, tenant.organizationId),
        ),
      )
      .returning();

    if (!updated) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Mesa no encontrada" } },
        404,
      );
    }

    return c.json({ success: true, data: updated });
  },
);

// DELETE /:id - Borra una mesa. Exige `tables:delete` (no el genérico
// `tables:update`): borrar mesas es destruir la configuración del local y no
// puede quedar al alcance de quien solo atiende el salón.
tables.delete(
  "/:id",
  requirePermission("tables:delete"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    // Verify the table belongs to this tenant/branch before any destructive action
    const [table] = await db
      .select({ id: schema.tables.id, number: schema.tables.number, short_code: schema.tables.short_code })
      .from(schema.tables)
      .where(
        and(
          eq(schema.tables.id, id),
          eq(schema.tables.branch_id, tenant.branchId),
          eq(schema.tables.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!table) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Mesa no encontrada" } },
        404,
      );
    }

    // tableSessions.table_id is onDelete:'cascade', so a hard delete would erase
    // session + order history. Block deletion if there is any non-completed activity.
    const [activeSession] = await db
      .select({ id: schema.tableSessions.id })
      .from(schema.tableSessions)
      .where(
        and(
          eq(schema.tableSessions.table_id, id),
          eq(schema.tableSessions.branch_id, tenant.branchId),
          eq(schema.tableSessions.organization_id, tenant.organizationId),
          inArray(schema.tableSessions.status, ["pending", "active"]),
        ),
      )
      .limit(1);

    if (activeSession) {
      return c.json(
        {
          success: false,
          error: {
            code: "CONFLICT",
            message: "No se puede eliminar la mesa: tiene una sesion activa o pendiente",
          },
        },
        409,
      );
    }

    const [openOrder] = await db
      .select({ id: schema.orders.id })
      .from(schema.orders)
      .innerJoin(
        schema.tableSessions,
        eq(schema.orders.table_session_id, schema.tableSessions.id),
      )
      .where(
        and(
          eq(schema.tableSessions.table_id, id),
          eq(schema.orders.branch_id, tenant.branchId),
          eq(schema.orders.organization_id, tenant.organizationId),
          notInArray(schema.orders.status, ["completed", "cancelled"]),
        ),
      )
      .limit(1);

    if (openOrder) {
      return c.json(
        {
          success: false,
          error: {
            code: "CONFLICT",
            message: "No se puede eliminar la mesa: tiene pedidos sin completar",
          },
        },
        409,
      );
    }

    // Any existing session/order history (completed/cancelled) blocks hard deletion
    // to avoid cascade-erasing the audit trail. There is no soft-delete column on
    // tables, so we refuse to destroy history.
    const [historySession] = await db
      .select({ id: schema.tableSessions.id })
      .from(schema.tableSessions)
      .where(
        and(
          eq(schema.tableSessions.table_id, id),
          eq(schema.tableSessions.branch_id, tenant.branchId),
          eq(schema.tableSessions.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (historySession) {
      return c.json(
        {
          success: false,
          error: {
            code: "CONFLICT",
            message: "No se puede eliminar la mesa: tiene historial de sesiones",
          },
        },
        409,
      );
    }

    const [deleted] = await db
      .delete(schema.tables)
      .where(
        and(
          eq(schema.tables.id, id),
          eq(schema.tables.branch_id, tenant.branchId),
          eq(schema.tables.organization_id, tenant.organizationId),
        ),
      )
      .returning();

    if (!deleted) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Mesa no encontrada" } },
        404,
      );
    }

    await auditFromContext(c, {
      action: "table.delete",
      entityType: "table",
      entityId: id,
      summary: `Mesa ${deleted.number} eliminada`,
      before: { number: deleted.number, short_code: deleted.short_code, capacity: deleted.capacity },
    });

    return c.json({ success: true, data: deleted });
  },
);

// PATCH /:id/status - Update table status
tables.patch(
  "/:id/status",
  requirePermission("tables:update"),
  zValidator("param", idParamSchema),
  zValidator("json", updateTableStatusSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const { status } = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    // Get current table
    const [table] = await db
      .select()
      .from(schema.tables)
      .where(
        and(
          eq(schema.tables.id, id),
          eq(schema.tables.branch_id, tenant.branchId),
          eq(schema.tables.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!table) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Mesa no encontrada" } },
        404,
      );
    }

    // Validate status transition
    const allowed = TABLE_STATUS_TRANSITIONS[table.status];
    if (!allowed?.includes(status)) {
      return c.json(
        {
          success: false,
          error: {
            code: "BAD_REQUEST",
            message: `No se puede cambiar de "${table.status}" a "${status}"`,
          },
        },
        400,
      );
    }

    // Atomic transition: only update if the status is still what we validated against
    const [updated] = await db
      .update(schema.tables)
      .set({ status })
      .where(
        and(
          eq(schema.tables.id, id),
          eq(schema.tables.branch_id, tenant.branchId),
          eq(schema.tables.organization_id, tenant.organizationId),
          eq(schema.tables.status, table.status),
        ),
      )
      .returning();

    if (!updated) {
      return c.json(
        {
          success: false,
          error: {
            code: "CONFLICT",
            message: "El estado de la mesa cambio, intenta de nuevo",
          },
        },
        409,
      );
    }

    // Broadcast table status change
    await realtime.publish(`branch:${tenant.branchId}`, {
      type: "table:status",
      payload: { tableId: updated.id, number: updated.number, status: updated.status },
      timestamp: Date.now(),
    });

    return c.json({ success: true, data: updated });
  },
);

// POST /sessions - Staff walk-in seating (creates an active session directly)
tables.post(
  "/sessions",
  requirePermission("tables:update"),
  zValidator(
    "json",
    startSessionSchema.extend({ tableId: z.string().uuid() }),
  ),
  async (c) => {
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    // Get table (scoped to tenant + branch)
    const [table] = await db
      .select()
      .from(schema.tables)
      .where(
        and(
          eq(schema.tables.id, body.tableId),
          eq(schema.tables.branch_id, tenant.branchId),
          eq(schema.tables.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!table) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Mesa no encontrada" } },
        404,
      );
    }

    // Staff can only seat walk-ins on a free table
    if (table.status !== "available" && table.status !== "reserved") {
      return c.json(
        {
          success: false,
          error: { code: "CONFLICT", message: "La mesa no esta disponible" },
        },
        409,
      );
    }

    // El id de la fila se genera ANTES de firmar el token y se fija de forma
    // explícita en el insert. `requireActiveSession` busca la sesión por
    // `tableSessions.id == token.sub`: si dejáramos que la BD generase otro id
    // (defaultRandom), el token firmado apuntaría a una sesión inexistente y
    // cualquier pedido moriría con SESSION_ENDED. La alta asistida —el mozo
    // sienta a un comensal sin QR— dependía de esto y estaba rota.
    const sessionId = crypto.randomUUID();

    const customerToken = await signCustomerToken({
      sub: sessionId,
      org: tenant.organizationId,
      branch: tenant.branchId,
      table: table.id,
    });

    // Create the active session and occupy the table atomically. The table flip is
    // conditional on its current status so a concurrent seating yields a 409.
    let session;
    try {
      session = await db.transaction(async (tx) => {
        const [occupied] = await tx
          .update(schema.tables)
          .set({ status: "occupied" })
          .where(
            and(
              eq(schema.tables.id, table.id),
              eq(schema.tables.branch_id, tenant.branchId),
              eq(schema.tables.organization_id, tenant.organizationId),
              eq(schema.tables.status, table.status),
            ),
          )
          .returning();

        if (!occupied) {
          throw new Error("TABLE_STATUS_CONFLICT");
        }

        // La mesa figura libre, pero puede arrastrar una sesión viva huérfana
        // (el bug de "Liberar no libera" dejaba filas activas sin mesa ocupada).
        // Sentar encima crearía DOS sesiones activas en la misma mesa: la cuenta
        // vieja quedaría invisible y sus pedidos sin cobrar. El UPDATE anterior
        // ya tiene el candado de la fila, así que esta lectura no tiene carrera.
        const [orphan] = await tx
          .select({ id: schema.tableSessions.id })
          .from(schema.tableSessions)
          .where(
            and(
              eq(schema.tableSessions.table_id, table.id),
              eq(schema.tableSessions.branch_id, tenant.branchId),
              eq(schema.tableSessions.organization_id, tenant.organizationId),
              inArray(schema.tableSessions.status, ["active", "pending"]),
            ),
          )
          .limit(1);

        if (orphan) {
          throw new Error("TABLE_HAS_OPEN_SESSION");
        }

        return await sessionService.createSession(
          {
            id: sessionId,
            tableId: table.id,
            branchId: tenant.branchId,
            organizationId: tenant.organizationId,
            customerName: body.customerName,
            customerPhone: body.customerPhone,
            token: customerToken,
            status: "active",
          },
          tx,
        );
      });
    } catch (e: any) {
      if (e.message === "TABLE_STATUS_CONFLICT") {
        return c.json(
          {
            success: false,
            error: { code: "CONFLICT", message: "La mesa no esta disponible" },
          },
          409,
        );
      }
      if (e.message === "TABLE_HAS_OPEN_SESSION") {
        return c.json(
          {
            success: false,
            error: {
              code: "TABLE_HAS_OPEN_SESSION",
              message:
                "La mesa arrastra una cuenta abierta. Libérala antes de sentar a otro cliente.",
            },
          },
          409,
        );
      }
      throw e;
    }

    // Broadcast: session is active and the table is now occupied
    await realtime.publish(`branch:${tenant.branchId}`, {
      type: "session:started",
      payload: {
        sessionId: session.id,
        tableId: table.id,
        tableNumber: table.number,
        customerName: body.customerName,
        status: "active",
      },
      timestamp: Date.now(),
    });

    return c.json({ success: true, data: { session, token: customerToken } }, 201);
  },
);

// GET /sessions - List sessions with optional status filter
tables.get("/sessions", requirePermission("tables:read"), async (c) => {
  const tenant = c.get("tenant") as any;
  const statusParam = c.req.query("status");

  const conditions = [
    eq(schema.tableSessions.branch_id, tenant.branchId),
    eq(schema.tableSessions.organization_id, tenant.organizationId),
  ];

  if (statusParam) {
    conditions.push(eq(schema.tableSessions.status, statusParam as any));
  }

  const sessions = await db
    .select({
      id: schema.tableSessions.id,
      table_id: schema.tableSessions.table_id,
      customer_name: schema.tableSessions.customer_name,
      customer_phone: schema.tableSessions.customer_phone,
      status: schema.tableSessions.status,
      started_at: schema.tableSessions.started_at,
      ended_at: schema.tableSessions.ended_at,
    })
    .from(schema.tableSessions)
    .where(and(...conditions))
    .orderBy(desc(schema.tableSessions.started_at))
    .limit(50);

  // Join with tables to get table numbers
  const tablesData = await db
    .select({ id: schema.tables.id, number: schema.tables.number })
    .from(schema.tables)
    .where(
      and(
        eq(schema.tables.branch_id, tenant.branchId),
        eq(schema.tables.organization_id, tenant.organizationId),
      ),
    );

  const tableMap = new Map(tablesData.map(t => [t.id, t.number]));

  const result = sessions.map(s => ({
    ...s,
    table_number: tableMap.get(s.table_id) ?? 0,
  }));

  return c.json({ success: true, data: result });
});

// GET /sessions/pending - List pending sessions for branch
tables.get("/sessions/pending", requirePermission("tables:read"), async (c) => {
  const tenant = c.get("tenant") as any;

  const sessions = await db
    .select({
      id: schema.tableSessions.id,
      customer_name: schema.tableSessions.customer_name,
      customer_phone: schema.tableSessions.customer_phone,
      started_at: schema.tableSessions.started_at,
      table_id: schema.tableSessions.table_id,
      table_number: schema.tables.number,
    })
    .from(schema.tableSessions)
    .innerJoin(schema.tables, eq(schema.tableSessions.table_id, schema.tables.id))
    .where(
      and(
        eq(schema.tableSessions.branch_id, tenant.branchId),
        eq(schema.tableSessions.organization_id, tenant.organizationId),
        eq(schema.tableSessions.status, "pending"),
      ),
    );

  return c.json({ success: true, data: sessions });
});

// GET /sessions/:id
//
// Exige `tables:read` y devuelve columnas explícitas. Antes iba sin permiso y
// con `select()`: eso servía la columna `token` —el JWT de comensal— a cualquier
// usuario autenticado de la organización, incluida la cocina. Con ese token se
// puede pedir en nombre de la mesa, así que no puede salir nunca por la API.
tables.get(
  "/sessions/:id",
  requirePermission("tables:read"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    const [session] = await db
      .select({
        id: schema.tableSessions.id,
        table_id: schema.tableSessions.table_id,
        branch_id: schema.tableSessions.branch_id,
        organization_id: schema.tableSessions.organization_id,
        customer_name: schema.tableSessions.customer_name,
        customer_phone: schema.tableSessions.customer_phone,
        status: schema.tableSessions.status,
        started_at: schema.tableSessions.started_at,
        ended_at: schema.tableSessions.ended_at,
        expires_at: schema.tableSessions.expires_at,
      })
      .from(schema.tableSessions)
      .where(
        and(
          eq(schema.tableSessions.id, id),
          eq(schema.tableSessions.branch_id, tenant.branchId),
          eq(schema.tableSessions.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!session) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Sesión no encontrada" } },
        404,
      );
    }

    return c.json({ success: true, data: session });
  },
);

// PATCH /sessions/:id/approve - Approve pending session
tables.patch(
  "/sessions/:id/approve",
  requirePermission("tables:update"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    try {
      const result = await sessionService.approveSession({
        sessionId: id,
        branchId: tenant.branchId,
        organizationId: tenant.organizationId,
      });
      const [table] = await db
        .select({ number: schema.tables.number })
        .from(schema.tables)
        .where(
          and(
            eq(schema.tables.id, result.tableId),
            eq(schema.tables.branch_id, tenant.branchId),
            eq(schema.tables.organization_id, tenant.organizationId),
          ),
        )
        .limit(1);

      // Broadcast approval
      await realtime.publish(`branch:${tenant.branchId}`, {
        type: "session:approved",
        payload: { sessionId: id, tableId: result.tableId, tableNumber: table?.number },
        timestamp: Date.now(),
      });
      await realtime.publish(`session:${id}`, {
        type: "session:approved",
        payload: { sessionId: id, tableId: result.tableId, tableNumber: table?.number },
        timestamp: Date.now(),
      });

      return c.json({ success: true, data: result.session });
    } catch (e: any) {
      if (e instanceof sessionService.TableAlreadyActiveError) {
        return c.json(
          {
            success: false,
            error: {
              code: "TABLE_ALREADY_ACTIVE",
              // El mensaje tiene que ser accionable SIN destruir la cuenta en
              // curso: lo normal es que la cuenta abierta sea la del propio
              // comensal (el mozo ya le tomó nota y eso abrió la visita), así
              // que decirle al operador "cierra esa cuenta" sería pedirle que
              // borre una comanda con comida en marcha. Se le ofrecen las dos
              // salidas reales: seguir tomando nota desde el POS, o liberar la
              // mesa solo si la cuenta anterior ya terminó.
              message:
                "La mesa ya tiene una cuenta abierta, así que aceptar este ingreso partiría el saldo en dos. Rechaza la solicitud y sigue tomando los pedidos desde el POS; si la cuenta anterior ya terminó, libera la mesa y pide al comensal que vuelva a escanear.",
              details: { activeSessionId: e.activeSessionId },
            },
          },
          409,
        );
      }
      if (e.message === "PENDING_SESSION_NOT_FOUND") {
        return c.json(
          { success: false, error: { code: "NOT_FOUND", message: "Sesion pendiente no encontrada" } },
          404,
        );
      }
      throw e;
    }
  },
);

// PATCH /sessions/:id/reject - Reject pending session
tables.patch(
  "/sessions/:id/reject",
  requirePermission("tables:update"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    try {
      const result = await sessionService.rejectSession({
        sessionId: id,
        branchId: tenant.branchId,
      });
      const [table] = await db
        .select({ number: schema.tables.number })
        .from(schema.tables)
        .where(
          and(
            eq(schema.tables.id, result.tableId),
            eq(schema.tables.branch_id, tenant.branchId),
            eq(schema.tables.organization_id, tenant.organizationId),
          ),
        )
        .limit(1);

      // Broadcast rejection
      await realtime.publish(`branch:${tenant.branchId}`, {
        type: "session:rejected",
        payload: { sessionId: id, tableId: result.tableId, tableNumber: table?.number },
        timestamp: Date.now(),
      });
      await realtime.publish(`session:${id}`, {
        type: "session:rejected",
        payload: { sessionId: id, tableId: result.tableId, tableNumber: table?.number },
        timestamp: Date.now(),
      });

      return c.json({ success: true, data: result.session });
    } catch (e: any) {
      if (e.message === "PENDING_SESSION_NOT_FOUND") {
        return c.json(
          { success: false, error: { code: "NOT_FOUND", message: "Sesion pendiente no encontrada" } },
          404,
        );
      }
      throw e;
    }
  },
);

// PATCH /sessions/:id/end - End an active session
tables.patch(
  "/sessions/:id/end",
  requirePermission("tables:update"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    // Perdonar el saldo es una decisión de caja, no de sala: exige el mismo
    // permiso que anular un cobro y queda auditado. Idéntico a POST /:id/free.
    const force = c.req.query("force") === "true";
    if (force && !callerHasPermission(c, "payments:void")) {
      return c.json(
        {
          success: false,
          error: {
            code: "FORBIDDEN",
            message: "No tienes permiso para cerrar una mesa con saldo pendiente",
          },
        },
        403,
      );
    }

    try {
      const result = await sessionService.endSession({
        sessionId: id,
        branchId: tenant.branchId,
        force,
      });

      if (force) {
        await auditFromContext(c, {
          action: "session.force_end",
          entityType: "table_session",
          entityId: id,
          summary: "Cierre de sesión forzado con saldo pendiente",
        });
      }
      const [table] = await db
        .select({ number: schema.tables.number })
        .from(schema.tables)
        .where(
          and(
            eq(schema.tables.id, result.tableId),
            eq(schema.tables.branch_id, tenant.branchId),
            eq(schema.tables.organization_id, tenant.organizationId),
          ),
        )
        .limit(1);

      // Broadcast session ended
      await realtime.publish(`branch:${tenant.branchId}`, {
        type: "session:ended",
        payload: { sessionId: id, tableId: result.tableId, tableNumber: table?.number },
        timestamp: Date.now(),
      });
      await realtime.publish(`session:${id}`, {
        type: "session:ended",
        payload: { sessionId: id, tableId: result.tableId, tableNumber: table?.number },
        timestamp: Date.now(),
      });

      return c.json({ success: true, data: result.session });
    } catch (e: any) {
      if (e.message === "ACTIVE_SESSION_NOT_FOUND") {
        return c.json(
          { success: false, error: { code: "NOT_FOUND", message: "Sesión activa no encontrada" } },
          404,
        );
      }
      if (e instanceof sessionService.TableHasBalanceError) {
        return c.json(
          {
            success: false,
            error: {
              code: "TABLE_HAS_BALANCE",
              message: "La mesa tiene una cuenta pendiente de cobro",
              details: { pendingAmount: e.pendingAmount },
            },
          },
          409,
        );
      }
      if (e.message === "SESSION_HAS_OPEN_ORDERS") {
        return c.json(
          {
            success: false,
            error: {
              code: "SESSION_HAS_OPEN_ORDERS",
              message: "La mesa tiene pedidos en curso",
            },
          },
          409,
        );
      }
      throw e;
    }
  },
);

// GET /:id/history - Table history with sessions and orders
tables.get(
  "/:id/history",
  requirePermission("tables:read"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;
    const from = c.req.query("from");
    const to = c.req.query("to");

    try {
      const data = await sessionService.getTableHistory({
        tableId: id,
        branchId: tenant.branchId,
        from: from || undefined,
        to: to || undefined,
      });

      return c.json({ success: true, data });
    } catch (e: any) {
      if (e.message === "TABLE_NOT_FOUND") {
        return c.json(
          { success: false, error: { code: "NOT_FOUND", message: "Mesa no encontrada" } },
          404,
        );
      }
      throw e;
    }
  },
);

// GET /:id/active-session - Current active/pending session for a table + its
// orders with per-order payment status, for the "cobrar desde mesa" dialog.
tables.get(
  "/:id/active-session",
  requirePermission("tables:read"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    // TODAS las visitas vivas de la mesa, no solo la más reciente.
    //
    // Aquí estaba el desencuentro que dejaba al mozo con la razón contra la
    // pantalla: este endpoint cogía UNA sesión (la de `started_at` más alto,
    // que muchas veces es una solicitud de ingreso pendiente y sin pedidos)
    // mientras que el guard de «Liberar» suma las órdenes de TODAS las
    // sesiones vivas de la mesa. Resultado: la pantalla decía "no debe nada" y
    // liberar respondía 409 con un saldo salido de la nada. Ahora ambos parten
    // del mismo conjunto de filas, por construcción.
    const sessions = await sessionService.getLiveTableSessions(db, {
      tableId: id,
      branchId: tenant.branchId,
      organizationId: tenant.organizationId,
    });

    if (sessions.length === 0) {
      return c.json({
        success: true,
        data: { session: null, orders: [], totals: { total: 0, total_paid: 0, remaining: 0 } },
      });
    }

    // La visita principal (activa antes que pendiente) es la que se muestra en
    // la cabecera del diálogo; el dinero, en cambio, es el de todas.
    const session = sessions[0];
    const sessionIds = sessions.map((s) => s.id);

    const orders = await db
      .select({
        id: schema.orders.id,
        order_number: schema.orders.order_number,
        status: schema.orders.status,
        total: schema.orders.total,
        subtotal: schema.orders.subtotal,
        created_at: schema.orders.created_at,
        // Predicado canónico de "cobro real": completado Y no anulado. Sin el
        // `voided_at IS NULL` un cobro anulado seguía dando la orden por
        // pagada aquí, mientras el arqueo y «Liberar» veían la deuda viva.
        //
        // OJO con la correlación: la subconsulta va con alias explícito (`p`) y
        // `orders.id` cualificado. La versión anterior interpolaba la columna
        // con `${schema.orders.id}`, que drizzle renderiza SIN cualificar
        // (`"id"` a secas); dentro del subselect eso resolvía a `payments.id`,
        // así que la condición nunca se cumplía y `total_paid` salía SIEMPRE 0.
        // Efecto en sala: el diálogo daba por impagada una mesa ya cobrada y el
        // cierre automático al llegar el saldo a cero no ocurría jamás.
        total_paid: sql<number>`COALESCE((
          SELECT SUM(p.amount)::bigint
          FROM payments p
          WHERE p.order_id = orders.id
            AND p.status = 'completed'
            AND p.voided_at IS NULL
        ), 0)::int`,
      })
      .from(schema.orders)
      .where(
        and(
          inArray(schema.orders.table_session_id, sessionIds),
          eq(schema.orders.branch_id, tenant.branchId),
          ne(schema.orders.status, "cancelled"),
        ),
      )
      .orderBy(desc(schema.orders.created_at));

    const orderIds = orders.map((o) => o.id);
    const items = orderIds.length
      ? await db
          .select({
            id: schema.orderItems.id,
            order_id: schema.orderItems.order_id,
            name: schema.orderItems.name,
            quantity: schema.orderItems.quantity,
            total: schema.orderItems.total,
            paid_at: schema.orderItems.paid_at,
            // Sin el estado, el diálogo de cobro por ítems ofrecía seleccionar
            // una línea ya anulada ("86" de cocina) y el cobro moría con un 400
            // incomprensible con el cliente delante. Ahora la UI puede tacharla
            // y excluirla del total.
            status: schema.orderItems.status,
            cancel_reason: schema.orderItems.cancel_reason,
          })
          .from(schema.orderItems)
          .where(inArray(schema.orderItems.order_id, orderIds))
      : [];

    const ordersWithDetail = orders.map((o) => {
      const remaining = Math.max(0, o.total - o.total_paid);
      const payment_status = o.total_paid <= 0 ? "unpaid" : remaining > 0 ? "partial" : "paid";
      const lineItems = items.filter((i) => i.order_id === o.id);
      // Per-item "share" allocates the order total (incl. IGV/discount) across its
      // lines proportionally, so split-bill selection sums back to the order total.
      const itemsWithShare = lineItems.map((it) => ({
        ...it,
        paid: it.paid_at != null,
        share:
          o.subtotal > 0
            ? Math.round((it.total * o.total) / o.subtotal)
            : lineItems.length > 0
              ? Math.round(o.total / lineItems.length)
              : 0,
      }));
      return {
        ...o,
        remaining,
        payment_status,
        items: itemsWithShare,
      };
    });

    // `remaining` se calcula igual que en `computeOutstanding` (facturado menos
    // cobrado, con suelo en 0 sobre el TOTAL, no orden a orden): es la misma
    // cifra que decide si «Liberar» pasa o devuelve 409, así que la pantalla no
    // puede sacar otra. Todo en céntimos.
    const billed = ordersWithDetail.reduce((sum, o) => sum + o.total, 0);
    const paid = ordersWithDetail.reduce((sum, o) => sum + o.total_paid, 0);
    const totals = {
      total: billed,
      total_paid: paid,
      remaining: Math.max(0, billed - paid),
    };

    return c.json({ success: true, data: { session, orders: ordersWithDetail, totals } });
  },
);

// POST /:id/free - Free the table for the next customer (the robust "Liberar").
// Closes any active/pending session (clearing orphans), finalizes open orders,
// and sets the table available. See sessionService.freeTable for the rationale.
//
// Guarda de saldo: si la visita tiene cuenta pendiente devuelve 409
// TABLE_HAS_BALANCE con el importe. Liberar sin cobrar convierte un impago en
// venta cerrada (con puntos e inventario ya descontados), así que perdonar el
// saldo exige `?force=true` + permiso `payments:void` y deja traza de auditoría.
tables.post(
  "/:id/free",
  requirePermission("tables:update"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;
    const force = c.req.query("force") === "true";

    const [table] = await db
      .select({ id: schema.tables.id, number: schema.tables.number })
      .from(schema.tables)
      .where(
        and(
          eq(schema.tables.id, id),
          eq(schema.tables.branch_id, tenant.branchId),
          eq(schema.tables.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!table) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Mesa no encontrada" } },
        404,
      );
    }

    // Perdonar deuda es, en la práctica, anular un cobro: se pide el mismo permiso.
    if (force && !callerHasPermission(c, "payments:void")) {
      return c.json(
        {
          success: false,
          error: {
            code: "FORBIDDEN",
            message: "Necesitas permiso para liberar una mesa con saldo pendiente",
          },
        },
        403,
      );
    }

    let result;
    try {
      result = await sessionService.freeTable({
        tableId: id,
        branchId: tenant.branchId,
        organizationId: tenant.organizationId,
        force,
      });
    } catch (e: any) {
      if (e instanceof sessionService.TableHasBalanceError) {
        return c.json(
          {
            success: false,
            error: {
              code: "TABLE_HAS_BALANCE",
              message: `La mesa ${table.number} tiene un saldo pendiente de S/ ${(e.pendingAmount / 100).toFixed(2)}`,
              // En céntimos, como todo el dinero de la API.
              pendingAmount: e.pendingAmount,
            },
          },
          409,
        );
      }
      if (e?.message === "TABLE_NOT_FOUND") {
        return c.json(
          { success: false, error: { code: "NOT_FOUND", message: "Mesa no encontrada" } },
          404,
        );
      }
      throw e;
    }

    const { completedOrders } = result;

    if (force) {
      await auditFromContext(c, {
        action: "table.free",
        entityType: "table",
        entityId: id,
        summary:
          result.pendingAmount > 0
            ? `Mesa ${table.number} liberada perdonando ${auditMoney(result.pendingAmount)} sin cobrar`
            : `Mesa ${table.number} liberada de forma forzada (no quedaba nada por cobrar)`,
        after: {
          forgiven_amount: result.pendingAmount,
          billed: result.billed,
          paid: result.paid,
          completed_orders: completedOrders.length,
        },
      });
    }

    // Run completion side effects (loyalty + inventory) outside the tx. Each is
    // idempotent and best-effort, so this never blocks freeing the table.
    for (const order of completedOrders) {
      await handleOrderCompletion({
        orderId: order.id,
        orderNumber: order.order_number,
        orderSubtotal: order.subtotal,
        orderDiscount: order.discount,
        customerId: order.customer_id,
        organizationId: tenant.organizationId,
        branchId: tenant.branchId,
      });
    }

    await realtime.publish(`branch:${tenant.branchId}`, {
      type: "table:status",
      payload: { tableId: id, number: table.number, status: "available" },
      timestamp: Date.now(),
    });
    await realtime.publish(`branch:${tenant.branchId}`, {
      type: "session:ended",
      payload: { tableId: id, tableNumber: table.number },
      timestamp: Date.now(),
    });
    // Cada comensal que siguiera conectado a una de las sesiones cerradas tiene
    // que enterarse: si no, su teléfono se queda mostrando una cuenta viva que
    // ya no existe y su siguiente pedido muere con SESSION_ENDED sin explicación.
    for (const sessionId of result.closedSessionIds) {
      await realtime.publish(`session:${sessionId}`, {
        type: "session:ended",
        payload: { sessionId, tableId: id, tableNumber: table.number },
        timestamp: Date.now(),
      });
    }

    return c.json({
      success: true,
      data: {
        tableId: id,
        completedOrders: completedOrders.length,
        forgivenAmount: result.pendingAmount,
      },
    });
  },
);

// POST /:id/session/move - Mueve la cuenta abierta a otra mesa libre.
// "Los de la 5 se pasan a la 8": el servicio continúa con la misma sesión, el
// mismo token de comensal y los mismos importes, solo cambia dónde están
// sentados. Sin esto, la única salida era cerrar y volver a levantar la cuenta.
tables.post(
  "/:id/session/move",
  requirePermission("tables:update"),
  zValidator("param", idParamSchema),
  zValidator("json", moveSessionSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const { targetTableId } = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    let result;
    try {
      result = await sessionService.moveSession({
        tableId: id,
        targetTableId,
        branchId: tenant.branchId,
        organizationId: tenant.organizationId,
      });
    } catch (e: any) {
      if (e instanceof sessionService.SessionTransferError) {
        return c.json(
          { success: false, error: { code: e.code, message: e.message } },
          TRANSFER_ERROR_STATUS[e.code],
        );
      }
      throw e;
    }

    await auditFromContext(c, {
      action: "table.move",
      entityType: "table_session",
      entityId: result.sessionId,
      summary: `Cuenta movida de la mesa ${result.source.number} a la mesa ${result.target.number} (${result.movedOrders} pedidos)`,
      before: { tableId: result.source.id, tableNumber: result.source.number },
      after: {
        tableId: result.target.id,
        tableNumber: result.target.number,
        orders: result.movedOrders,
      },
    });

    const payload = {
      sessionId: result.sessionId,
      fromTableId: result.source.id,
      fromTableNumber: result.source.number,
      toTableId: result.target.id,
      toTableNumber: result.target.number,
      movedOrders: result.movedOrders,
    };

    // OJO: `payload` NO lleva el token renovado. Al canal de la sede lo escucha
    // todo el staff; el token de comensal solo viaja por el canal privado de la
    // propia sesión, al que únicamente entra el dispositivo de ese comensal.
    await realtime.publish(`branch:${tenant.branchId}`, {
      type: "session:moved",
      payload,
      timestamp: Date.now(),
    });
    // La mesa origen queda libre y la destino ocupada: el plano tiene que
    // reflejarlo sin esperar a un refresco manual.
    await realtime.publish(`branch:${tenant.branchId}`, {
      type: "table:status",
      payload: { tableId: result.source.id, number: result.source.number, status: "available" },
      timestamp: Date.now(),
    });
    await realtime.publish(`branch:${tenant.branchId}`, {
      type: "table:status",
      payload: { tableId: result.target.id, number: result.target.number, status: "occupied" },
      timestamp: Date.now(),
    });
    // El dispositivo del comensal sigue conectado a su sesión: se le avisa del
    // cambio de mesa para que su pantalla no siga diciendo "Mesa 5" y, sobre
    // todo, para entregarle el token renovado. El JWT anterior iba atado a la
    // mesa vieja y deja de validar en el instante del movimiento.
    await realtime.publish(`session:${result.sessionId}`, {
      type: "session:moved",
      payload: { ...payload, token: result.token },
      timestamp: Date.now(),
    });

    return c.json({
      success: true,
      data: {
        session: result.session,
        sessionId: result.sessionId,
        // El mozo puede regenerar el enlace del comensal con este token si su
        // teléfono no estaba conectado por realtime cuando se movió la cuenta.
        token: result.token,
        movedOrders: result.movedOrders,
        source: result.source,
        target: result.target,
      },
    });
  },
);

// POST /:id/session/merge - Junta las cuentas de varias mesas en esta.
// El grupo que llegó en tres mesas separadas pide "una sola cuenta": se
// reasignan los pedidos a la sesión de esta mesa, se cierran las sesiones
// origen y esas mesas quedan libres. Ningún importe se recalcula.
tables.post(
  "/:id/session/merge",
  requirePermission("tables:update"),
  zValidator("param", idParamSchema),
  zValidator("json", mergeSessionsSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const { sourceTableIds } = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    let result;
    try {
      result = await sessionService.mergeSessions({
        tableId: id,
        sourceTableIds,
        branchId: tenant.branchId,
        organizationId: tenant.organizationId,
      });
    } catch (e: any) {
      if (e instanceof sessionService.SessionTransferError) {
        return c.json(
          { success: false, error: { code: e.code, message: e.message } },
          TRANSFER_ERROR_STATUS[e.code],
        );
      }
      throw e;
    }

    const mergedNumbers = result.merged.map((m) => m.tableNumber).join(", ");

    await auditFromContext(c, {
      action: "table.merge",
      entityType: "table_session",
      entityId: result.targetSessionId,
      summary: `Cuentas de las mesas ${mergedNumbers} juntadas en la mesa ${result.target.number}`,
      before: { sources: result.merged },
      after: {
        tableId: result.target.id,
        tableNumber: result.target.number,
        sessionId: result.targetSessionId,
        totalOrders: result.totalOrders,
      },
    });

    const payload = {
      targetSessionId: result.targetSessionId,
      targetTableId: result.target.id,
      targetTableNumber: result.target.number,
      merged: result.merged,
      totalOrders: result.totalOrders,
    };

    await realtime.publish(`branch:${tenant.branchId}`, {
      type: "session:merged",
      payload,
      timestamp: Date.now(),
    });
    for (const source of result.merged) {
      await realtime.publish(`branch:${tenant.branchId}`, {
        type: "table:status",
        payload: { tableId: source.tableId, number: source.tableNumber, status: "available" },
        timestamp: Date.now(),
      });
      // Las sesiones origen quedan cerradas: sus comensales deben saber que su
      // cuenta ya no vive en su mesa.
      await realtime.publish(`session:${source.sessionId}`, {
        type: "session:merged",
        payload,
        timestamp: Date.now(),
      });
    }
    await realtime.publish(`branch:${tenant.branchId}`, {
      type: "table:status",
      payload: { tableId: result.target.id, number: result.target.number, status: "occupied" },
      timestamp: Date.now(),
    });

    return c.json({ success: true, data: result });
  },
);

// GET /my-assignments - List tables assigned to the current user
tables.get("/my-assignments", requirePermission("tables:read"), async (c) => {
  const tenant = c.get("tenant") as any;
  const user = c.get("user") as any;

  const assignments = await db
    .select({
      table_id: schema.tableAssignments.table_id,
      table_number: schema.tables.number,
    })
    .from(schema.tableAssignments)
    .innerJoin(schema.tables, eq(schema.tableAssignments.table_id, schema.tables.id))
    .where(
      and(
        eq(schema.tableAssignments.user_id, user.sub),
        eq(schema.tableAssignments.branch_id, tenant.branchId),
        eq(schema.tableAssignments.organization_id, tenant.organizationId),
      ),
    );

  return c.json({ success: true, data: assignments });
});

// GET /:id/assignments - List assigned waiters for a table
tables.get(
  "/:id/assignments",
  requirePermission("tables:read"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    const assignments = await db
      .select({
        id: schema.tableAssignments.id,
        table_id: schema.tableAssignments.table_id,
        user_id: schema.tableAssignments.user_id,
        created_at: schema.tableAssignments.created_at,
        user_name: schema.users.name,
        user_role: schema.users.role,
      })
      .from(schema.tableAssignments)
      .innerJoin(schema.users, eq(schema.tableAssignments.user_id, schema.users.id))
      .where(
        and(
          eq(schema.tableAssignments.table_id, id),
          eq(schema.tableAssignments.branch_id, tenant.branchId),
          eq(schema.tableAssignments.organization_id, tenant.organizationId),
        ),
      );

    return c.json({ success: true, data: assignments });
  },
);

// POST /:id/assignments - Assign waiter to table
tables.post(
  "/:id/assignments",
  requirePermission("tables:update"),
  zValidator("param", idParamSchema),
  zValidator("json", z.object({ userId: z.string().uuid() })),
  async (c) => {
    const { id } = c.req.valid("param");
    const { userId } = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    // Check table exists
    const [table] = await db
      .select()
      .from(schema.tables)
      .where(
        and(
          eq(schema.tables.id, id),
          eq(schema.tables.branch_id, tenant.branchId),
          eq(schema.tables.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!table) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Mesa no encontrada" } },
        404,
      );
    }

    const [targetUser] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .innerJoin(
        schema.userBranches,
        eq(schema.users.id, schema.userBranches.user_id),
      )
      .where(
        and(
          eq(schema.users.id, userId),
          eq(schema.users.organization_id, tenant.organizationId),
          eq(schema.userBranches.branch_id, tenant.branchId),
        ),
      )
      .limit(1);

    if (!targetUser) {
      return c.json(
        {
          success: false,
          error: { code: "BAD_REQUEST", message: "El usuario no pertenece a esta organización/sucursal" },
        },
        400,
      );
    }

    // Check if already assigned
    const [existing] = await db
      .select()
      .from(schema.tableAssignments)
      .where(
        and(
          eq(schema.tableAssignments.table_id, id),
          eq(schema.tableAssignments.user_id, userId),
          eq(schema.tableAssignments.branch_id, tenant.branchId),
          eq(schema.tableAssignments.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (existing) {
      return c.json(
        { success: false, error: { code: "CONFLICT", message: "El usuario ya esta asignado a esta mesa" } },
        409,
      );
    }

    const [assignment] = await db
      .insert(schema.tableAssignments)
      .values({
        table_id: id,
        user_id: userId,
        branch_id: tenant.branchId,
        organization_id: tenant.organizationId,
      })
      .returning();

    return c.json({ success: true, data: assignment }, 201);
  },
);

// DELETE /:id/assignments/:userId - Remove assignment
tables.delete(
  "/:id/assignments/:userId",
  requirePermission("tables:update"),
  async (c) => {
    const id = c.req.param("id");
    const userId = c.req.param("userId");
    const tenant = c.get("tenant") as any;

    const [deleted] = await db
      .delete(schema.tableAssignments)
      .where(
        and(
          eq(schema.tableAssignments.table_id, id),
          eq(schema.tableAssignments.user_id, userId),
          eq(schema.tableAssignments.branch_id, tenant.branchId),
          eq(schema.tableAssignments.organization_id, tenant.organizationId),
        ),
      )
      .returning();

    if (!deleted) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Asignacion no encontrada" } },
        404,
      );
    }

    return c.json({ success: true, data: deleted });
  },
);

// GET /:id - Detalle de una mesa (incluye `short_code` y el slug de la sede, que
// es lo que la UI necesita para imprimir el cartel: QR + código dictable).
//
// Se registra AL FINAL a propósito: Hono resuelve por orden de registro y este
// patrón comodín taparía a `/sessions`, `/sessions/pending` y `/my-assignments`
// si estuviera antes.
tables.get(
  "/:id",
  requirePermission("tables:read"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    const [table] = await db
      .select({
        id: schema.tables.id,
        branch_id: schema.tables.branch_id,
        organization_id: schema.tables.organization_id,
        space_id: schema.tables.space_id,
        number: schema.tables.number,
        capacity: schema.tables.capacity,
        qr_code: schema.tables.qr_code,
        short_code: schema.tables.short_code,
        status: schema.tables.status,
        position_x: schema.tables.position_x,
        position_y: schema.tables.position_y,
        created_at: schema.tables.created_at,
      })
      .from(schema.tables)
      .where(
        and(
          eq(schema.tables.id, id),
          eq(schema.tables.branch_id, tenant.branchId),
          eq(schema.tables.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!table) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Mesa no encontrada" } },
        404,
      );
    }

    const [branch] = await db
      .select({ slug: schema.branches.slug })
      .from(schema.branches)
      .where(eq(schema.branches.id, tenant.branchId))
      .limit(1);

    return c.json({ success: true, data: { ...table, branch_slug: branch?.slug || "" } });
  },
);

export { tables };
