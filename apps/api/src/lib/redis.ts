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

const redis = new Redis(REDIS_URL, {
  retryStrategy,
  maxRetriesPerRequest: 3,
  lazyConnect: false,
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
