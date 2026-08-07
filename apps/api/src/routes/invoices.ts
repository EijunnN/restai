import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, desc, gte, inArray, lt, ne, sql, sum, count, isNull } from "drizzle-orm";
import { db, schema } from "@restai/db";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware, requireBranch } from "../middleware/tenant.js";
import { requirePermission } from "../middleware/rbac.js";
import { auditFromContext } from "../lib/audit.js";
import { peruCivilDayEnd, peruCivilDayStart } from "../lib/timezone.js";
import {
  anularComprobante,
  comunicarBaja,
  consultarEstado,
  declararComprobante,
  emitirNotaCredito,
  loadSeries,
  reenviarComprobante,
} from "../services/sunat.service.js";
import { handleSunatError } from "./sunat.js";

const invoices = new Hono<AppEnv>();

invoices.use("*", authMiddleware);
invoices.use("*", tenantMiddleware);
invoices.use("*", requireBranch);

// ───────────────────────────────────────────────────────────────────────────
// Esquemas (inline)
// ───────────────────────────────────────────────────────────────────────────

const idParam = z.object({ id: z.string().uuid() });

const crearSchema = z.object({
  orderId: z.string().uuid(),
  type: z.enum(["boleta", "factura"]),
  customerName: z.string().trim().min(1).max(255),
  customerDocType: z.enum(["dni", "ruc", "ce"]),
  customerDocNumber: z.string().trim().min(8).max(20),
});

