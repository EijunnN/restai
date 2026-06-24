import type { ErrorHandler } from "hono";
import { ZodError } from "zod";
import { logger } from "../lib/logger.js";

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number = 400,
  ) {
    super(message);
    this.name = "AppError";
  }
}

// Known service error codes mapped to HTTP status
const KNOWN_ERROR_CODES: Record<string, number> = {
  REWARD_NOT_FOUND: 404,
  LOYALTY_NOT_FOUND: 404,
  INSUFFICIENT_POINTS: 400,
  PENDING_SESSION_NOT_FOUND: 404,
  ACTIVE_SESSION_NOT_FOUND: 404,
  SESSION_EXPIRED: 410,
  SESSION_HAS_OPEN_ORDERS: 409,
  TABLE_NOT_FOUND: 404,
};

export const errorHandler: ErrorHandler = (err, c) => {
  // Zod validation errors
  if (err instanceof ZodError) {
    const details: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const path = issue.path.join(".") || "_root";
      if (!details[path]) details[path] = [];
      details[path].push(issue.message);
    }
    return c.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Datos de entrada inválidos",
          details,
        },
      },
      400,
    );
  }

  // AppError (custom business errors)
  if (err instanceof AppError) {
    return c.json(
      {
        success: false,
        error: { code: err.code, message: err.message },
      },
      err.status as any,
    );
  }

  // Known service error codes (thrown as Error("CODE_STRING"))
  const knownStatus = KNOWN_ERROR_CODES[err.message];
  if (knownStatus) {
    return c.json(
      {
        success: false,
        error: { code: err.message, message: err.message },
      },
      knownStatus as any,
    );
  }

  // Check for errors with a name we recognize
  if (err.name === "OrderValidationError") {
    return c.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: err.message } },
      400,
    );
  }
  if (err.name === "InventoryItemNotFoundError") {
    return c.json(
      { success: false, error: { code: "NOT_FOUND", message: err.message } },
      404,
    );
  }
  if (err.name === "InsufficientStockError") {
    return c.json(
      { success: false, error: { code: "INSUFFICIENT_STOCK", message: err.message } },
      409,
    );
  }

  // Postgres unique-violation (SQLSTATE 23505) -> 409 Conflict.
  // postgres.js exposes the SQLSTATE on `.code`; drizzle may wrap it under `.cause`.
  const pgCode = (err as any).code ?? (err as any).cause?.code;
  if (pgCode === "23505") {
    return c.json(
      {
        success: false,
        error: { code: "CONFLICT", message: "El registro ya existe o entra en conflicto con uno existente" },
      },
      409,
    );
  }

  // Unhandled errors
  logger.error("Unhandled error", { error: err.message, stack: err.stack });

  const status = (err as any).status || 500;
  return c.json(
    {
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: status === 500 ? "Error interno del servidor" : err.message,
      },
    },
    status,
  );
};
