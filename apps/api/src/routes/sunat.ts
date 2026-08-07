import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../types.js";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db, schema } from "@restai/db";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import { requirePermission } from "../middleware/rbac.js";
import { auditFromContext } from "../lib/audit.js";
import { encryptSecret, isEncryptionAvailable } from "../lib/crypto.js";
import {
  describeSunatConfig,
  enviarResumenDiario,
  getSunatConfigRow,
  loadSeries,
  probarConexion,
  saveSeries,
  SERIES_POR_DEFECTO,
  SunatConfigError,
  SunatDocumentError,
  validarSeries,
  type SeriesConfig,
} from "../services/sunat.service.js";

const sunat = new Hono<AppEnv>();

sunat.use("*", authMiddleware);
sunat.use("*", tenantMiddleware);

// ───────────────────────────────────────────────────────────────────────────
// Esquemas (inline: este archivo no comparte validadores con nadie)
// ───────────────────────────────────────────────────────────────────────────

/** Serie válida: letra del tipo de comprobante + 3 alfanuméricos en mayúscula. */
const serieSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{4}$/, "La serie debe tener 4 caracteres (ej. F001)");

const seriesSchema = z.object({
  boleta: serieSchema,
  factura: serieSchema,
  nota_credito_boleta: serieSchema,
  nota_credito_factura: serieSchema,
});

const configSchema = z.object({
  ruc: z
    .string()
    .trim()
    .regex(/^(10|15|16|17|20)\d{9}$/, "RUC inválido: 11 dígitos que empiezan en 10, 15, 16, 17 o 20"),
  razonSocial: z.string().trim().min(1).max(255),
  nombreComercial: z.string().trim().max(255).nullable().optional(),
  ubigeo: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "El ubigeo son 6 dígitos")
    .nullable()
    .optional(),
  departamento: z.string().trim().max(100).nullable().optional(),
  provincia: z.string().trim().max(100).nullable().optional(),
  distrito: z.string().trim().max(100).nullable().optional(),
  direccion: z.string().trim().max(500).nullable().optional(),
  // OJO: sin `.default()`. Un PUT que omita el ambiente NO puede devolver a
  // BETA un emisor que ya está en producción: los comprobantes dejarían de
  // tener validez fiscal sin que nadie lo pidiera. Se conserva el anterior.
  ambiente: z.enum(["beta", "production"]).optional(),
  endpointOverride: z.string().url().nullable().optional(),
  // Secretos: llegan en claro y se guardan cifrados. Omitirlos CONSERVA el valor
  // anterior; enviarlos vacíos no está permitido (se usa null explícito para borrar).
  solUser: z.string().trim().min(1).max(100).optional(),
  solPass: z.string().min(1).max(100).optional(),
  /** Certificado: PFX/P12 en base64, o el PEM completo (clave + certificado). */
  certificate: z.string().min(1).optional(),
  certificatePassword: z.string().max(200).nullable().optional(),
  // Tampoco lleva `.default()`: marcar como PFX un PEM ya guardado rompería
  // toda emisión con SUNAT_CERT_INVALID.
  certificateFormat: z.enum(["pfx", "pem"]).optional(),
  enabled: z.boolean().optional(),
  series: seriesSchema.partial().optional(),
});

const resumenSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe ser YYYY-MM-DD"),
  correlativo: z.number().int().min(1).max(99999).default(1),
});

// ───────────────────────────────────────────────────────────────────────────
// Configuración
// ───────────────────────────────────────────────────────────────────────────

/**
 * Configuración del emisor electrónico, SIN secretos.
 *
 * Nunca devuelve la clave SOL ni el certificado: solo si están presentes, el
 * usuario SOL enmascarado, el estado del certificado (sujeto, vigencia, días
 * para vencer) y la fecha de la última carga.
 */