const listadoSchema = z.object({
  type: z.enum(["boleta", "factura", "nota_credito", "nota_debito"]).optional(),
  sunatStatus: z
    .enum(["pending", "sent", "accepted", "observed", "rejected", "voided", "error"])
    .optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const notaCreditoSchema = z.object({
  // Catálogo 09 de SUNAT.
  motivoCodigo: z
    .enum(["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "13"])
    .default("01"),
  motivoDescripcion: z.string().trim().min(3).max(250),
});

const bajaSchema = z.object({
  motivo: z.string().trim().min(3).max(250),
  correlativo: z.number().int().min(1).max(99999).optional(),
});

const anulacionSchema = z.object({
  motivo: z.string().trim().min(3).max(250),
  /** Fuerza la vía; por defecto el servicio elige la que corresponde. */
  via: z.enum(["baja", "nota_credito"]).optional(),
  correlativo: z.number().int().min(1).max(99999).optional(),
});

// ───────────────────────────────────────────────────────────────────────────
// Utilidades
// ───────────────────────────────────────────────────────────────────────────

/** Carga un comprobante validando que pertenezca a la organización y la sede. */
async function getInvoiceForTenant(id: string, tenant: any) {
  const [invoice] = await db
    .select()
    .from(schema.invoices)
    .where(
      and(
        eq(schema.invoices.id, id),
        eq(schema.invoices.organization_id, tenant.organizationId),
        eq(schema.invoices.branch_id, tenant.branchId),
      ),
    )
    .limit(1);
  return invoice ?? null;
}

/**
 * Traduce una respuesta FALLIDA de SUNAT a un error accionable.
 *
 * El cliente de @restai/sunat no lanza cuando SUNAT rechaza: devuelve un
 * `SunatResult` con `exito: false`. Ese es el camino de fallo MÁS habitual, así
 * que la respuesta tiene que llevar el bloque `error` del contrato; sin él, el
 * cliente HTTP del frontend (que lanza con `error.message`) muestra
 * "Error desconocido" en lugar del motivo real del rechazo.
 */
function errorDeSunat(
  result: { codigo?: string; descripcion?: string } | null | undefined,
  porDefecto: string,
) {
  return {
    code: result?.codigo ? `SUNAT_${result.codigo}` : "SUNAT_REJECTED",
    message: result?.descripcion?.trim() || porDefecto,
  };
}

/** Etiquetas legibles del estado ante SUNAT (lo que la UI pinta tal cual). */
const ETIQUETA_SUNAT: Record<string, string> = {
  pending: "Pendiente de envío",
  sent: "Enviado, esperando respuesta",
  accepted: "Aceptado por SUNAT",
  observed: "Aceptado con observaciones",
  rejected: "Rechazado por SUNAT",
  voided: "Anulado",
  error: "Error de envío",
};

/**
 * Proyección pública de un comprobante: todo lo que la UI necesita para decir
 * "Aceptado por SUNAT" o "Rechazado: motivo", sin arrastrar los XML (que pesan
 * decenas de KB y se descargan aparte).
 */
function vistaComprobante(row: typeof schema.invoices.$inferSelect) {
  const { xml_signed, cdr_xml, sunat_response, ...resto } = row;
  return {
    ...resto,
    numero_completo: `${row.series}-${String(row.number).padStart(8, "0")}`,
    sunat_status_label: ETIQUETA_SUNAT[row.sunat_status] ?? row.sunat_status,
    has_cdr: !!cdr_xml,
    has_xml: !!xml_signed,
    /** true cuando el documento está definitivamente resuelto ante SUNAT. */
    sunat_final:
      row.sunat_status === "accepted" ||
      row.sunat_status === "observed" ||
      row.sunat_status === "voided",
    /** true cuando conviene ofrecer el botón "Reenviar". */
    puede_reenviar:
      row.sunat_status === "pending" ||
      row.sunat_status === "error" ||
      row.sunat_status === "rejected" ||
      row.sunat_status === "sent",
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Emisión
// ───────────────────────────────────────────────────────────────────────────

/** POST / — Emite un comprobante para una orden ya pagada. */
invoices.post(
  "/",
  requirePermission("invoices:create"),
  zValidator("json", crearSchema),
  async (c) => {
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const docNumber = body.customerDocNumber;
    const docType = body.customerDocType;

    if (docType === "dni" && !/^\d{8}$/.test(docNumber)) {
      return c.json(
        { success: false, error: { code: "BAD_REQUEST", message: "El DNI son 8 dígitos" } },
        400,
      );
    }
    if (docType === "ruc") {
      if (!/^\d{11}$/.test(docNumber)) {
        return c.json(
          { success: false, error: { code: "BAD_REQUEST", message: "El RUC son 11 dígitos" } },
          400,
        );
      }
      if (!docNumber.startsWith("10") && !docNumber.startsWith("20")) {
        return c.json(
          { success: false, error: { code: "BAD_REQUEST", message: "El RUC debe empezar con 10 o 20" } },
          400,
        );
      }
    }
    if (docType === "ce" && (docNumber.length < 9 || docNumber.length > 12)) {
      return c.json(
        { success: false, error: { code: "BAD_REQUEST", message: "El carné de extranjería tiene entre 9 y 12 caracteres" } },
        400,
      );
    }
    if (body.type === "factura" && docType !== "ruc") {
      return c.json(
        { success: false, error: { code: "BAD_REQUEST", message: "La factura exige RUC" } },
        400,
      );
    }

    // Orden acotada al tenant (organización + sede).
    const [order] = await db
      .select()
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.id, body.orderId),
          eq(schema.orders.organization_id, tenant.organizationId),
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

    // No se emite un comprobante de algo que aún no está cobrado.
    const [pagado] = await db
      .select({ total_paid: sum(schema.payments.amount) })
      .from(schema.payments)
      .where(
        and(
          eq(schema.payments.order_id, body.orderId),
          eq(schema.payments.status, "completed"),
          // Predicado canónico de "cobro real": un cobro anulado no paga nada.
          // Sin esto se podía emitir un comprobante de una venta cuyo único
          // cobro se había anulado, es decir, facturar dinero que no entró.
          isNull(schema.payments.voided_at),
        ),
      );

    const totalPagado = Number(pagado?.total_paid || 0);
    if (totalPagado < order.total) {
      return c.json(
        {
          success: false,
          error: {
            code: "ORDER_NOT_PAID",
            message: "La orden debe estar totalmente pagada antes de emitir el comprobante",
          },
        },
        409,
      );
    }

    const series = await loadSeries(tenant.branchId);
    const prefix = body.type === "boleta" ? series.boleta : series.factura;

    // ── Importes fiscales ───────────────────────────────────────────────
    // La orden guarda el delivery FUERA de la base imponible (total =
    // (subtotal - descuento) + IGV + delivery). Declarar solo base + IGV
    // sub-declara el importe cobrado y descuadra el comprobante con lo que pagó
    // el cliente, así que el reparto del delivery se hace aquí: es un servicio
    // gravado cuyo precio ya incluye IGV, se le extrae la base y el tributo.
    const [branch] = await db
      .select({ tax_rate: schema.branches.tax_rate })
      .from(schema.branches)
      .where(eq(schema.branches.id, tenant.branchId))
      .limit(1);

    const taxRate = branch?.tax_rate ?? 1800; // puntos básicos (1800 = 18,00 %)
    const deliveryFee = order.delivery_fee ?? 0;
    const deliveryBase = Math.round((deliveryFee * 10000) / (10000 + taxRate));
    const deliveryIgv = deliveryFee - deliveryBase;

    const subtotal = order.subtotal - order.discount + deliveryBase;
    const igv = order.tax + deliveryIgv;
    const total = order.total;

    // Un comprobante con base o importe negativo (posible si los descuentos
    // acumulados superan el consumo) no se puede declarar: SUNAT lo rechaza y
    // deja la venta en un limbo. Se corta aquí, antes de reservar correlativo.
    if (subtotal < 0 || igv < 0 || total <= 0) {
      return c.json(
        {
          success: false,
          error: {
            code: "INVOICE_TOTALS_MISMATCH",
            message:
              "Los importes de la orden no permiten emitir un comprobante válido (base o total no positivos). Revisa los descuentos aplicados.",
          },
        },
        422,
      );
    }

    // Dos inserciones simultáneas no se serializan con SELECT max ... FOR UPDATE
    // (la primera fila no tiene nada que bloquear), así que se reintenta ante la
    // violación de uq_invoices_branch_series_number recalculando el correlativo.
    const MAX_INTENTOS = 5;
    let invoice: typeof schema.invoices.$inferSelect | undefined;
    let yaExiste = false;

    for (let intento = 0; intento < MAX_INTENTOS; intento++) {
      try {
        invoice = await db.transaction(async (tx) => {
          // "Un comprobante por orden" solo se sostiene si la comprobación y la
          // inserción son atómicas: la tabla no tiene índice único sobre
          // order_id, así que dos pulsaciones de "Emitir" simultáneas emitían
          // DOS comprobantes fiscales de la misma venta. Se bloquea la orden
          // (que sí es única) para serializar a los competidores.
          await tx
            .select({ id: schema.orders.id })
            .from(schema.orders)
            .where(eq(schema.orders.id, body.orderId))
            .limit(1)
            .for("update");

          // Se ignoran los comprobantes ANULADOS y las notas de crédito (que
          // comparten el order_id del documento que corrigen). Si no, tras
          // anular una boleta con el DNI mal escrito la orden se quedaba sin
          // poder volver a facturarse nunca: el caso más común de anulación.
          const [existente] = await tx
            .select({ id: schema.invoices.id })
            .from(schema.invoices)
            .where(
              and(
                eq(schema.invoices.order_id, body.orderId),
                inArray(schema.invoices.type, ["boleta", "factura"]),
                ne(schema.invoices.sunat_status, "voided"),
              ),
            )
            .limit(1);

          if (existente) {
            yaExiste = true;
            return undefined;
          }

          const ultimo = await tx
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

          const [created] = await tx
            .insert(schema.invoices)
            .values({
              order_id: body.orderId,
              organization_id: tenant.organizationId,
              branch_id: tenant.branchId,
              type: body.type,
              series: prefix,
              number: (ultimo[0]?.number || 0) + 1,
              customer_name: body.customerName,
              customer_doc_type: body.customerDocType,
              customer_doc_number: body.customerDocNumber,
              subtotal,
              igv,
              total,
              sunat_status: "pending",
            })
            .returning();

          return created;
        });
        break;
      } catch (err: any) {
        // 23505 = unique_violation sobre (sede, serie, número).
        const code = err?.code ?? err?.cause?.code;
        if (code === "23505" && intento < MAX_INTENTOS - 1) continue;
        throw err;
      }
    }

    if (yaExiste) {
      return c.json(
        {
          success: false,
          error: { code: "INVOICE_EXISTS", message: "La orden ya tiene un comprobante emitido" },
        },
        409,
      );
    }

    if (!invoice) {
      return c.json(
        {
          success: false,
          error: {
            code: "CONFLICT",
            message: "No se pudo generar el número de comprobante, inténtalo de nuevo",
          },
        },
        409,
      );
    }

    await auditFromContext(c, {
      action: "invoice.emit",
      entityType: "invoice",
      entityId: invoice.id,
      summary: `${body.type === "factura" ? "Factura" : "Boleta"} ${invoice.series}-${invoice.number} por S/ ${(total / 100).toFixed(2)} a ${body.customerName}`,
      after: {
        order_id: invoice.order_id,
        type: invoice.type,
        series: invoice.series,
        number: invoice.number,
        subtotal,
        igv,
        total,
        delivery_incluido: deliveryFee,
      },
    });

    return c.json({ success: true, data: vistaComprobante(invoice) }, 201);
  },
);

// ───────────────────────────────────────────────────────────────────────────
// Consulta
// ───────────────────────────────────────────────────────────────────────────

/**
 * GET / — Listado con el ESTADO REAL ante SUNAT.
 *
 * Devuelve sunat_status, su etiqueta legible, el código y la descripción que
 * mandó SUNAT y si hay CDR guardado, para que la UI pueda mostrar
 * "Aceptado por SUNAT" o "Rechazado: <motivo>" sin una consulta extra.
 */
invoices.get(
  "/",
  requirePermission("invoices:read"),
  zValidator("query", listadoSchema),
  async (c) => {
    const tenant = c.get("tenant") as any;
    const q = c.req.valid("query");

    const condiciones: any[] = [
      eq(schema.invoices.organization_id, tenant.organizationId),
      eq(schema.invoices.branch_id, tenant.branchId),
    ];

    if (q.type) condiciones.push(eq(schema.invoices.type, q.type));
    if (q.sunatStatus) condiciones.push(eq(schema.invoices.sunat_status, q.sunatStatus));
    // Rangos con el calendario peruano: "07/08" es el día 7 en Lima, no la
    // ventana que salga de interpretar la cadena como UTC.
    if (q.startDate) {
      condiciones.push(gte(schema.invoices.created_at, peruCivilDayStart(q.startDate)));
    }
    if (q.endDate) {
      condiciones.push(lt(schema.invoices.created_at, peruCivilDayEnd(q.endDate)));
    }

    const filtro = and(...condiciones);

    const [filas, [totales]] = await Promise.all([
      db
        .select({
          id: schema.invoices.id,
          order_id: schema.invoices.order_id,
          type: schema.invoices.type,
          series: schema.invoices.series,
          number: schema.invoices.number,
          customer_name: schema.invoices.customer_name,
          customer_doc_type: schema.invoices.customer_doc_type,
          customer_doc_number: schema.invoices.customer_doc_number,
          subtotal: schema.invoices.subtotal,
          igv: schema.invoices.igv,
          total: schema.invoices.total,
          sunat_status: schema.invoices.sunat_status,
          sunat_code: schema.invoices.sunat_code,
          sunat_description: schema.invoices.sunat_description,
          sunat_ticket: schema.invoices.sunat_ticket,
          sunat_hash: schema.invoices.sunat_hash,
          sent_at: schema.invoices.sent_at,
          reference_invoice_id: schema.invoices.reference_invoice_id,
          note_motive_code: schema.invoices.note_motive_code,
          note_motive_description: schema.invoices.note_motive_description,
          created_at: schema.invoices.created_at,
          has_cdr: sql<boolean>`(${schema.invoices.cdr_xml} is not null)`,
          has_xml: sql<boolean>`(${schema.invoices.xml_signed} is not null)`,
        })
        .from(schema.invoices)
        .where(filtro)
        .orderBy(desc(schema.invoices.created_at))
        .limit(q.limit)
        .offset((q.page - 1) * q.limit),
      db.select({ n: count() }).from(schema.invoices).where(filtro),
    ]);

    const data = filas.map((f) => ({
      ...f,
      numero_completo: `${f.series}-${String(f.number).padStart(8, "0")}`,
      sunat_status_label: ETIQUETA_SUNAT[f.sunat_status] ?? f.sunat_status,
      sunat_final:
        f.sunat_status === "accepted" ||
        f.sunat_status === "observed" ||
        f.sunat_status === "voided",
      puede_reenviar:
        f.sunat_status === "pending" ||
        f.sunat_status === "error" ||
        f.sunat_status === "rejected" ||
        f.sunat_status === "sent",
    }));

    const total = Number(totales?.n ?? 0);
    return c.json({
      success: true,
      data,
      pagination: {
        page: q.page,
        limit: q.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / q.limit)),
      },
    });
  },
);

/** GET /pendientes-sunat — Cuántos comprobantes están sin resolver ante SUNAT. */
invoices.get("/pendientes-sunat", requirePermission("invoices:read"), async (c) => {
  const tenant = c.get("tenant") as any;

  const filas = await db
    .select({ estado: schema.invoices.sunat_status, n: count() })
    .from(schema.invoices)
    .where(
      and(
        eq(schema.invoices.organization_id, tenant.organizationId),
        eq(schema.invoices.branch_id, tenant.branchId),
      ),
    )
    .groupBy(schema.invoices.sunat_status);

  const porEstado: Record<string, number> = {};
  for (const f of filas) porEstado[f.estado] = Number(f.n);

  const sinResolver =
    (porEstado.pending ?? 0) + (porEstado.error ?? 0) + (porEstado.rejected ?? 0);

  return c.json({
    success: true,
    data: {
      por_estado: porEstado,
      sin_resolver: sinResolver,
      etiquetas: ETIQUETA_SUNAT,
    },
  });
});

/** GET /:id — Detalle del comprobante (sin los XML: se descargan aparte). */
invoices.get(
  "/:id",
  requirePermission("invoices:read"),
  zValidator("param", idParam),
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

    return c.json({ success: true, data: vistaComprobante(invoice) });
  },
);

/** GET /:id/xml — Descarga el XML firmado (UBL). El emisor debe conservarlo. */
invoices.get(
  "/:id/xml",
  requirePermission("invoices:read"),
  zValidator("param", idParam),
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
    if (!invoice.xml_signed) {
      return c.json(
        {
          success: false,
          error: {
            code: "XML_NOT_AVAILABLE",
            message: "El comprobante todavía no se ha firmado ni enviado a SUNAT",
          },
        },
        404,
      );
    }

    c.header("Content-Type", "application/xml; charset=utf-8");
    c.header(
      "Content-Disposition",
      `attachment; filename="${invoice.series}-${invoice.number}.xml"`,
    );
    return c.body(invoice.xml_signed);
  },
);

/** GET /:id/cdr — Descarga la Constancia de Recepción devuelta por SUNAT. */
invoices.get(
  "/:id/cdr",
  requirePermission("invoices:read"),
  zValidator("param", idParam),
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
    if (!invoice.cdr_xml) {
      return c.json(
        {
          success: false,
          error: {
            code: "CDR_NOT_AVAILABLE",
            message: "SUNAT aún no ha devuelto la constancia de recepción de este comprobante",
          },
        },
        404,
      );
    }

    c.header("Content-Type", "application/xml; charset=utf-8");
    c.header(
      "Content-Disposition",
      `attachment; filename="R-${invoice.series}-${invoice.number}.xml"`,
    );
    return c.body(invoice.cdr_xml);
  },
);

