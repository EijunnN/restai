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
  // DEBUG temporal:
  checks._envProvider = process.env.REALTIME_PROVIDER ?? "unset";
  checks._ablyKey = process.env.ABLY_API_KEY ? "present" : "absent";
  const cEnv = (c as { env?: Record<string, unknown> }).env;
  checks._bindingHasAbly = cEnv?.ABLY_API_KEY ? "yes" : "no";
  checks._bindingHasDb = cEnv?.DATABASE_URL ? "yes" : "no";

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
