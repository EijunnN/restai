import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { zValidator } from "@hono/zod-validator";
import {
  eq,
  and,
  gte,
  lt,
  ne,
  sql,
  asc,
  desc,
  isNull,
  isNotNull,
  inArray,
  count,
  sum,
} from "drizzle-orm";
import { db, schema } from "@restai/db";
import { reportQuerySchema } from "@restai/validators";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware, requireBranch, getAccessibleBranchIds } from "../middleware/tenant.js";
import { requirePermission } from "../middleware/rbac.js";
import { peruStartOfDay, peruCivilDayStart, peruCivilDayEnd } from "../lib/timezone.js";

const reports = new Hono<AppEnv>();

reports.use("*", authMiddleware);
reports.use("*", tenantMiddleware);

// OJO: `requireBranch` ya NO se monta con `use("*")`. Los reportes de sede lo
// declaran uno a uno como middleware de ruta, porque el consolidado
// multi-sede (/org/*) se pide precisamente SIN elegir una sede: obligar a
// enviar x-branch-id ahí condenaba al dueño de la cadena a entrar cinco veces y
// sumar en Excel.

/** Rango de fechas civiles peruanas, validado. */
function resolveRange(startDate: string, endDate: string) {
  if (startDate > endDate) return null;
  return { start: peruCivilDayStart(startDate), end: peruCivilDayEnd(endDate) };
}

const invalidRange = {
  success: false as const,
  error: { code: "BAD_REQUEST", message: "Rango de fechas inválido" },
};

/** Ticket promedio en céntimos, redondeado. */
function averageTicket(revenue: number, orders: number): number {
  return orders > 0 ? Math.round(revenue / orders) : 0;
}

// GET /dashboard - Dashboard stats
reports.get("/dashboard", requireBranch, requirePermission("reports:read"), async (c) => {
  const tenant = c.get("tenant") as any;

  const today = peruStartOfDay();

  // Ingresos del día: SOLO órdenes completadas. Antes esta consulta no filtraba
  // por estado, así que las canceladas y las que aún estaban en cocina sumaban al
  // KPI y el panel nunca cuadraba con /reports (que sí exige 'completed').
  const [revenueStats] = await db
    .select({
      completedOrders: count(),
      totalRevenue: sum(schema.orders.total),
    })
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.branch_id, tenant.branchId),
        gte(schema.orders.created_at, today),
        eq(schema.orders.status, "completed"),
      ),
    );

  // Volumen del día: todo lo que entró salvo lo anulado (métrica de operación,
  // no de caja).
  const [orderStats] = await db
    .select({ totalOrders: count() })
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.branch_id, tenant.branchId),
        gte(schema.orders.created_at, today),
        ne(schema.orders.status, "cancelled"),
      ),
    );

  // Active orders
  const [activeStats] = await db
    .select({ count: count() })
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.branch_id, tenant.branchId),
        inArray(schema.orders.status, ["pending", "confirmed", "preparing", "ready"]),
      ),
    );

  // Table stats
  const allTables = await db
    .select({ status: schema.tables.status })
    .from(schema.tables)
    .where(eq(schema.tables.branch_id, tenant.branchId));

  const totalTables = allTables.length;
  const occupiedTables = allTables.filter((t) => t.status === "occupied").length;

  // El ticket promedio se calcula sobre lo efectivamente cobrado.
  const avgOrderValue = averageTicket(
    Number(revenueStats.totalRevenue || 0),
    revenueStats.completedOrders,
  );

  return c.json({
    success: true,
    data: {
      totalOrders: orderStats.totalOrders,
      completedOrders: revenueStats.completedOrders,
      totalRevenue: Number(revenueStats.totalRevenue || 0),
      averageOrderValue: avgOrderValue,
      activeOrders: activeStats.count,
      occupiedTables,
      totalTables,
    },
  });
});

