import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { eq, and, desc, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema } from "@restai/db";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import { requirePermission } from "../middleware/rbac.js";

const referrals = new Hono<AppEnv>();

referrals.use("*", authMiddleware);
referrals.use("*", tenantMiddleware);

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
        pointsAwarded: stats?.points_awarded ?? 0,
      },
    },
  });
});

export { referrals };
