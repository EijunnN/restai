import type { ErrorHandler } from "hono";
import { ZodError } from "zod";

export const errorHandler: ErrorHandler = (err, c) => {
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

  console.error("Unhandled error:", err);

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
