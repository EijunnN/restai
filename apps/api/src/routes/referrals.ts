import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { zValidator } from "@hono/zod-validator";
import { eq, desc, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema } from "@restai/db";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import { requirePermission } from "../middleware/rbac.js";
import { auditFromContext } from "../lib/audit.js";
import {
  getReferralConfig,
  updateReferralConfig,
  ReferralError,
} from "../services/referral.service.js";

const referrals = new Hono<AppEnv>();

referrals.use("*", authMiddleware);
referrals.use("*", tenantMiddleware);

// Tope de cordura para los puntos de referido: nadie regala 100 000 puntos por
// traer a un amigo, y un cero de más en el formulario vacía el programa.
const MAX_REFERRAL_POINTS = 100_000;

const referralConfigSchema = z.object({
  referrerPoints: z.number().int().min(0).max(MAX_REFERRAL_POINTS),
  refereePoints: z.number().int().min(0).max(MAX_REFERRAL_POINTS),
  // Omitido = no se toca. null = quitar el tope. Entero >= 1 = tope mensual de
  // referidos premiados por promotor.
  monthlyCapPerReferrer: z.number().int().min(1).max(10_000).nullable().optional(),
});

// GET / - List org referrals with referrer/referee names + summary stats
referrals.get("/", requirePermission("loyalty:read"), async (c) => {
  const tenant = c.get("tenant") as any;
  const organizationId = tenant.organizationId;

  // Self-join customers twice: once as the referrer, once as the referee, to
  // resolve display names for both parties.
  const referrer = alias(schema.customers, "referrer");
  const referee = alias(schema.customers, "referee");

  const rows = await db
    .select({
      id: schema.referrals.id,
      status: schema.referrals.status,
      code: schema.referrals.code,
      referrer_points: schema.referrals.referrer_points,
      referee_points: schema.referrals.referee_points,
      created_at: schema.referrals.created_at,
      completed_at: schema.referrals.completed_at,
      referrer_id: schema.referrals.referrer_customer_id,
      referrer_name: referrer.name,
      referee_id: schema.referrals.referee_customer_id,
      referee_name: referee.name,
    })
    .from(schema.referrals)
    .leftJoin(referrer, eq(schema.referrals.referrer_customer_id, referrer.id))
    .leftJoin(referee, eq(schema.referrals.referee_customer_id, referee.id))
    .where(eq(schema.referrals.organization_id, organizationId))
    .orderBy(desc(schema.referrals.created_at));

  // Summary stats: total, completed, pending, and total points awarded (only
  // counting completed referrals — pending ones have not paid out yet).
  const [stats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) FILTER (WHERE ${schema.referrals.status} = 'completed')::int`,
      pending: sql<number>`count(*) FILTER (WHERE ${schema.referrals.status} = 'pending')::int`,
      points_awarded: sql<number>`coalesce(sum(${schema.referrals.referrer_points} + ${schema.referrals.referee_points}) FILTER (WHERE ${schema.referrals.status} = 'completed'), 0)::int`,
    })
    .from(schema.referrals)
    .where(eq(schema.referrals.organization_id, organizationId));

  return c.json({
    success: true,
    data: {
      referrals: rows,
      stats: {
        total: stats?.total ?? 0,
        completed: stats?.completed ?? 0,
        pending: stats?.pending ?? 0,
        points_awarded: stats?.points_awarded ?? 0,
      },
    },
  });
});

// GET /config - Configuración del programa de referidos
//
// Devuelve lo que se paga por referir y lo que recibe el referido, además del
// tope mensual antifraude. Si la organización aún no tiene programa activo se
// responde 200 con data: null y un motivo, para que la pantalla pueda decir
// "crea primero un programa de fidelización" en vez de romperse con un 404.
referrals.get("/config", requirePermission("loyalty:read"), async (c) => {
  const tenant = c.get("tenant") as any;

  const config = await getReferralConfig({ organizationId: tenant.organizationId });

  return c.json({
    success: true,
    data: config,
    ...(config
      ? {}
      : { message: "No hay un programa de fidelización activo" }),
  });
});

// PUT /config - Fija los puntos de referido (y el tope mensual opcional)
//
// Este endpoint es el que faltaba: hasta ahora referral_referrer_points y
// referral_referee_points solo se leían, así que todo referido pagaba 0 y el
// módulo era decorativo.
referrals.put(
  "/config",
  requirePermission("loyalty:update"),
  zValidator("json", referralConfigSchema),
  async (c) => {
    const body = c.req.valid("json");
    const tenant = c.get("tenant") as any;

    try {
      const { before, after } = await updateReferralConfig({
        organizationId: tenant.organizationId,
        referrerPoints: body.referrerPoints,
        refereePoints: body.refereePoints,
        monthlyCapPerReferrer: body.monthlyCapPerReferrer,
      });

      // Cambiar lo que cuesta un referido es tocar dinero del programa: queda
      // en la traza con el antes y el después.
      await auditFromContext(c, {
        action: "settings.update",
        entityType: "referral_program",
        entityId: after.programId,
        summary: `Referidos: ${before.referrerPoints}→${after.referrerPoints} pts al promotor, ${before.refereePoints}→${after.refereePoints} pts al referido, tope mensual ${after.monthlyCapPerReferrer ?? "sin tope"}`,
        before,
        after,
      });

      return c.json({ success: true, data: after });
    } catch (err) {
      if (err instanceof ReferralError) {
        const status = err.code === "PROGRAM_NOT_FOUND" ? 404 : 400;
        return c.json(
          { success: false, error: { code: err.code, message: err.message } },
          status,
        );
      }
      throw err;
    }
  },
);

export { referrals };
