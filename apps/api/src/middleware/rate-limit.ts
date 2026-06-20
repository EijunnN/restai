import { createMiddleware } from "hono/factory";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Poda oportunista (sin setInterval global, que no es válido en Cloudflare Workers).
// Se limpian las entradas vencidas como mucho una vez por minuto, en el flujo de un request.
let lastPrune = 0;
const PRUNE_INTERVAL_MS = 60_000;
function prune(now: number) {
  if (now - lastPrune < PRUNE_INTERVAL_MS) return;
  lastPrune = now;
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key);
  }
}

export function rateLimiter(maxRequests = 100, windowMs = 60_000, prefix = "global") {
  return createMiddleware(async (c, next) => {
    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
      c.req.header("x-real-ip") ||
      "unknown";

    const key = `${prefix}:${ip}`;
    const now = Date.now();
    prune(now);
    let entry = store.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count++;

    c.header("X-RateLimit-Limit", String(maxRequests));
    c.header("X-RateLimit-Remaining", String(Math.max(0, maxRequests - entry.count)));
    c.header("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > maxRequests) {
      return c.json(
        {
          success: false,
          error: { code: "RATE_LIMITED", message: "Demasiadas solicitudes, intenta más tarde" },
        },
        429,
      );
    }

    return next();
  });
}
