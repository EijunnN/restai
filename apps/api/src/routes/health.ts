import { Hono } from "hono";
import { db } from "@restai/db";
import { sql } from "drizzle-orm";
import { getRealtimeProvider } from "../infrastructure/container.js";

const health = new Hono();

health.get("/", async (c) => {
  const checks: Record<string, string> = {};

  try {
    await db.execute(sql`SELECT 1`);
    checks.database = "ok";
  } catch {
    checks.database = "error";
  }

  // El realtime se reporta por proveedor (sin acoplar Redis/ioredis aquí, para
  // que health corra también en runtimes serverless/edge).
  checks.realtime = getRealtimeProvider().name;

  const allHealthy = checks.database === "ok";

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
