import Redis from "ioredis";
import { logger } from "./logger.js";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const retryStrategy = (times: number) => {
  if (times > 20) {
    logger.error("Redis max retry attempts reached");
    return null;
  }
  return Math.min(times * 200, 5000);
};

// lazyConnect: la conexión se abre en el primer comando. Así, en un despliegue
// de un solo proceso sin Redis (coordinador "local"), importar este módulo NO
// abre ningún socket ni genera reintentos contra localhost.
const redis = new Redis(REDIS_URL, {
  retryStrategy,
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

redis.on("error", (err) => {
  logger.error("Redis connection error", { error: err.message });
});

redis.on("connect", () => {
  logger.info("Redis connected");
});

export { redis };

export const createSubscriber = () => {
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
  try {
    const pong = await redis.ping();
    return pong === "PONG" ? "ok" : "error";
  } catch {
    return "error";
  }
}
