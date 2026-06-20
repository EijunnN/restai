import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { zValidator } from "@hono/zod-validator";
import { eq, and, desc, gte, lte } from "drizzle-orm";
import { db, schema } from "@restai/db";
import {
  createInvoiceSchema,
  idParamSchema,
  notaCreditoSchema,
  bajaSchema,
} from "@restai/validators";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware, requireBranch } from "../middleware/tenant.js";
import { requirePermission } from "../middleware/rbac.js";
import {
  comunicarBaja,
  consultarEstado,
  declararComprobante,
  emitirNotaCredito,
} from "../services/sunat.service.js";
import { handleSunatError } from "./sunat.js";

/** Carga un comprobante validando que pertenezca al branch del tenant. */
async function getInvoiceForTenant(id: string, tenant: any) {
  const [invoice] = await db
    .select()
    .from(schema.invoices)
    .where(
      and(
        eq(schema.invoices.id, id),
        eq(schema.invoices.branch_id, tenant.branchId),
      ),
    )
    .limit(1);
  return invoice ?? null;
}

const invoices = new Hono<AppEnv>();

invoices.use("*", authMiddleware);
invoices.use("*", tenantMiddleware);
invoices.use("*", requireBranch);

// POST / - Create invoice
invoices.post(
  "/",
  requirePermission("invoices:create"),
  zValidator("json", createInvoiceSchema),
  async (c) => {
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    // Validate document number based on type
    const docNumber = body.customerDocNumber;
    const docType = body.customerDocType;

    if (docType === "dni" && (docNumber.length !== 8 || !/^\d{8}$/.test(docNumber))) {
      return c.json(
        { success: false, error: { code: "BAD_REQUEST", message: "DNI debe ser 8 digitos" } },
        400,
      );
    }
    if (docType === "ruc") {
      if (docNumber.length !== 11 || !/^\d{11}$/.test(docNumber)) {
        return c.json(
          { success: false, error: { code: "BAD_REQUEST", message: "RUC debe ser 11 digitos" } },
          400,
        );
      }
      if (!docNumber.startsWith("10") && !docNumber.startsWith("20")) {
        return c.json(
          { success: false, error: { code: "BAD_REQUEST", message: "RUC debe empezar con 10 o 20" } },
          400,
        );
      }
    }
    if (docType === "ce" && (docNumber.length < 9 || docNumber.length > 12)) {
      return c.json(
        { success: false, error: { code: "BAD_REQUEST", message: "CE debe tener entre 9 y 12 caracteres" } },
        400,
      );
    }

    // Factura requires RUC
    if (body.type === "factura" && docType !== "ruc") {
      return c.json(
        { success: false, error: { code: "BAD_REQUEST", message: "Factura requiere RUC" } },
        400,
      );
    }

    // Get order
    const [order] = await db
      .select()
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.id, body.orderId),
          eq(schema.orders.branch_id, tenant.branchId),
        ),
      )
      .limit(1);

    if (!order) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Orden no encontrada" } },
        404,
      );
    }

    // Generate series/number + insert in a transaction with row locking
    const invoice = await db.transaction(async (tx) => {
      const prefix = body.type === "boleta" ? "B001" : "F001";

      const lastInvoice = await tx
        .select({ number: schema.invoices.number })
        .from(schema.invoices)
        .where(
          and(
            eq(schema.invoices.branch_id, tenant.branchId),
            eq(schema.invoices.series, prefix),
          ),
        )
        .orderBy(desc(schema.invoices.number))
        .limit(1)
        .for("update");

      const nextNumber = (lastInvoice[0]?.number || 0) + 1;

      const subtotal = Math.round(order.total / 1.18);
      const igv = order.total - subtotal;

      const [created] = await tx
        .insert(schema.invoices)
        .values({
          order_id: body.orderId,
          organization_id: tenant.organizationId,
          branch_id: tenant.branchId,
          type: body.type,
          series: prefix,
          number: nextNumber,
          customer_name: body.customerName,
          customer_doc_type: body.customerDocType,
          customer_doc_number: body.customerDocNumber,
          subtotal,
          igv,
          total: order.total,
          sunat_status: "pending",
        })
        .returning();

      return created;
    });

    return c.json({ success: true, data: invoice }, 201);
  },
);