sunat.get("/config", requirePermission("sunat:read"), async (c) => {
  const tenant = c.get("tenant") as any;
  try {
    const vista = await describeSunatConfig(
      tenant.organizationId,
      tenant.branchId ?? null,
    );

    if (!vista) {
      // No es un error: es el estado inicial. Se devuelve el esqueleto para que
      // la UI pueda pintar el formulario vacío con los valores por defecto.
      return c.json({
        success: true,
        data: {
          configurado: false,
          series: tenant.branchId
            ? await loadSeries(tenant.branchId)
            : { ...SERIES_POR_DEFECTO },
          cifrado_disponible: isEncryptionAvailable(),
          advertencias: isEncryptionAvailable()
            ? ["Aún no has configurado la facturación electrónica."]
            : [
                "Aún no has configurado la facturación electrónica.",
                "El servidor no tiene SUNAT_ENCRYPTION_KEY: no se podrán guardar las credenciales.",
              ],
        },
      });
    }

    return c.json({
      success: true,
      data: { ...vista, cifrado_disponible: isEncryptionAvailable() },
    });
  } catch (err) {
    // El manejador global no conoce SunatConfigError y lo convertiría en un 500
    // "Error interno del servidor", justo lo que el encargo prohíbe.
    return handleSunatError(c, err);
  }
});

/**
 * Crea o actualiza la configuración del emisor electrónico.
 *
 * Los secretos se cifran con AES-256-GCM (lib/crypto.ts) antes de tocar la BD y
 * se omiten por completo de la traza de auditoría.
 */
sunat.put(
  "/config",
  requirePermission("sunat:*"),
  zValidator("json", configSchema),
  async (c) => {
    const tenant = c.get("tenant") as any;
    const body = c.req.valid("json");

    const traeSecretos = !!(
      body.solUser ||
      body.solPass ||
      body.certificate ||
      body.certificatePassword
    );
    if (traeSecretos && !isEncryptionAvailable()) {
      return c.json(
        {
          success: false,
          error: {
            code: "SUNAT_ENCRYPTION_UNAVAILABLE",
            message:
              "El servidor no tiene SUNAT_ENCRYPTION_KEY (mínimo 16 caracteres): no se pueden guardar credenciales ni certificados",
          },
        },
        400,
      );
    }

    const anterior = await getSunatConfigRow(tenant.organizationId);

    // Activar la facturación sin credenciales completas es una trampa: el
    // primer cobro fallaría en caja. Se bloquea aquí con un mensaje claro.
    const tendraSolUser = !!(body.solUser || anterior?.sol_user_enc);
    const tendraSolPass = !!(body.solPass || anterior?.sol_pass_enc);
    const tendraCert = !!(body.certificate || anterior?.cert_enc);
    if (body.enabled && !(tendraSolUser && tendraSolPass && tendraCert)) {
      return c.json(
        {
          success: false,
          error: {
            code: "SUNAT_CREDENTIALS_MISSING",
            message:
              "Para activar la facturación electrónica hacen falta el usuario SOL, la clave SOL y el certificado digital",
          },
        },
        400,
      );
    }

    // Campos que un PUT parcial NO puede resetear a su valor por defecto.
    const ambiente = body.ambiente ?? anterior?.ambiente ?? "beta";
    // El formato del certificado solo cambia cuando llega uno nuevo (o cuando
    // se corrige explícitamente): si no, se conserva el del fichero guardado.
    const certFormat = body.certificate
      ? body.certificateFormat ?? "pfx"
      : body.certificateFormat ?? anterior?.cert_format ?? "pfx";

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
      ambiente,
      endpoint_override: body.endpointOverride ?? null,
      cert_format: certFormat,
      enabled: body.enabled ?? anterior?.enabled ?? false,
      updated_at: new Date(),
    };

    if (body.solUser) values.sol_user_enc = encryptSecret(body.solUser);
    if (body.solPass) values.sol_pass_enc = encryptSecret(body.solPass);
    if (body.certificate) values.cert_enc = encryptSecret(body.certificate);
    if (body.certificatePassword !== undefined) {
      values.cert_pass_enc = body.certificatePassword
        ? encryptSecret(body.certificatePassword)
        : null;
    } else if (body.certificate) {
      // Certificado nuevo sin contraseña: la anterior es la de OTRO fichero y
      // solo serviría para que la apertura del PFX fallase. Se descarta.
      values.cert_pass_enc = null;
    }

    // ── Series de la sede ───────────────────────────────────────────────
    // Se validan ANTES de escribir nada y se guardan en la MISMA transacción
    // que la configuración: si el upsert falla, la sede no se queda con unas
    // series nuevas apuntando a una configuración vieja.
    let propuestas: SeriesConfig | null = null;
    let seriesAnteriores: SeriesConfig | null = null;
    if (body.series) {
      if (!tenant.branchId) {
        return c.json(
          {
            success: false,
            error: {
              code: "BAD_REQUEST",
              message:
                "Las series van por sede: envía la cabecera x-branch-id para configurarlas",
            },
          },
          400,
        );
      }
      seriesAnteriores = await loadSeries(tenant.branchId);
      propuestas = { ...seriesAnteriores, ...body.series };
      const errores = validarSeries(propuestas);
      if (errores.length) {
        return c.json(
          {
            success: false,
            error: { code: "SUNAT_SERIES_INVALID", message: errores.join("; ") },
          },
          400,
        );
      }
    }

    let vista: Awaited<ReturnType<typeof describeSunatConfig>> = null;
    try {
      await db.transaction(async (tx) => {
        await tx
          .insert(schema.sunatConfig)
          .values(values)
          .onConflictDoUpdate({
            target: schema.sunatConfig.organization_id,
            set: values,
          });

        if (propuestas && tenant.branchId) {
          await saveSeries(tenant.branchId, propuestas, tx);
        }
      });

      vista = await describeSunatConfig(
        tenant.organizationId,
        tenant.branchId ?? null,
      );
    } catch (err) {
      return handleSunatError(c, err);
    }

    // Traza SIN secretos: solo los campos públicos y los flags de presencia.
    await auditFromContext(c, {
      action: "sunat.config_update",
      entityType: "sunat_config",
      entityId: vista?.id ?? null,
      summary: `Configuración SUNAT actualizada (RUC ${body.ruc}, ambiente ${ambiente})`,
      before: anterior ? resumenAuditable(anterior, seriesAnteriores) : null,
      after: vista
        ? {
            ruc: vista.ruc,
            razon_social: vista.razon_social,
            ambiente: vista.ambiente,
            enabled: vista.enabled,
            endpoint_override: vista.endpoint_override,
            tiene_credenciales_sol: vista.tiene_credenciales_sol,
            tiene_certificado: vista.certificado.presente,
            certificado_valido: vista.certificado.valido,
            certificado_vence: vista.certificado.validoHasta ?? null,
            series: propuestas,
          }
        : null,
    });

    return c.json({ success: true, data: vista });
  },
);

