import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { db, schema, type DbOrTx } from "@restai/db";
import { logger } from "./logger.js";

/**
 * Registro de auditoría.
 *
 * Responde preguntas que hoy nadie podía contestar: quién anuló la venta de
 * S/ 380 del viernes, quién bajó el IGV, quién cambió la contraseña de un
 * administrador. Se escribe desde los endpoints sensibles, nunca desde los de
 * lectura.
 *
 * Reglas de diseño:
 * - `user_email` y `user_role` se guardan como SNAPSHOT: la traza debe seguir
 *   siendo legible cuando el empleado ya no exista.
 * - Escribir la traza NUNCA puede tumbar la operación auditada. Si el insert
 *   falla, se registra el error y se sigue: perder una línea de auditoría es
 *   malo, pero perder el cobro del cliente es peor.
 * - Si se pasa una transacción, la traza entra en ella y comparte su destino
 *   (útil cuando la auditoría debe ser atómica con el cambio).
 */

export type AuditAction =
  | "payment.create"
  | "payment.void"
  | "order.create"
  | "order.cancel"
  | "order.void"
  | "order.status_change"
  | "order_item.cancel"
  | "cash.open"
  | "cash.close"
  | "settings.update"
  | "branch.update"
  | "branch.create"
  | "menu.price_change"
  | "menu.availability_change"
  | "menu.delete"
  | "menu.restore"
  | "staff.create"
  | "staff.update"
  | "staff.password_change"
  | "staff.deactivate"
  | "staff.shift_force_close"
  | "table.delete"
  | "table.free"
  | "table.move"
  | "table.merge"
  | "space.delete"
  | "session.force_end"
  | "inventory.adjust"
  | "loyalty.points_adjust"
  | "loyalty.reward_redeem"
  // Difusión masiva de una campaña por correo: quién escribió a cuántos clientes
  // y con qué segmento. Además de la traza, es el candado antirrepetición del
  // envío (ver sendCampaignAnnouncement).
  | "campaign.send"
  | "customer.merge"
  | "customer.anonymize"
  | "invoice.emit"
  | "invoice.void"
  | "sunat.config_update";

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  summary?: string;
  before?: unknown;
  after?: unknown;
}

/**
 * Formatea céntimos como importe para las FRASES de auditoría.
 *
 * El resumen lo lee un gerente, no un programador: "un saldo pendiente de 2596
 * céntimos" obliga a dividir mentalmente entre cien para entender que se
 * perdonaron veinticinco soles con noventa y seis. Los importes que viajan en
 * `before`/`after` sí se quedan en céntimos —son el dato, y la pantalla ya sabe
 * formatearlos—; esto es solo para el texto.
 */
export function auditMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}S/ ${(Math.abs(cents) / 100).toFixed(2)}`;
}

interface AuditActor {
  organizationId: string;
  branchId?: string | null;
  userId?: string | null;
  userEmail?: string | null;
  userRole?: string | null;
  ip?: string | null;
}

/**
 * Extrae el actor del contexto Hono. Tolera contextos de cliente (comensal),
 * donde no hay usuario de staff.
 */
export function actorFromContext(c: Context): AuditActor | null {
  const tenant = c.get("tenant") as any;
  if (!tenant?.organizationId) return null;
  const user = c.get("user") as any;
  return {
    organizationId: tenant.organizationId,
    branchId: tenant.branchId ?? null,
    userId: user?.sub ?? null,
    userEmail: user?.email ?? null,
    userRole: user?.role ?? null,
    ip:
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip") ??
      null,
  };
}

/** Recorta payloads grandes para que la tabla de auditoría no se vuelva un log de aplicación. */
function trim(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null) return null;
  const json = JSON.stringify(value);
  if (json && json.length > 8000) {
    return { _truncated: true, preview: json.slice(0, 2000) };
  }
  return value;
}

/**
 * Escribe una entrada de auditoría. No lanza nunca.
 *
 * @param txOrDb pasa la transacción si la traza debe ser atómica con el cambio;
 *               omítela para escribirla fuera (por defecto).
 */
export async function audit(
  actor: AuditActor | null,
  entry: AuditEntry,
  txOrDb: DbOrTx = db,
): Promise<void> {
  if (!actor) return;
  try {
    // El token de acceso no incluye el email, así que el snapshot llegaría
    // vacío y la traza diría "null" en la columna que más se mira. Se resuelve
    // aquí una sola vez, desde la misma conexión/transacción.
    let userEmail = actor.userEmail ?? null;
    let userRole = actor.userRole ?? null;
    if (!userEmail && actor.userId) {
      const [row] = await txOrDb
        .select({ email: schema.users.email, role: schema.users.role })
        .from(schema.users)
        .where(eq(schema.users.id, actor.userId))
        .limit(1);
      userEmail = row?.email ?? null;
      userRole = userRole ?? row?.role ?? null;
    }

    await txOrDb.insert(schema.auditLogs).values({
      organization_id: actor.organizationId,
      branch_id: actor.branchId ?? null,
      user_id: actor.userId ?? null,
      user_email: userEmail,
      user_role: userRole,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      summary: entry.summary ?? null,
      before: trim(entry.before) as any,
      after: trim(entry.after) as any,
      ip: actor.ip ?? null,
    });
  } catch (err) {
    logger.error("No se pudo escribir la traza de auditoría", {
      action: entry.action,
      entity: entry.entityType,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Atajo para el caso habitual: actor tomado del contexto Hono. */
export async function auditFromContext(
  c: Context,
  entry: AuditEntry,
  txOrDb: DbOrTx = db,
): Promise<void> {
  return audit(actorFromContext(c), entry, txOrDb);
}