// GET /sales - Sales summary with daily breakdown and payment methods
reports.get(
  "/sales",
  requireBranch,
  requirePermission("reports:read"),
  zValidator("query", reportQuerySchema),
  async (c) => {
    const { startDate, endDate } = c.req.valid("query");
    const tenant = c.get("tenant") as any;

    // Range bounds in Peru timezone (UTC-5). peruCivilDayEnd returns start of
    // next day, so use an exclusive upper bound (lt) to include the whole end day.
    const range = resolveRange(startDate, endDate);
    if (!range) return c.json(invalidRange, 400);
    const { start, end } = range;

    // Bucket key: calendar day in Peru local time
    const dayBucket = sql<string>`to_char(${schema.orders.created_at} AT TIME ZONE 'America/Lima', 'YYYY-MM-DD')`;

    const rangeFilter = and(
      eq(schema.orders.organization_id, tenant.organizationId),
      eq(schema.orders.branch_id, tenant.branchId),
      gte(schema.orders.created_at, start),
      lt(schema.orders.created_at, end),
      eq(schema.orders.status, "completed"),
    );

    // Totals for the range
    const [totals] = await db
      .select({
        totalOrders: count(),
        totalRevenue: sum(schema.orders.total),
        totalTax: sum(schema.orders.tax),
        totalDiscount: sum(schema.orders.discount),
      })
      .from(schema.orders)
      .where(rangeFilter);

    // Daily breakdown
    const dailyData = await db
      .select({
        date: dayBucket,
        orders: count(),
        revenue: sum(schema.orders.total),
      })
      .from(schema.orders)
      .where(rangeFilter)
      .groupBy(dayBucket)
      .orderBy(dayBucket);

    // Desglose por método de pago. Se cruza contra las órdenes del rango con un
    // JOIN (antes se traían todos los ids a memoria para un IN gigante) y se
    // excluyen los cobros anulados, que dejan fila con `voided_at`.
    const pmData = await db
      .select({
        method: schema.payments.method,
        total: sum(schema.payments.amount),
      })
      .from(schema.payments)
      .innerJoin(schema.orders, eq(schema.payments.order_id, schema.orders.id))
      .where(
        and(
          rangeFilter,
          eq(schema.payments.status, "completed"),
          isNull(schema.payments.voided_at),
        ),
      )
      .groupBy(schema.payments.method);

    const grandTotal = pmData.reduce((s, p) => s + Number(p.total || 0), 0);
    const paymentMethods = pmData.map((p) => ({
      name: p.method,
      amount: Number(p.total || 0),
      value: grandTotal > 0 ? Math.round((Number(p.total || 0) / grandTotal) * 100) : 0,
    }));

    return c.json({
      success: true,
      data: {
        totalOrders: totals.totalOrders,
        totalRevenue: Number(totals.totalRevenue || 0),
        totalTax: Number(totals.totalTax || 0),
        totalDiscount: Number(totals.totalDiscount || 0),
        days: dailyData.map((d) => ({
          date: d.date,
          orders: d.orders,
          revenue: Number(d.revenue || 0),
        })),
        paymentMethods,
      },
    });
  },
);

// GET /top-items - Top selling items
reports.get(
  "/top-items",
  requireBranch,
  requirePermission("reports:read"),
  zValidator("query", reportQuerySchema),
  async (c) => {
    const { startDate, endDate } = c.req.valid("query");
    const tenant = c.get("tenant") as any;

    const range = resolveRange(startDate, endDate);
    if (!range) return c.json(invalidRange, 400);
    const { start, end } = range;

    const limitParam = c.req.query("limit");
    const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 10, 50) : 10;

    // Se cruzan ítems y órdenes con un JOIN y se descartan las líneas anuladas
    // ("86" de cocina): un plato que nunca salió no es un plato vendido.
    const topItems = await db
      .select({
        name: schema.orderItems.name,
        totalQuantity: sum(schema.orderItems.quantity),
        totalRevenue: sum(schema.orderItems.total),
      })
      .from(schema.orderItems)
      .innerJoin(schema.orders, eq(schema.orderItems.order_id, schema.orders.id))
      .where(
        and(
          eq(schema.orders.organization_id, tenant.organizationId),
          eq(schema.orders.branch_id, tenant.branchId),
          gte(schema.orders.created_at, start),
          lt(schema.orders.created_at, end),
          eq(schema.orders.status, "completed"),
          ne(schema.orderItems.status, "cancelled"),
        ),
      )
      .groupBy(schema.orderItems.name)
      .orderBy(desc(sum(schema.orderItems.quantity)))
      .limit(limit);

    return c.json({
      success: true,
      data: topItems.map((item) => ({
        name: item.name,
        totalQuantity: Number(item.totalQuantity || 0),
        totalRevenue: Number(item.totalRevenue || 0),
      })),
    });
  },
);