// ───────────────────────────────────────────────────────────────────────────
// Declaración ante SUNAT
// ───────────────────────────────────────────────────────────────────────────

/** POST /:id/declarar — Envía el comprobante a SUNAT por primera vez. */
invoices.post(
  "/:id/declarar",
  requirePermission("invoices:create"),
  zValidator("param", idParam),
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
        {
          success: false,
          error: { code: "INVOICE_ALREADY_ACCEPTED", message: "El comprobante ya fue aceptado por SUNAT" },
        },
        409,
      );
    }
    if (invoice.sunat_status === "voided") {
      return c.json(
        {
          success: false,
          error: { code: "INVOICE_ALREADY_VOIDED", message: "El comprobante está anulado" },
        },
        409,
      );
    }
    if (invoice.sunat_status === "sent") {
      // Ya está en SUNAT con un ticket abierto: volver a enviarlo lo duplicaría.
      return c.json(
        {
          success: false,
          error: {
            code: "INVOICE_PENDING_TICKET",
            message:
              "El comprobante ya se envió y SUNAT lo está procesando. Consulta su estado con GET /invoices/:id/estado.",
          },
        },
        409,
      );
    }

    try {
      const result = await declararComprobante(invoice, tenant.organizationId);
      const actualizado = await getInvoiceForTenant(id, tenant);
      const payload = {
        result,
        invoice: actualizado ? vistaComprobante(actualizado) : null,
      };

      if (!result.exito) {
        return c.json(
          {
            success: false,
            error: errorDeSunat(result, "SUNAT no aceptó el comprobante"),
            data: payload,
          },
          422,
        );
      }

      return c.json({ success: true, data: payload });
    } catch (err) {
      return handleSunatError(c, err);
    }
  },
);

