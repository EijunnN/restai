import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { zValidator } from "@hono/zod-validator";
import { eq, and, desc } from "drizzle-orm";
import { db, schema } from "@restai/db";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import { requirePermission } from "../middleware/rbac.js";
import { actorFromContext } from "../lib/audit.js";
import { logger } from "../lib/logger.js";
import {
  resolveSegment,
  sendCampaignAnnouncement,
  CampaignError,
  type SegmentFilter,
} from "../services/campaign.service.js";

const campaigns = new Hono<AppEnv>();

campaigns.use("*", authMiddleware);
campaigns.use("*", tenantMiddleware);

// "HH:MM" 24h Lima time-of-day, e.g. "09:00" or "23:59".
const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Formato de hora inválido (HH:MM)");

const idParam = z.object({ id: z.string().uuid() });

const createCampaignSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  status: z.enum(["draft", "active", "paused", "ended"]).default("draft"),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).default([]),
  startTime: hhmm.optional(),
  endTime: hhmm.optional(),
  multiplier: z.number().int().min(0).default(100),
  bonusPoints: z.number().int().min(0).default(0),
  tierId: z.string().uuid().optional(),
});

const updateCampaignSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
  status: z.enum(["draft", "active", "paused", "ended"]).optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  startTime: hhmm.nullable().optional(),
  endTime: hhmm.nullable().optional(),
  multiplier: z.number().int().min(0).optional(),
  bonusPoints: z.number().int().min(0).optional(),
  tierId: z.string().uuid().nullable().optional(),
});

// --------------------------------------------------------------------------
// Segmentación
// --------------------------------------------------------------------------

// Booleano que llega por query string ("true"/"false"). Ausente = sin filtro.
const boolQuery = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === "true"));

// Filtros de audiencia tal como llegan por query string (todo es texto).
const segmentQuerySchema = z.object({
  tierId: z.union([z.string().uuid(), z.literal("none")]).optional(),
  minPoints: z.coerce.number().int().min(0).optional(),
  maxPoints: z.coerce.number().int().min(0).optional(),
  lastVisitBeforeDays: z.coerce.number().int().min(1).max(3650).optional(),
  includeNeverVisited: boolQuery,
  birthdayMonth: z.coerce.number().int().min(1).max(12).optional(),
  marketingOptIn: boolQuery,
  requireEmail: boolQuery,
  // Cuántos clientes de muestra devolver junto al conteo.
  sample: z.coerce.number().int().min(0).max(200).optional(),
});

// Los mismos filtros, pero en JSON (cuerpo del envío): aquí sí hay tipos.
const segmentBodySchema = z.object({
  tierId: z.union([z.string().uuid(), z.literal("none")]).optional(),
  minPoints: z.number().int().min(0).optional(),
  maxPoints: z.number().int().min(0).optional(),
  lastVisitBeforeDays: z.number().int().min(1).max(3650).optional(),
  includeNeverVisited: z.boolean().optional(),
  birthdayMonth: z.number().int().min(1).max(12).optional(),
});

const sendCampaignSchema = z.object({
  subject: z.string().min(1).max(180).optional(),
  title: z.string().min(1).max(180).optional(),
  message: z.string().min(1).max(4000).optional(),
  couponId: z.string().uuid().nullable().optional(),
  segment: segmentBodySchema.optional(),
  // Techo de destinatarios de este envío (protege el límite del proveedor).
  maxRecipients: z.number().int().min(1).max(5000).optional(),
});

/** Comprueba que la campaña existe y pertenece a la organización. */
async function findCampaign(organizationId: string, id: string) {
  const [campaign] = await db
    .select({
      id: schema.campaigns.id,
      name: schema.campaigns.name,
      status: schema.campaigns.status,
    })
    .from(schema.campaigns)
    .where(
      and(
        eq(schema.campaigns.id, id),
        eq(schema.campaigns.organization_id, organizationId),
      ),
    )
    .limit(1);
  return campaign ?? null;
}