// GET / - List invoices with optional filters
invoices.get("/", requirePermission("invoices:read"), async (c) => {
  const tenant = c.get("tenant") as any;
  const type = c.req.query("type");
  const startDate = c.req.query("startDate");
  const endDate = c.req.query("endDate");

  const conditions: any[] = [
    eq(schema.invoices.branch_id, tenant.branchId),
    eq(schema.invoices.organization_id, tenant.organizationId),
  ];

  if (type) {
    conditions.push(eq(schema.invoices.type, type as any));
  }
  if (startDate) {
    conditions.push(gte(schema.invoices.created_at, new Date(startDate)));
  }
  if (endDate) {
    conditions.push(lte(schema.invoices.created_at, new Date(endDate)));
  }

  const result = await db
    .select()
    .from(schema.invoices)
    .where(and(...conditions))
    .orderBy(desc(schema.invoices.created_at))
    .limit(100);

  return c.json({ success: true, data: result });
});

// GET /:id - Get invoice detail
invoices.get(
  "/:id",
  requirePermission("invoices:read"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    const [invoice] = await db
      .select()
      .from(schema.invoices)
      .where(
        and(
          eq(schema.invoices.id, id),
          eq(schema.invoices.branch_id, tenant.branchId),
        ),
      )
      .limit(1);

    if (!invoice) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Comprobante no encontrado" } },
        404,
      );
    }

    return c.json({ success: true, data: invoice });
  },
);

// POST /:id/declarar - Declara (envía) el comprobante a SUNAT
invoices.post(
  "/:id/declarar",
  requirePermission("invoices:create"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    const invoice = await getInvoiceForTenant(id, tenant);
    if (!invoice) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Comprobante no encontrado" } },
        404,
      );
    }
    if (invoice.sunat_status === "accepted" || invoice.sunat_status === "observed") {
      return c.json(
        { success: false, error: { code: "CONFLICT", message: "El comprobante ya fue aceptado por SUNAT" } },
        409,
      );
    }

    try {
      const result = await declararComprobante(invoice, tenant.organizationId);
      return c.json({ success: result.exito, data: result }, result.exito ? 200 : 422);
    } catch (err) {
      return handleSunatError(c, err);
    }
  },
);

// GET /:id/estado - Consulta el estado del comprobante en SUNAT
invoices.get(
  "/:id/estado",
  requirePermission("invoices:read"),
  zValidator("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    const invoice = await getInvoiceForTenant(id, tenant);
    if (!invoice) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Comprobante no encontrado" } },
        404,
      );
    }

    try {
      const result = await consultarEstado(invoice, tenant.organizationId);
      return c.json({ success: true, data: result });
    } catch (err) {
      return handleSunatError(c, err);
    }
  },
);

// POST /:id/nota-credito - Emite una nota de crédito sobre el comprobante
invoices.post(
  "/:id/nota-credito",
  requirePermission("invoices:create"),
  zValidator("param", idParamSchema),
  zValidator("json", notaCreditoSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const invoice = await getInvoiceForTenant(id, tenant);
    if (!invoice) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Comprobante no encontrado" } },
        404,
      );
    }
    if (invoice.type !== "boleta" && invoice.type !== "factura") {
      return c.json(
        { success: false, error: { code: "BAD_REQUEST", message: "Solo se pueden emitir notas sobre boletas o facturas" } },
        400,
      );
    }

    try {
      const { result, nota } = await emitirNotaCredito(invoice, {
        organizationId: tenant.organizationId,
        branchId: tenant.branchId,
        motivoCodigo: body.motivoCodigo,
        motivoDescripcion: body.motivoDescripcion,
      });
      return c.json({ success: result.exito, data: { nota, result } }, result.exito ? 201 : 422);
    } catch (err) {
      return handleSunatError(c, err);
    }
  },
);

// POST /:id/anular - Comunicación de baja del comprobante (facturas)
invoices.post(
  "/:id/anular",
  requirePermission("invoices:create"),
  zValidator("param", idParamSchema),
  zValidator("json", bajaSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const invoice = await getInvoiceForTenant(id, tenant);
    if (!invoice) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Comprobante no encontrado" } },
        404,
      );
    }
    if (invoice.type === "boleta") {
      return c.json(
        {
          success: false,
          error: {
            code: "BAD_REQUEST",
            message: "Las boletas se anulan vía resumen diario (estado 3), no por comunicación de baja",
          },
        },
        400,
      );
    }

    try {
      const result = await comunicarBaja(invoice, {
        organizationId: tenant.organizationId,
        motivo: body.motivo,
        correlativo: body.correlativo,
      });
      return c.json({ success: result.exito, data: result }, result.exito ? 200 : 422);
    } catch (err) {
      return handleSunatError(c, err);
    }
  },
);

export { invoices };
