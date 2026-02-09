import { Hono } from "hono";
import { db } from "@restai/db";
import { sql } from "drizzle-orm";
import { getRedisStatus } from "../lib/redis.js";

const health = new Hono();

health.get("/", async (c) => {
  const checks: Record<string, string> = {};

  try {
    await db.execute(sql`SELECT 1`);
    checks.database = "ok";
  } catch {
    checks.database = "error";
  }

  checks.redis = await getRedisStatus();

  const allHealthy = Object.values(checks).every((v) => v === "ok");

  return c.json(
    {
      status: allHealthy ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      checks,
    },
    allHealthy ? 200 : 503,
  );
});

export { health };