/**
 * POST /:id/resend — Reintenta lo que quedó a medias.
 *
 * Si el comprobante tiene un ticket pendiente consulta su estado (no hay nada
 * que reenviar: SUNAT lo está procesando). Si no, lo vuelve a declarar. Es el
 * botón que rescata los comprobantes en 'error', 'pending' o 'rejected' después
 * de arreglar la configuración.
 */
invoices.post(
  "/:id/resend",
  requirePermission("invoices:create"),
  zValidator("param", idParam),
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
      const { accion, result } = await reenviarComprobante(invoice, tenant.organizationId);
      const actualizado = await getInvoiceForTenant(id, tenant);

      await auditFromContext(c, {
        action: "invoice.emit",
        entityType: "invoice",
        entityId: invoice.id,
        summary: `Reenvío a SUNAT de ${invoice.series}-${invoice.number}: ${
          result.exito ? "aceptado" : result.descripcion ?? "sin respuesta"
        }`,
        before: { sunat_status: invoice.sunat_status, sunat_code: invoice.sunat_code },
        after: {
          accion,
          sunat_status: actualizado?.sunat_status,
          sunat_code: result.codigo ?? null,
          sunat_description: result.descripcion ?? null,
        },
      });

      const payload = {
        accion,
        result,
        invoice: actualizado ? vistaComprobante(actualizado) : null,
      };

      if (!result.exito) {
        return c.json(
          {
            success: false,
            error: errorDeSunat(
              result,
              accion === "consulta_ticket"
                ? "SUNAT todavía no ha resuelto el ticket de este comprobante"
                : "SUNAT no aceptó el reenvío del comprobante",
            ),
            data: payload,
          },
          422,
        );
      }

      return c.json({ success: true, data: payload });
    } catch (err) {
      return handleSunatError(c, err);
    }
  },
);