// GET /staff-sales - Ventas por mozo y cobros por cajero (sede actual)
//
// Es la primera pregunta de cualquier dueño ("¿quién vende más?", "¿quién
// cobró el turno?") y hasta ahora era imposible de responder: nadie guardaba
// quién levantaba la comanda ni quién registraba el cobro. Con
// `orders.created_by` y `payments.user_id` (migración 0012) ya se puede.
reports.get(
  "/staff-sales",
  requireBranch,
  requirePermission("reports:read"),
  zValidator("query", reportQuerySchema),
  async (c) => {
    const { startDate, endDate } = c.req.valid("query");
    const tenant = c.get("tenant") as any;

    const range = resolveRange(startDate, endDate);
    if (!range) return c.json(invalidRange, 400);
    const { start, end } = range;

    // ── Ventas por quien tomó el pedido ──────────────────────────────────
    // created_by null = pedido levantado por el propio comensal desde el QR.
    // Se muestra como una fila más ("Autoservicio (QR)") porque el dueño quiere
    // saber cuánto vende la carta digital sin mozo de por medio.
    const waiterRows = await db
      .select({
        userId: schema.orders.created_by,
        name: schema.users.name,
        role: schema.users.role,
        totalOrders: count(schema.orders.id),
        totalRevenue: sum(schema.orders.total),
      })
      .from(schema.orders)
      .leftJoin(schema.users, eq(schema.orders.created_by, schema.users.id))
      .where(
        and(
          eq(schema.orders.organization_id, tenant.organizationId),
          eq(schema.orders.branch_id, tenant.branchId),
          gte(schema.orders.created_at, start),
          lt(schema.orders.created_at, end),
          eq(schema.orders.status, "completed"),
        ),
      )
      .groupBy(schema.orders.created_by, schema.users.name, schema.users.role)
      .orderBy(desc(sum(schema.orders.total)));

    const waiters = waiterRows.map((r) => {
      const revenue = Number(r.totalRevenue || 0);
      return {
        userId: r.userId,
        name: r.userId ? (r.name ?? "Usuario eliminado") : "Autoservicio (QR)",
        role: r.userId ? (r.role ?? null) : "customer",
        totalOrders: r.totalOrders,
        totalRevenue: revenue,
        averageOrderValue: averageTicket(revenue, r.totalOrders),
      };
    });

    // ── Cobros por cajero, desglosados por método ────────────────────────
    const paymentRows = await db
      .select({
        userId: schema.payments.user_id,
        name: schema.users.name,
        role: schema.users.role,
        method: schema.payments.method,
        payments: count(schema.payments.id),
        amount: sum(schema.payments.amount),
        tips: sum(schema.payments.tip),
      })
      .from(schema.payments)
      .leftJoin(schema.users, eq(schema.payments.user_id, schema.users.id))
      .where(
        and(
          eq(schema.payments.organization_id, tenant.organizationId),
          eq(schema.payments.branch_id, tenant.branchId),
          gte(schema.payments.created_at, start),
          lt(schema.payments.created_at, end),
          eq(schema.payments.status, "completed"),
          isNull(schema.payments.voided_at),
        ),
      )
      .groupBy(
        schema.payments.user_id,
        schema.users.name,
        schema.users.role,
        schema.payments.method,
      );

    interface CashierRow {
      userId: string | null;
      name: string;
      role: string | null;
      paymentsCount: number;
      totalCollected: number;
      totalTips: number;
      byMethod: { method: string; count: number; amount: number }[];
    }

    const cashierIndex = new Map<string, CashierRow>();
    for (const row of paymentRows) {
      const key = row.userId ?? "__sin_usuario__";
      let entry = cashierIndex.get(key);
      if (!entry) {
        entry = {
          userId: row.userId,
          name: row.userId ? (row.name ?? "Usuario eliminado") : "Sin registrar",
          role: row.userId ? (row.role ?? null) : null,
          paymentsCount: 0,
          totalCollected: 0,
          totalTips: 0,
          byMethod: [],
        };
        cashierIndex.set(key, entry);
      }
      const amount = Number(row.amount || 0);
      entry.paymentsCount += row.payments;
      entry.totalCollected += amount;
      entry.totalTips += Number(row.tips || 0);
      entry.byMethod.push({ method: row.method, count: row.payments, amount });
    }

    const cashiers = [...cashierIndex.values()].sort(
      (a, b) => b.totalCollected - a.totalCollected,
    );
    for (const cashier of cashiers) {
      cashier.byMethod.sort((a, b) => b.amount - a.amount);
    }

    // ── Anulaciones de cobro ─────────────────────────────────────────────
    // Un cajero que anula mucho es la señal de alarma clásica de sisa; el dato
    // no sirve de nada si hay que ir a buscarlo a mano.
    const voidRows = await db
      .select({
        userId: schema.payments.voided_by,
        name: schema.users.name,
        role: schema.users.role,
        count: count(schema.payments.id),
        amount: sum(schema.payments.amount),
      })
      .from(schema.payments)
      .leftJoin(schema.users, eq(schema.payments.voided_by, schema.users.id))
      .where(
        and(
          eq(schema.payments.organization_id, tenant.organizationId),
          eq(schema.payments.branch_id, tenant.branchId),
          isNotNull(schema.payments.voided_at),
          gte(schema.payments.voided_at, start),
          lt(schema.payments.voided_at, end),
        ),
      )
      .groupBy(schema.payments.voided_by, schema.users.name, schema.users.role)
      .orderBy(desc(sum(schema.payments.amount)));

    const voids = voidRows.map((r) => ({
      userId: r.userId,
      name: r.userId ? (r.name ?? "Usuario eliminado") : "Sin registrar",
      role: r.userId ? (r.role ?? null) : null,
      count: r.count,
      amount: Number(r.amount || 0),
    }));

    return c.json({
      success: true,
      data: {
        startDate,
        endDate,
        waiters,
        cashiers,
        voids,
        totals: {
          totalOrders: waiters.reduce((s, w) => s + w.totalOrders, 0),
          totalRevenue: waiters.reduce((s, w) => s + w.totalRevenue, 0),
          totalCollected: cashiers.reduce((s, c2) => s + c2.totalCollected, 0),
          totalTips: cashiers.reduce((s, c2) => s + c2.totalTips, 0),
          voidedAmount: voids.reduce((s, v) => s + v.amount, 0),
        },
      },
    });
  },
);

