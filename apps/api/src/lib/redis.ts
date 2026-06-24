import Redis from "ioredis";
import { logger } from "./logger.js";

// Mismo patrón de detección de Workers que en packages/db/src/index.ts.
const isWorkers =
  typeof (globalThis as { WebSocketPair?: unknown }).WebSocketPair !== "undefined" ||
  (typeof navigator !== "undefined" &&
    (navigator as { userAgent?: string }).userAgent === "Cloudflare-Workers");

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const retryStrategy = (times: number) => {
  if (times > 20) {
    logger.error("Redis max retry attempts reached");
    return null;
  }
  return Math.min(times * 200, 5000);
};

// Cloudflare Workers no soporta conexiones TCP: ioredis colgaría el request y
// contaminaría I/O pendiente en el scope del módulo (shared entre requests),
// lo que hace que workerd cancele los requests siguientes con el error
// "Worker hung and would never generate a response" (aparece como 1101).
// El noop rechaza inmediatamente → el fallback in-memory del rate limiter entra
// sin ningún delay, y el Worker nunca intenta TCP.
let _redis: Redis;

if (isWorkers) {
  const unavailable = () =>
    Promise.reject(new Error("Redis unavailable in Cloudflare Workers"));
  _redis = {
    incr: unavailable,
    expire: unavailable,
    pttl: unavailable,
    ping: unavailable,
    get: unavailable,
    set: unavailable,
    del: unavailable,
    quit: () => Promise.resolve("OK" as "OK"),
    status: "end" as Redis["status"],
    on: (_event: string, _handler: unknown) => _redis,
    off: (_event: string, _handler: unknown) => _redis,
    disconnect: () => {},
  } as unknown as Redis;
} else {
  _redis = new Redis(REDIS_URL, {
    retryStrategy,
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });
  _redis.on("error", (err) => {
    logger.error("Redis connection error", { error: err.message });
  });
  _redis.on("connect", () => {
    logger.info("Redis connected");
  });
}

export const redis = _redis;

export const createSubscriber = (): Redis => {
  if (isWorkers) {
    throw new Error("Redis pub/sub not available in Cloudflare Workers");
  }
  const sub = new Redis(REDIS_URL, {
    retryStrategy,
    maxRetriesPerRequest: null,
  });
  sub.on("error", (err) => {
    logger.error("Redis subscriber error", { error: err.message });
  });
  return sub;
};

export async function getRedisStatus(): Promise<"ok" | "error"> {
  if (isWorkers) return "error";
  try {
    const pong = await _redis.ping();
    return pong === "PONG" ? "ok" : "error";
  } catch {
    return "error";
  }
}