/** GET /:id/estado — Consulta el estado del comprobante en SUNAT (ticket). */
invoices.get(
  "/:id/estado",
  requirePermission("invoices:read"),
  zValidator("param", idParam),
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
      const actualizado = await getInvoiceForTenant(id, tenant);
      return c.json({
        success: true,
        data: { result, invoice: actualizado ? vistaComprobante(actualizado) : null },
      });
    } catch (err) {
      return handleSunatError(c, err);
    }
  },
);

// ───────────────────────────────────────────────────────────────────────────
// Anulación
// ───────────────────────────────────────────────────────────────────────────

/**
 * POST /:id/void — Anula el comprobante por la vía que corresponda.
 *
 * - Factura aceptada dentro de los 7 días → comunicación de baja (RA).
 * - Boleta aceptada, o factura fuera de plazo → nota de crédito (motivo 01).
 * - Comprobante que nunca llegó a SUNAT → anulación local.
 */
invoices.post(
  "/:id/void",
  requirePermission("invoices:void"),
  zValidator("param", idParam),
  zValidator("json", anulacionSchema),
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

    try {
      const anulacion = await anularComprobante(invoice, {
        organizationId: tenant.organizationId,
        branchId: tenant.branchId,
        motivo: body.motivo,
        via: body.via,
        correlativo: body.correlativo,
      });

      const exito = anulacion.via === "local" || !!anulacion.result?.exito;

      await auditFromContext(c, {
        action: "invoice.void",
        entityType: "invoice",
        entityId: invoice.id,
        summary: `Anulación de ${invoice.series}-${invoice.number} por ${anulacion.via}: ${body.motivo}`,
        before: {
          sunat_status: invoice.sunat_status,
          total: invoice.total,
          customer_name: invoice.customer_name,
        },
        after: {
          via: anulacion.via,
          motivo_via: anulacion.motivo_via,
          sunat_status: anulacion.invoice.sunat_status,
          nota_credito: anulacion.nota
            ? `${anulacion.nota.series}-${anulacion.nota.number}`
            : null,
          exito,
        },
      });

      const payload = {
        via: anulacion.via,
        motivo_via: anulacion.motivo_via,
        result: anulacion.result ?? null,
        nota: anulacion.nota ? vistaComprobante(anulacion.nota) : null,
        invoice: vistaComprobante(anulacion.invoice),
      };

      if (!exito) {
        return c.json(
          {
            success: false,
            error: errorDeSunat(
              anulacion.result,
              "SUNAT no aceptó la anulación del comprobante",
            ),
            data: payload,
          },
          422,
        );
      }

      return c.json({ success: true, data: payload });
    } catch (err) {
      return handleSunatError(c, err);
    }
  },
);