// GET /org/sales - Consolidado multi-sede
//
// Deliberadamente SIN requireBranch: la pregunta es "¿cómo va la cadena?", no
// "¿cómo va esta sede?". Cada sede accesible aparece con sus totales —incluidas
// las que vendieron cero, que si desaparecieran del listado el dueño pensaría
// que faltan datos— y se añade una fila consolidada.
reports.get(
  "/org/sales",
  requirePermission("reports:read"),
  zValidator("query", reportQuerySchema),
  async (c) => {
    const { startDate, endDate } = c.req.valid("query");
    const tenant = c.get("tenant") as any;

    const range = resolveRange(startDate, endDate);
    if (!range) return c.json(invalidRange, 400);
    const { start, end } = range;

    // La autorización sigue siendo por sede: un gerente ve el consolidado de
    // SUS sedes, no el de la cadena entera.
    const accessible = await getAccessibleBranchIds(c);
    const emptyResponse = {
      success: true,
      data: {
        startDate,
        endDate,
        branches: [] as unknown[],
        totals: {
          branches: 0,
          totalOrders: 0,
          totalRevenue: 0,
          totalTax: 0,
          totalDiscount: 0,
          averageOrderValue: 0,
        },
        paymentMethods: [] as unknown[],
      },
    };

    if (accessible !== null && accessible.length === 0) {
      return c.json(emptyResponse);
    }

    const branchScope = accessible === null ? [] : [inArray(schema.branches.id, accessible)];

    // Se parte de `branches` con LEFT JOIN a las órdenes del rango para que las
    // sedes sin ventas salgan en cero en lugar de desaparecer.
    const rows = await db
      .select({
        branchId: schema.branches.id,
        branchName: schema.branches.name,
        branchSlug: schema.branches.slug,
        isActive: schema.branches.is_active,
        totalOrders: count(schema.orders.id),
        totalRevenue: sum(schema.orders.total),
        totalTax: sum(schema.orders.tax),
        totalDiscount: sum(schema.orders.discount),
      })
      .from(schema.branches)
      .leftJoin(
        schema.orders,
        and(
          eq(schema.orders.branch_id, schema.branches.id),
          eq(schema.orders.status, "completed"),
          gte(schema.orders.created_at, start),
          lt(schema.orders.created_at, end),
        ),
      )
      .where(and(eq(schema.branches.organization_id, tenant.organizationId), ...branchScope))
      .groupBy(
        schema.branches.id,
        schema.branches.name,
        schema.branches.slug,
        schema.branches.is_active,
      )
      .orderBy(asc(schema.branches.name));

    const branchRows = rows.map((r) => {
      const revenue = Number(r.totalRevenue || 0);
      return {
        branchId: r.branchId,
        branchName: r.branchName,
        branchSlug: r.branchSlug,
        isActive: r.isActive,
        totalOrders: r.totalOrders,
        totalRevenue: revenue,
        totalTax: Number(r.totalTax || 0),
        totalDiscount: Number(r.totalDiscount || 0),
        averageOrderValue: averageTicket(revenue, r.totalOrders),
      };
    });

    const consolidatedOrders = branchRows.reduce((s, b) => s + b.totalOrders, 0);
    const consolidatedRevenue = branchRows.reduce((s, b) => s + b.totalRevenue, 0);

    // Métodos de pago consolidados de toda la cadena (mismo criterio que
    // /sales: cobros completados y no anulados de órdenes completadas).
    const orderScope =
      accessible === null ? [] : [inArray(schema.orders.branch_id, accessible)];

    const pmData = await db
      .select({
        method: schema.payments.method,
        total: sum(schema.payments.amount),
      })
      .from(schema.payments)
      .innerJoin(schema.orders, eq(schema.payments.order_id, schema.orders.id))
      .where(
        and(
          eq(schema.orders.organization_id, tenant.organizationId),
          eq(schema.orders.status, "completed"),
          gte(schema.orders.created_at, start),
          lt(schema.orders.created_at, end),
          eq(schema.payments.status, "completed"),
          isNull(schema.payments.voided_at),
          ...orderScope,
        ),
      )
      .groupBy(schema.payments.method);

    const pmTotal = pmData.reduce((s, p) => s + Number(p.total || 0), 0);
    const paymentMethods = pmData
      .map((p) => ({
        name: p.method,
        amount: Number(p.total || 0),
        value: pmTotal > 0 ? Math.round((Number(p.total || 0) / pmTotal) * 100) : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    return c.json({
      success: true,
      data: {
        startDate,
        endDate,
        branches: branchRows,
        totals: {
          branches: branchRows.length,
          totalOrders: consolidatedOrders,
          totalRevenue: consolidatedRevenue,
          totalTax: branchRows.reduce((s, b) => s + b.totalTax, 0),
          totalDiscount: branchRows.reduce((s, b) => s + b.totalDiscount, 0),
          averageOrderValue: averageTicket(consolidatedRevenue, consolidatedOrders),
        },
        paymentMethods,
      },
    });
  },
);

export { reports };