// GET / - List campaigns for org
campaigns.get("/", requirePermission("loyalty:read"), async (c) => {
  const tenant = c.get("tenant") as any;

  const data = await db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.organization_id, tenant.organizationId))
    .orderBy(desc(schema.campaigns.created_at));

  return c.json({ success: true, data });
});

// POST / - Create campaign
campaigns.post(
  "/",
  requirePermission("loyalty:create"),
  zValidator("json", createCampaignSchema),
  async (c) => {
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const [campaign] = await db
      .insert(schema.campaigns)
      .values({
        organization_id: tenant.organizationId,
        name: body.name,
        description: body.description ?? null,
        status: body.status,
        starts_at: body.startsAt ? new Date(body.startsAt) : null,
        ends_at: body.endsAt ? new Date(body.endsAt) : null,
        days_of_week: body.daysOfWeek,
        start_time: body.startTime ?? null,
        end_time: body.endTime ?? null,
        multiplier: body.multiplier,
        bonus_points: body.bonusPoints,
        tier_id: body.tierId ?? null,
      })
      .returning();

    return c.json({ success: true, data: campaign }, 201);
  },
);

// PATCH /:id - Update campaign
campaigns.patch(
  "/:id",
  requirePermission("loyalty:update"),
  zValidator("param", idParam),
  zValidator("json", updateCampaignSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    const [existing] = await db
      .select({ id: schema.campaigns.id })
      .from(schema.campaigns)
      .where(
        and(
          eq(schema.campaigns.id, id),
          eq(schema.campaigns.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!existing) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Campaña no encontrada" } },
        404,
      );
    }

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.status !== undefined) updates.status = body.status;
    if (body.startsAt !== undefined)
      updates.starts_at = body.startsAt ? new Date(body.startsAt) : null;
    if (body.endsAt !== undefined)
      updates.ends_at = body.endsAt ? new Date(body.endsAt) : null;
    if (body.daysOfWeek !== undefined) updates.days_of_week = body.daysOfWeek;
    if (body.startTime !== undefined) updates.start_time = body.startTime;
    if (body.endTime !== undefined) updates.end_time = body.endTime;
    if (body.multiplier !== undefined) updates.multiplier = body.multiplier;
    if (body.bonusPoints !== undefined) updates.bonus_points = body.bonusPoints;
    if (body.tierId !== undefined) updates.tier_id = body.tierId;

    const [updated] = await db
      .update(schema.campaigns)
      .set(updates)
      .where(
        and(
          eq(schema.campaigns.id, id),
          eq(schema.campaigns.organization_id, tenant.organizationId),
        ),
      )
      .returning();

    return c.json({ success: true, data: updated });
  },
);

// DELETE /:id - Delete campaign
campaigns.delete(
  "/:id",
  requirePermission("loyalty:update"),
  zValidator("param", idParam),
  async (c) => {
    const { id } = c.req.valid("param");
    const tenant = c.get("tenant") as any;

    const [existing] = await db
      .select({ id: schema.campaigns.id })
      .from(schema.campaigns)
      .where(
        and(
          eq(schema.campaigns.id, id),
          eq(schema.campaigns.organization_id, tenant.organizationId),
        ),
      )
      .limit(1);

    if (!existing) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Campaña no encontrada" } },
        404,
      );
    }

    await db
      .delete(schema.campaigns)
      .where(
        and(
          eq(schema.campaigns.id, id),
          eq(schema.campaigns.organization_id, tenant.organizationId),
        ),
      );

    return c.json({ success: true, data: { deleted: true } });
  },
);