/** POST /:id/nota-credito — Emite una nota de crédito con un motivo concreto. */
invoices.post(
  "/:id/nota-credito",
  requirePermission("invoices:void"),
  zValidator("param", idParam),
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
        {
          success: false,
          error: {
            code: "BAD_REQUEST",
            message: "Solo se emiten notas sobre boletas o facturas",
          },
        },
        400,
      );
    }
    if (invoice.sunat_status === "voided") {
      return c.json(
        {
          success: false,
          error: {
            code: "INVOICE_ALREADY_VOIDED",
            message: "El comprobante ya está anulado: no admite más notas de crédito",
          },
        },
        409,
      );
    }
    if (invoice.sunat_status !== "accepted" && invoice.sunat_status !== "observed") {
      // Una nota de crédito referencia un documento que SUNAT debe conocer. Si
      // el original nunca se aceptó, la nota se rechaza y además consume un
      // correlativo: se anula el original directamente con POST /:id/void.
      return c.json(
        {
          success: false,
          error: {
            code: "INVOICE_NOT_DECLARED",
            message:
              "SUNAT no ha aceptado el comprobante afectado, así que no admite nota de crédito. Anúlalo con POST /invoices/:id/void.",
          },
        },
        409,
      );
    }

    try {
      const { result, nota } = await emitirNotaCredito(invoice, {
        organizationId: tenant.organizationId,
        branchId: tenant.branchId,
        motivoCodigo: body.motivoCodigo,
        motivoDescripcion: body.motivoDescripcion,
      });

      await auditFromContext(c, {
        action: "invoice.void",
        entityType: "invoice",
        entityId: invoice.id,
        summary: `Nota de crédito ${nota.series}-${nota.number} sobre ${invoice.series}-${invoice.number} (motivo ${body.motivoCodigo})`,
        after: {
          nota_id: nota.id,
          motivo_codigo: body.motivoCodigo,
          motivo: body.motivoDescripcion,
          sunat_status: nota.sunat_status,
          exito: result.exito,
        },
      });

      const payload = { nota: vistaComprobante(nota), result };

      if (!result.exito) {
        // La nota SÍ quedó creada en el sistema (con su correlativo reservado);
        // lo que falló es la declaración. Se devuelve para que la UI pueda
        // ofrecer "Reenviar" sobre ella en vez de dejarla huérfana.
        return c.json(
          {
            success: false,
            error: errorDeSunat(result, "SUNAT no aceptó la nota de crédito"),
            data: payload,
          },
          422,
        );
      }

      return c.json({ success: true, data: payload }, 201);
    } catch (err) {
      return handleSunatError(c, err);
    }
  },
);

