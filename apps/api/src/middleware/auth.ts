import { createMiddleware } from "hono/factory";
import { verifyAccessToken } from "../lib/jwt.js";
import type { AppEnv } from "../types.js";

export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return c.json(
      {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Token no proporcionado" },
      },
      401,
    );
  }

  const token = header.slice(7);
  try {
    const payload = await verifyAccessToken(token);
    c.set("user", payload as any);
    return next();
  } catch {
    return c.json(
      {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Token inválido o expirado" },
      },
      401,
    );
  }
});
