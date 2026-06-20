import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { db, schema } from "@restai/db";
import { resumenDiarioSchema, sunatConfigSchema } from "@restai/validators";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import { requirePermission } from "../middleware/rbac.js";
import { encryptSecret, isEncryptionAvailable } from "../lib/crypto.js";
import {
  enviarResumenDiario,
  SunatConfigError,
} from "../services/sunat.service.js";

const sunat = new Hono<AppEnv>();

sunat.use("*", authMiddleware);
sunat.use("*", tenantMiddleware);

/** Devuelve la configuración SUNAT sin exponer los secretos. */
sunat.get("/config", requirePermission("settings:read"), async (c) => {
  const tenant = c.get("tenant") as any;
  const [row] = await db
    .select()
    .from(schema.sunatConfig)
    .where(eq(schema.sunatConfig.organization_id, tenant.organizationId))
    .limit(1);

  if (!row) {
    return c.json({ success: true, data: null });
  }

  const { sol_user_enc, sol_pass_enc, cert_enc, cert_pass_enc, ...safe } = row;
  return c.json({
    success: true,
    data: {
      ...safe,
      hasSolCredentials: !!(sol_user_enc && sol_pass_enc),
      hasCertificate: !!cert_enc,
    },
  });
});

/** Crea o actualiza la configuración del emisor electrónico. */
sunat.put(
  "/config",
  requirePermission("settings:update"),
  zValidator("json", sunatConfigSchema),
  async (c) => {
    const tenant = c.get("tenant") as any;
    const body = c.req.valid("json");

    if (
      !isEncryptionAvailable() &&
      (body.solUser || body.solPass || body.certificate)
    ) {
      return c.json(
        {
          success: false,
          error: {
            code: "CONFIG_ERROR",
            message:
              "SUNAT_ENCRYPTION_KEY no está configurada en el servidor; no se pueden guardar secretos",
          },
        },
        400,
      );
    }

    const values: typeof schema.sunatConfig.$inferInsert = {
      organization_id: tenant.organizationId,
      ruc: body.ruc,
      razon_social: body.razonSocial,
      nombre_comercial: body.nombreComercial ?? null,
      ubigeo: body.ubigeo ?? null,
      departamento: body.departamento ?? null,
      provincia: body.provincia ?? null,
      distrito: body.distrito ?? null,
      direccion: body.direccion ?? null,
      ambiente: body.ambiente,
      endpoint_override: body.endpointOverride ?? null,
      cert_format: body.certificateFormat,
      enabled: body.enabled ?? false,
      updated_at: new Date(),
    };

    if (body.solUser) values.sol_user_enc = encryptSecret(body.solUser);
    if (body.solPass) values.sol_pass_enc = encryptSecret(body.solPass);
    if (body.certificate) values.cert_enc = encryptSecret(body.certificate);
    if (body.certificatePassword !== undefined) {
      values.cert_pass_enc = body.certificatePassword
        ? encryptSecret(body.certificatePassword)
        : null;
    }

    const [saved] = await db
      .insert(schema.sunatConfig)
      .values(values)
      .onConflictDoUpdate({
        target: schema.sunatConfig.organization_id,
        set: values,
      })
      .returning();

    const { sol_user_enc, sol_pass_enc, cert_enc, cert_pass_enc, ...safe } =
      saved!;
    return c.json({ success: true, data: safe });
  },
);

/** Envía el resumen diario de las boletas de una fecha. */
sunat.post(
  "/resumen-diario",
  requirePermission("invoices:create"),
  zValidator("json", resumenDiarioSchema),
  async (c) => {
    const tenant = c.get("tenant") as any;
    if (!tenant.branchId) {
      return c.json(
        {
          success: false,
          error: { code: "BAD_REQUEST", message: "Se requiere branchId" },
        },
        400,
      );
    }
    const body = c.req.valid("json");

    try {
      const { result, invoiceIds } = await enviarResumenDiario({
        organizationId: tenant.organizationId,
        branchId: tenant.branchId,
        fecha: body.fecha,
        correlativo: body.correlativo,
      });
      return c.json({ success: result.exito, data: { result, invoiceIds } });
    } catch (err) {
      return handleSunatError(c, err);
    }
  },
);

function handleSunatError(c: any, err: unknown) {
  if (err instanceof SunatConfigError) {
    return c.json(
      { success: false, error: { code: "SUNAT_CONFIG", message: err.message } },
      400,
    );
  }
  const message = err instanceof Error ? err.message : String(err);
  return c.json(
    { success: false, error: { code: "SUNAT_ERROR", message } },
    502,
  );
}

export { sunat, handleSunatError };