/**
 * POST /:id/anular — Comunicación de baja explícita (solo facturas).
 *
 * Vía de bajo nivel para quien sabe lo que hace y quiere fijar el correlativo
 * del RA. Para el caso normal usa POST /:id/void, que elige el mecanismo solo.
 */
invoices.post(
  "/:id/anular",
  requirePermission("invoices:void"),
  zValidator("param", idParam),
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
    if (invoice.type !== "factura") {
      return c.json(
        {
          success: false,
          error: {
            code: "BAD_REQUEST",
            message:
              "La comunicación de baja es solo para facturas. Las boletas se anulan con una nota de crédito: usa POST /invoices/:id/void",
          },
        },
        400,
      );
    }
    if (invoice.sunat_status !== "accepted" && invoice.sunat_status !== "observed") {
      return c.json(
        {
          success: false,
          error: {
            code: "INVOICE_NOT_DECLARED",
            message:
              "Solo se comunica la baja de un comprobante ya aceptado por SUNAT. Usa POST /invoices/:id/void.",
          },
        },
        409,
      );
    }

    try {
      const result = await comunicarBaja(invoice, {
        organizationId: tenant.organizationId,
        motivo: body.motivo,
        correlativo: body.correlativo,
      });
      const actualizado = await getInvoiceForTenant(id, tenant);

      await auditFromContext(c, {
        action: "invoice.void",
        entityType: "invoice",
        entityId: invoice.id,
        summary: `Comunicación de baja de ${invoice.series}-${invoice.number}: ${body.motivo}`,
        before: { sunat_status: invoice.sunat_status },
        after: {
          sunat_status: actualizado?.sunat_status,
          ticket: result.ticket ?? null,
          exito: result.exito,
        },
      });

      const payload = {
        result,
        invoice: actualizado ? vistaComprobante(actualizado) : null,
      };

      if (!result.exito) {
        return c.json(
          {
            success: false,
            error: errorDeSunat(
              result,
              "SUNAT no aceptó la comunicación de baja",
            ),
            data: payload,
          },
          422,
        );
      }

      return c.json({ success: true, data: payload });
    } catch (err) {
      return handleSunatError(c, err);
    }
  },
);

export { invoices };