/** Instantánea auditable de la configuración: jamás incluye secretos. */
function resumenAuditable(
  row: typeof schema.sunatConfig.$inferSelect,
  series: SeriesConfig | null,
) {
  return {
    ruc: row.ruc,
    razon_social: row.razon_social,
    ambiente: row.ambiente,
    enabled: row.enabled,
    endpoint_override: row.endpoint_override,
    tiene_credenciales_sol: !!(row.sol_user_enc && row.sol_pass_enc),
    tiene_certificado: !!row.cert_enc,
    cert_format: row.cert_format,
    series,
  };
}

/**
 * Prueba la configuración contra SUNAT sin emitir nada: abre el certificado,
 * firma un XML de prueba en local y valida el usuario SOL contra el endpoint
 * configurado. Es lo que le da confianza al cliente al terminar de configurar.
 */
sunat.post("/config/test", requirePermission("sunat:*"), async (c) => {
  const tenant = c.get("tenant") as any;
  try {
    const resultado = await probarConexion(tenant.organizationId);
    // `success` describe si el DIAGNÓSTICO se pudo hacer, no si SUNAT contestó
    // que todo está bien: ese veredicto va en `data.ok` y su explicación en
    // `data.mensaje`. Devolver success:false aquí haría que el cliente HTTP
    // (que lanza con `error.message`) tirase el diagnóstico a la basura y
    // mostrase "Error desconocido", que es justo lo contrario de lo que este
    // endpoint existe para dar.
    return c.json({ success: true, data: resultado });
  } catch (err) {
    return handleSunatError(c, err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Series
// ───────────────────────────────────────────────────────────────────────────

/** Series de numeración de la sede activa. */
sunat.get("/series", requirePermission("sunat:read"), async (c) => {
  const tenant = c.get("tenant") as any;
  if (!tenant.branchId) {
    return c.json(
      {
        success: false,
        error: {
          code: "BAD_REQUEST",
          message: "Las series van por sede: envía la cabecera x-branch-id",
        },
      },
      400,
    );
  }
  try {
    return c.json({ success: true, data: await loadSeries(tenant.branchId) });
  } catch (err) {
    return handleSunatError(c, err);
  }
});

/** Cambia las series de la sede activa (no renumera lo ya emitido). */
sunat.put(
  "/series",
  requirePermission("sunat:*"),
  zValidator("json", seriesSchema.partial()),
  async (c) => {
    const tenant = c.get("tenant") as any;
    if (!tenant.branchId) {
      return c.json(
        {
          success: false,
          error: {
            code: "BAD_REQUEST",
            message: "Las series van por sede: envía la cabecera x-branch-id",
          },
        },
        400,
      );
    }

    const actuales = await loadSeries(tenant.branchId);
    const propuestas: SeriesConfig = { ...actuales, ...c.req.valid("json") };
    const errores = validarSeries(propuestas);
    if (errores.length) {
      return c.json(
        {
          success: false,
          error: { code: "SUNAT_SERIES_INVALID", message: errores.join("; ") },
        },
        400,
      );
    }

    try {
      await saveSeries(tenant.branchId, propuestas);
    } catch (err) {
      return handleSunatError(c, err);
    }

    await auditFromContext(c, {
      action: "sunat.config_update",
      entityType: "branch",
      entityId: tenant.branchId,
      summary: "Series de comprobantes actualizadas",
      before: actuales,
      after: propuestas,
    });

    return c.json({ success: true, data: propuestas });
  },
);

// ───────────────────────────────────────────────────────────────────────────
// Resumen diario
// ───────────────────────────────────────────────────────────────────────────

/** Envía el resumen diario de las boletas de una fecha (RC). */
sunat.post(
  "/resumen-diario",
  requirePermission("invoices:create"),
  zValidator("json", resumenSchema),
  async (c) => {
    const tenant = c.get("tenant") as any;
    if (!tenant.branchId) {
      return c.json(
        {
          success: false,
          error: { code: "BAD_REQUEST", message: "Se requiere la sede (x-branch-id)" },
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

      if (!result.exito) {
        // Un rechazo de SUNAT tiene que llegar con `error`: el cliente HTTP
        // lanza leyendo `error.message` y sin él el cajero vería
        // "Error desconocido" en vez del motivo real del rechazo.
        return c.json(
          {
            success: false,
            error: {
              code: result.codigo ? `SUNAT_${result.codigo}` : "SUNAT_REJECTED",
              message: result.descripcion ?? "SUNAT no aceptó el resumen diario",
            },
            data: { result, invoiceIds },
          },
          422,
        );
      }

      return c.json({ success: true, data: { result, invoiceIds } });
    } catch (err) {
      return handleSunatError(c, err);
    }
  },
);

/**
 * Traduce los errores de SUNAT a respuestas accionables.
 *
 * - Falta de configuración → 400 con el código concreto y la ruta de arreglo,
 *   nunca un 500 opaco.
 * - Documento inválido / operación no permitida → 422.
 * - Fallo de comunicación con SUNAT → 502 (el problema no es del cliente).
 */
function handleSunatError(c: Context, err: unknown) {
  if (err instanceof SunatConfigError) {
    return c.json(
      { success: false, error: { code: err.code, message: err.message } },
      400,
    );
  }
  if (err instanceof SunatDocumentError) {
    return c.json(
      { success: false, error: { code: err.code, message: err.message } },
      422,
    );
  }
  const message = err instanceof Error ? err.message : String(err);
  return c.json(
    { success: false, error: { code: "SUNAT_ERROR", message } },
    502,
  );
}

export { sunat, handleSunatError };
