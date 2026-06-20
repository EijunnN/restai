import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { redis } from "../lib/redis.js";
import { logger } from "../lib/logger.js";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// In-memory fallback used only when Redis is unavailable.
const store = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key);
  }
}, 5 * 60 * 1000);

// X-Forwarded-For is client-controlled and trivially spoofable. Only honor it
// when we are explicitly told we sit behind a trusted reverse proxy
// (docker-compose runs behind Traefik). Otherwise we key on a non-spoofable
// value (the socket remote address) so an attacker can't forge a fresh bucket
// per request.
const TRUST_PROXY = process.env.TRUST_PROXY === "true";

// Bun's server is passed to Hono as the second `fetch` arg and surfaced on
// `c.env`. It exposes requestIP(req) -> { address } for the real socket peer.
type BunServerEnv = { requestIP?: (req: Request) => { address?: string } | null };

function clientKey(c: Context): string {
  if (TRUST_PROXY) {
    const xff = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (xff) return xff;
    const realIp = c.req.header("x-real-ip");
    if (realIp) return realIp;
  }

  // Non-spoofable fallback: the actual socket peer address from the Bun server.
  // (Behind an untrusted proxy this collapses everyone to the proxy IP, which is
  // the safe failure mode — we never trust attacker-supplied headers.)
  const server = c.env as BunServerEnv | undefined;
  const addr = server?.requestIP?.(c.req.raw)?.address;
  return addr || "unknown";
}

interface CounterResult {
  count: number;
  resetAt: number;
}

/**
 * Atomically increment the counter for `key` within a fixed window. Backed by
 * Redis (INCR + EXPIRE) so limits hold across instances; falls back to the
 * in-memory Map if Redis is unavailable.
 */
async function incrementCounter(key: string, windowMs: number): Promise<CounterResult> {
  const windowSec = Math.ceil(windowMs / 1000);
  try {
    // INCR returns the new count; on the first hit (count === 1) we set the TTL.
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, windowSec);
    }
    let ttl = await redis.pttl(key);
    // PTTL returns -1 (no expiry) or -2 (no key) in edge/race cases; reassert TTL.
    if (ttl < 0) {
      await redis.expire(key, windowSec);
      ttl = windowMs;
    }
    return { count, resetAt: Date.now() + ttl };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown Redis error";
    logger.warn("Rate limiter Redis unavailable, falling back to in-memory store", {
      error: message,
    });
    const now = Date.now();
    let entry = store.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }
    entry.count++;
    return { count: entry.count, resetAt: entry.resetAt };
  }
}

export function rateLimiter(maxRequests = 100, windowMs = 60_000, prefix = "global") {
  return createMiddleware(async (c, next) => {
    const id = clientKey(c);
    const key = `ratelimit:${prefix}:${id}`;

    const { count, resetAt } = await incrementCounter(key, windowMs);

    c.header("X-RateLimit-Limit", String(maxRequests));
    c.header("X-RateLimit-Remaining", String(Math.max(0, maxRequests - count)));
    c.header("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));

    if (count > maxRequests) {
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