// GET /:id/audience - Previsualiza a cuántos clientes alcanzaría la campaña
//
// No envía nada. Devuelve dos números que son los que el dueño necesita antes
// de pulsar el botón:
//   - total:     clientes que cumplen el segmento.
//   - reachable: de esos, a cuántos podemos escribir de verdad (tienen correo y
//                aceptaron recibir promociones — Ley 29733).
// La diferencia entre ambos es, además, el argumento para pedir consentimiento
// en la próxima visita.
campaigns.get(
  "/:id/audience",
  requirePermission("loyalty:read"),
  // La muestra devuelve nombre y CORREO de clientes reales: eso es el padrón de
  // clientes, no una estadística de fidelización. Se exige además el mismo verbo
  // que protege GET /loyalty/customers, para que ningún rol futuro que reciba
  // "loyalty:read" se lleve de regalo la lista de correos.
  requirePermission("customers:read"),
  zValidator("param", idParam),
  zValidator("query", segmentQuerySchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const query = c.req.valid("query");
    const tenant = c.get("tenant") as any;

    const campaign = await findCampaign(tenant.organizationId, id);
    if (!campaign) {
      return c.json(
        { success: false, error: { code: "NOT_FOUND", message: "Campaña no encontrada" } },
        404,
      );
    }

    const { sample, ...rest } = query;
    const filter: SegmentFilter = rest;
    const sampleSize = sample ?? 25;

    // Conteo del segmento tal cual lo pidió el usuario (sin muestra).
    const { total } = await resolveSegment({
      organizationId: tenant.organizationId,
      filter,
      limit: 0,
    });

    // Alcance real: mismo segmento + correo + consentimiento de marketing.
    const reach = await resolveSegment({
      organizationId: tenant.organizationId,
      filter: { ...filter, marketingOptIn: true, requireEmail: true },
      limit: sampleSize,
    });

    return c.json({
      success: true,
      data: {
        campaign: { id: campaign.id, name: campaign.name, status: campaign.status },
        filter,
        total,
        reachable: reach.total,
        unreachable: Math.max(total - reach.total, 0),
        sample: reach.recipients,
      },
    });
  },
);

// POST /:id/send - Anuncia la campaña por correo al segmento indicado
//
// Encola el envío en lotes (nunca todo de golpe) y deja cada intento en
// notification_log. El consentimiento se fuerza en el servicio: aunque el
// segmento pida lo contrario, solo se escribe a quien lo aceptó.
campaigns.post(
  "/:id/send",
  requirePermission("loyalty:create"),
  zValidator("param", idParam),
  zValidator("json", sendCampaignSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;
    const user = c.get("user") as any;

    try {
      const result = await sendCampaignAnnouncement({
        organizationId: tenant.organizationId,
        campaignId: id,
        subject: body.subject ?? null,
        title: body.title ?? null,
        message: body.message ?? null,
        couponId: body.couponId ?? null,
        segment: body.segment,
        maxRecipients: body.maxRecipients,
        // Quién dispara el anuncio: queda en audit_logs y es lo que impide el
        // segundo envío accidental dentro de la ventana de enfriamiento.
        actor: actorFromContext(c),
      });

      logger.info("Envío de campaña solicitado", {
        campaignId: id,
        organizationId: tenant.organizationId,
        userId: user?.sub ?? null,
        audience: result.audience,
        queued: result.queued,
      });

      return c.json({
        success: true,
        data: {
          ...result,
          message:
            result.queued > 0
              ? `Anuncio encolado para ${result.queued} cliente(s)`
              : "Ningún cliente del segmento tiene correo y consentimiento de marketing",
        },
      });
    } catch (err) {
      if (err instanceof CampaignError) {
        // 404 = no existe; 409 = existe pero su estado impide el envío
        // (terminada, cupón no disponible, o anunciada hace un momento).
        const status =
          err.code === "NOT_FOUND" || err.code === "COUPON_NOT_FOUND" ? 404 : 409;
        return c.json(
          { success: false, error: { code: err.code, message: err.message } },
          status,
        );
      }
      throw err;
    }
  },
);

export { campaigns };
