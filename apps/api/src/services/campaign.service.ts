import { and, eq, lte, gte, isNull, isNotNull, inArray, or, sql } from "drizzle-orm";
import { db, schema } from "@restai/db";
import { sendLoyaltyEmail } from "../lib/notifications.js";
import { audit } from "../lib/audit.js";
import { logger } from "../lib/logger.js";

/** Actor de auditoría tal como lo produce actorFromContext(c). */
type AuditActor = Parameters<typeof audit>[0];

// Perú siempre es UTC-5 (no hay horario de verano).
const PERU_OFFSET_MS = -5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Proyecta un `Date` UTC sobre el reloj de pared de Lima. Devuelve el día de la
 * semana (0=Dom..6=Sáb) y la hora "HH:MM" en formato 24h, desplazando el
 * instante por el offset fijo de -5h y leyendo los componentes UTC (el mismo
 * enfoque que lib/timezone.ts).
 */
function limaWallClock(at: Date): { weekday: number; hhmm: string } {
  const lima = new Date(at.getTime() + PERU_OFFSET_MS);
  const weekday = lima.getUTCDay();
  const hh = String(lima.getUTCHours()).padStart(2, "0");
  const mm = String(lima.getUTCMinutes()).padStart(2, "0");
  return { weekday, hhmm: `${hh}:${mm}` };
}

/**
 * Indica si `hhmm` cae dentro de la ventana horaria [start, end] de Lima.
 * - Ambos nulos => siempre dentro (todo el día).
 * - start <= end (ventana normal): start <= hhmm <= end.
 * - start > end (la ventana cruza la medianoche): hhmm >= start O hhmm <= end.
 * Un solo extremo nulo se trata como abierto por ese lado.
 */
function inTimeWindow(
  hhmm: string,
  start: string | null,
  end: string | null,
): boolean {
  if (!start && !end) return true;
  if (start && !end) return hhmm >= start;
  if (!start && end) return hhmm <= end;
  // ambos presentes
  if (start! <= end!) return hhmm >= start! && hhmm <= end!;
  return hhmm >= start! || hhmm <= end!;
}

/** Fecha legible en español peruano ("7 de agosto de 2026") en huso de Lima. */
function formatLimaDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString("es-PE", {
    timeZone: "America/Lima",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

/**
 * Ejecuta `fn` sobre `items` en lotes de `size`, con una pausa entre lotes.
 *
 * Enviar 800 correos de golpe hace dos cosas malas: revienta el límite de
 * velocidad del proveedor (la mayoría vuelve como 429) y deja el proceso
 * ocupado. Nunca lanza: cada lote usa allSettled porque un destinatario con el
 * buzón lleno no puede cancelar la campaña del resto.
 */
async function runInBatches<T>(
  items: T[],
  size: number,
  pauseMs: number,
  fn: (item: T) => Promise<unknown>,
): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.allSettled(items.slice(i, i + size).map((item) => fn(item)));
    if (i + size < items.length && pauseMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, pauseMs));
    }
  }
}

/**
 * getActiveCampaignBoost
 *
 * Bonificación de acumulación combinada de todas las campañas activas en `at`:
 *   - status = "active"
 *   - starts_at nulo o <= at, y ends_at nulo o >= at
 *   - days_of_week vacío (= todos los días) o incluye el día de Lima de `at`
 *   - la ventana start_time/end_time de Lima contiene la hora de `at`
 *   - tier_id nulo (= todos los miembros) o igual al tier del cliente
 *
 * Cuando varias campañas coinciden, sus multiplicadores se multiplican entre sí
 * (en el espacio entero "100 = 1x") y sus bonus_points se suman. Devuelve
 * { multiplier: 100, bonusPoints: 0 } si ninguna coincide. Pura / solo lectura.
 */
export async function getActiveCampaignBoost(params: {
  organizationId: string;
  tierId: string | null;
  at: Date;
}): Promise<{ multiplier: number; bonusPoints: number }> {
  const { organizationId, tierId, at } = params;

  // Se filtra por organización, estado y rango de fechas en SQL; el ajuste fino
  // de día/hora/tier ocurre en JS más abajo (days_of_week es un array jsonb y la
  // ventana horaria es reloj de pared de Lima).
  const rows = await db
    .select({
      days_of_week: schema.campaigns.days_of_week,
      start_time: schema.campaigns.start_time,
      end_time: schema.campaigns.end_time,
      multiplier: schema.campaigns.multiplier,
      bonus_points: schema.campaigns.bonus_points,
      tier_id: schema.campaigns.tier_id,
    })
    .from(schema.campaigns)
    .where(
      and(
        eq(schema.campaigns.organization_id, organizationId),
        eq(schema.campaigns.status, "active"),
        or(isNull(schema.campaigns.starts_at), lte(schema.campaigns.starts_at, at)),
        or(isNull(schema.campaigns.ends_at), gte(schema.campaigns.ends_at, at)),
      ),
    );

  if (rows.length === 0) {
    return { multiplier: 100, bonusPoints: 0 };
  }

  const { weekday, hhmm } = limaWallClock(at);

  // Los multiplicadores componen multiplicativamente en el espacio "100 = 1x",
  // por eso el producto acumulado se divide entre 100 en cada coincidencia extra.
  let multiplier = 100;
  let bonusPoints = 0;

  for (const row of rows) {
    // Segmento por tier: nulo = todos los miembros; si no, debe coincidir.
    if (row.tier_id != null && row.tier_id !== tierId) continue;

    // Día de la semana: array vacío = todos los días.
    const days = Array.isArray(row.days_of_week)
      ? (row.days_of_week as unknown[]).map((d) => Number(d))
      : [];
    if (days.length > 0 && !days.includes(weekday)) continue;

    // Ventana horaria (HH:MM de Lima).
    if (!inTimeWindow(hhmm, row.start_time, row.end_time)) continue;

    multiplier = Math.floor((multiplier * row.multiplier) / 100);
    bonusPoints += row.bonus_points;
  }

  return { multiplier, bonusPoints };
}

// ---------------------------------------------------------------------------
// Resolución de segmentos
// ---------------------------------------------------------------------------

/**
 * Filtros de segmentación de clientes. Todos son opcionales y se combinan con
 * Y lógico. Es el vocabulario con el que el dueño responde preguntas de verdad:
 * "clientes de tier Oro que no vienen hace 30 días y aceptan promociones".
 */
export interface SegmentFilter {
  /** uuid de tier, o "none" para los clientes sin tier asignado. */
  tierId?: string | null;
  /** Saldo de puntos mínimo (inclusive). */
  minPoints?: number;
  /** Saldo de puntos máximo (inclusive). */
  maxPoints?: number;
  /** Última visita (pedido completado) anterior a N días. */
  lastVisitBeforeDays?: number;
  /** Con lastVisitBeforeDays: incluir a quien nunca pidió. Por defecto true. */
  includeNeverVisited?: boolean;
  /** Cumpleaños en este mes (1-12). */
  birthdayMonth?: number;
  /** Consentimiento de marketing (Ley 29733). */
  marketingOptIn?: boolean;
  /** Solo clientes con correo utilizable. */
  requireEmail?: boolean;
}

export interface SegmentCustomer {
  id: string;
  name: string;
  email: string | null;
  marketing_opt_in: boolean;
  points_balance: number;
  tier_id: string | null;
  tier_name: string | null;
  /** ISO 8601 con offset, o null si el cliente nunca completó un pedido. */
  last_visit_at: string | null;
}

// Techo duro de destinatarios materializados en una sola llamada: protege la
// memoria del proceso y evita que un error de filtro dispare un envío masivo.
const MAX_SEGMENT_ROWS = 5000;

/**
 * Expresión SQL con la última visita del cliente: la fecha del pedido
 * COMPLETADO más reciente. Se construye por llamada porque se interpola en
 * varios sitios de la misma consulta (SELECT y WHERE).
 */
function lastVisitExpr() {
  return sql<Date | null>`(
    SELECT MAX(o.created_at) FROM orders o
    WHERE o.customer_id = ${schema.customers.id} AND o.status = 'completed'
  )`;
}

/** Traduce un SegmentFilter en condiciones SQL sobre la consulta de clientes. */
function buildSegmentConditions(
  organizationId: string,
  filter: SegmentFilter,
  now: Date,
) {
  const conditions: any[] = [
    eq(schema.customers.organization_id, organizationId),
    // Un cliente anonimizado (Ley 29733) no vuelve a recibir comunicaciones.
    isNull(schema.customers.anonymized_at),
  ];

  if (filter.requireEmail) {
    conditions.push(isNotNull(schema.customers.email));
    conditions.push(sql`${schema.customers.email} <> ''`);
  }

  if (filter.marketingOptIn !== undefined) {
    conditions.push(eq(schema.customers.marketing_opt_in, filter.marketingOptIn));
  }

  if (filter.tierId === "none") {
    conditions.push(isNull(schema.customerLoyalty.tier_id));
  } else if (filter.tierId) {
    conditions.push(eq(schema.customerLoyalty.tier_id, filter.tierId));
  }

  if (filter.minPoints !== undefined) {
    conditions.push(
      sql`COALESCE(${schema.customerLoyalty.points_balance}, 0) >= ${filter.minPoints}`,
    );
  }

  if (filter.maxPoints !== undefined) {
    conditions.push(
      sql`COALESCE(${schema.customerLoyalty.points_balance}, 0) <= ${filter.maxPoints}`,
    );
  }

  if (filter.birthdayMonth !== undefined) {
    // birth_date nulo => EXTRACT devuelve NULL => el cliente queda fuera.
    conditions.push(
      sql`EXTRACT(MONTH FROM ${schema.customers.birth_date}) = ${filter.birthdayMonth}`,
    );
  }

  if (filter.lastVisitBeforeDays !== undefined) {
    // El instante se pasa como texto ISO + cast explícito: un `Date` crudo dentro
    // de una plantilla `sql` no lo serializa el driver (no conoce el tipo de la
    // columna) y revienta al enlazar el parámetro.
    const cutoff = new Date(
      now.getTime() - filter.lastVisitBeforeDays * DAY_MS,
    ).toISOString();
    const includeNever = filter.includeNeverVisited !== false;
    conditions.push(
      includeNever
        ? sql`(${lastVisitExpr()} IS NULL OR ${lastVisitExpr()} < ${cutoff}::timestamptz)`
        : sql`(${lastVisitExpr()} IS NOT NULL AND ${lastVisitExpr()} < ${cutoff}::timestamptz)`,
    );
  }

  return conditions;
}

/**
 * resolveSegment
 *
 * Resuelve un segmento de clientes de la organización. Función pura de lectura:
 * no envía nada ni escribe nada, así la usan por igual la previsualización de
 * audiencia, el envío de campañas y (a futuro) la asignación masiva de cupones.
 *
 * El saldo de puntos y el tier salen de la inscripción del cliente en el
 * programa ACTIVO de la organización; quien no esté inscrito cuenta como 0
 * puntos y sin tier (sigue siendo alcanzable por correo).
 *
 * Devuelve el total que cumple el filtro y, como mucho, `limit` destinatarios.
 */
export async function resolveSegment(params: {
  organizationId: string;
  filter?: SegmentFilter;
  limit?: number;
  offset?: number;
}): Promise<{ total: number; recipients: SegmentCustomer[] }> {
  const { organizationId } = params;
  const filter = params.filter ?? {};
  const limit = Math.min(Math.max(params.limit ?? 100, 0), MAX_SEGMENT_ROWS);
  const offset = Math.max(params.offset ?? 0, 0);
  const now = new Date();

  // Programa activo de la organización: fija a qué inscripción miramos.
  const [program] = await db
    .select({ id: schema.loyaltyPrograms.id })
    .from(schema.loyaltyPrograms)
    .where(
      and(
        eq(schema.loyaltyPrograms.organization_id, organizationId),
        eq(schema.loyaltyPrograms.is_active, true),
      ),
    )
    .limit(1);

  // Sin programa activo no hay inscripciones que unir: el join se anula con una
  // condición falsa para que todos los clientes salgan con 0 puntos y sin tier.
  const loyaltyJoin = program
    ? and(
        eq(schema.customerLoyalty.customer_id, schema.customers.id),
        eq(schema.customerLoyalty.program_id, program.id),
      )
    : sql`false`;

  const conditions = buildSegmentConditions(organizationId, filter, now);

  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.customers)
    .leftJoin(schema.customerLoyalty, loyaltyJoin)
    .where(and(...conditions));

  const total = countRow?.total ?? 0;

  if (total === 0 || limit === 0) {
    return { total, recipients: [] };
  }

  const recipients = await db
    .select({
      id: schema.customers.id,
      name: schema.customers.name,
      email: schema.customers.email,
      marketing_opt_in: schema.customers.marketing_opt_in,
      points_balance: sql<number>`COALESCE(${schema.customerLoyalty.points_balance}, 0)::int`,
      tier_id: schema.customerLoyalty.tier_id,
      tier_name: schema.loyaltyTiers.name,
      // to_json sobre un timestamptz devuelve ISO 8601 con offset, que es lo que
      // el frontend puede parsear sin adivinar formato.
      last_visit_at: sql<string | null>`to_json(${lastVisitExpr()}) #>> '{}'`,
    })
    .from(schema.customers)
    .leftJoin(schema.customerLoyalty, loyaltyJoin)
    .leftJoin(
      schema.loyaltyTiers,
      eq(schema.customerLoyalty.tier_id, schema.loyaltyTiers.id),
    )
    .where(and(...conditions))
    .orderBy(schema.customers.name)
    .limit(limit)
    .offset(offset);

  return { total, recipients };
}

// ---------------------------------------------------------------------------
// Envío de campañas
// ---------------------------------------------------------------------------

/** Error de negocio del módulo de campañas; la ruta lo traduce a HTTP. */
export class CampaignError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "CampaignError";
  }
}

// Ventana de enfriamiento entre dos anuncios de la MISMA campaña. Un minuto no
// estorba a nadie que quiera corregir un texto y reenviar a conciencia, pero
// mata el doble clic accidental, que es el que duplica cientos de correos.
const SEND_COOLDOWN_MS = 60_000;

const WEEKDAY_LABELS = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
];

/**
 * Redacta el cuerpo por defecto del anuncio a partir de la propia campaña:
 * qué gana el cliente, qué días y a qué hora. Evita el correo vacío cuando el
 * dueño pulsa "enviar" sin escribir nada.
 */
function buildDefaultMessage(campaign: {
  description: string | null;
  days_of_week: unknown;
  start_time: string | null;
  end_time: string | null;
  multiplier: number;
  bonus_points: number;
  starts_at: Date | string | null;
  ends_at: Date | string | null;
}): string {
  const parts: string[] = [];

  if (campaign.description) parts.push(campaign.description);

  const beneficios: string[] = [];
  if (campaign.multiplier > 100) {
    const factor = (campaign.multiplier / 100).toFixed(2).replace(/\.?0+$/, "");
    beneficios.push(`acumulas ${factor}x puntos`);
  }
  if (campaign.bonus_points > 0) {
    beneficios.push(`sumas ${campaign.bonus_points} puntos extra por pedido`);
  }
  if (beneficios.length > 0) {
    parts.push(`Durante la promoción ${beneficios.join(" y ")}.`);
  }

  const days = Array.isArray(campaign.days_of_week)
    ? (campaign.days_of_week as unknown[]).map((d) => Number(d)).filter((d) => d >= 0 && d <= 6)
    : [];
  if (days.length > 0) {
    const nombres = days.map((d) => WEEKDAY_LABELS[d]).join(", ");
    parts.push(`Válido los días: ${nombres}.`);
  }

  if (campaign.start_time || campaign.end_time) {
    const desde = campaign.start_time ?? "la apertura";
    const hasta = campaign.end_time ?? "el cierre";
    parts.push(`Horario: de ${desde} a ${hasta}.`);
  }

  const desdeFecha = formatLimaDate(campaign.starts_at);
  const hastaFecha = formatLimaDate(campaign.ends_at);
  if (desdeFecha && hastaFecha) {
    parts.push(`Del ${desdeFecha} al ${hastaFecha}.`);
  } else if (hastaFecha) {
    parts.push(`Hasta el ${hastaFecha}.`);
  } else if (desdeFecha) {
    parts.push(`A partir del ${desdeFecha}.`);
  }

  return parts.join("\n\n");
}

/**
 * sendCampaignAnnouncement
 *
 * Anuncia una campaña por correo al segmento indicado. Un Happy Hour que el
 * cliente no conoce cuesta margen y no genera visitas: esto es lo que convierte
 * la configuración en visitas.
 *
 * Garantías:
 * - Consentimiento: el segmento se fuerza a marketingOptIn=true y correo no
 *   vacío, y además se envía con sendLoyaltyEmail, que vuelve a comprobar el
 *   consentimiento antes de entregar (Ley 29733).
 * - Trazabilidad: cada intento (enviado, fallido u omitido) queda en
 *   notification_log con tipo "campaign".
 * - Ritmo: se envía en lotes con pausa, nunca todo de golpe.
 * - No se repite por accidente: el envío toma FOR UPDATE sobre la fila de la
 *   campaña y rechaza un segundo disparo dentro de la ventana de enfriamiento
 *   (el doble clic del dueño no puede costar 2 000 correos duplicados).
 * - Trazado: queda una entrada de auditoría `campaign.send` con el segmento y
 *   el alcance, en la misma transacción que el candado.
 * - No bloquea: la resolución de audiencia y la asignación del cupón son
 *   síncronas (el llamador necesita el conteo), la entrega corre en segundo
 *   plano sobre el proceso de larga vida de la API.
 */
export async function sendCampaignAnnouncement(params: {
  organizationId: string;
  campaignId: string;
  subject?: string | null;
  title?: string | null;
  message?: string | null;
  couponId?: string | null;
  segment?: SegmentFilter;
  maxRecipients?: number;
  /**
   * Actor de la traza (actorFromContext(c)). Es también lo que activa el candado
   * antirrepetición: sin actor no hay fila de auditoría contra la que comparar.
   */
  actor?: AuditActor;
}): Promise<{
  campaignId: string;
  audience: number;
  queued: number;
  couponCode: string | null;
}> {
  const { organizationId, campaignId } = params;

  const [campaign] = await db
    .select()
    .from(schema.campaigns)
    .where(
      and(
        eq(schema.campaigns.id, campaignId),
        eq(schema.campaigns.organization_id, organizationId),
      ),
    )
    .limit(1);

  if (!campaign) {
    throw new CampaignError("NOT_FOUND", "Campaña no encontrada");
  }

  if (campaign.status === "ended") {
    throw new CampaignError(
      "CAMPAIGN_ENDED",
      "La campaña ya terminó: no se puede anunciar una promoción vencida",
    );
  }

  // Cupón opcional adjunto al anuncio.
  let coupon: { id: string; code: string; name: string } | null = null;
  if (params.couponId) {
    const [found] = await db
      .select({
        id: schema.coupons.id,
        code: schema.coupons.code,
        name: schema.coupons.name,
        status: schema.coupons.status,
        expires_at: schema.coupons.expires_at,
      })
      .from(schema.coupons)
      .where(
        and(
          eq(schema.coupons.id, params.couponId),
          eq(schema.coupons.organization_id, organizationId),
        ),
      )
      .limit(1);

    if (!found) {
      throw new CampaignError("COUPON_NOT_FOUND", "Cupón no encontrado");
    }
    const now = new Date();
    if (found.status !== "active" || (found.expires_at && found.expires_at < now)) {
      throw new CampaignError(
        "COUPON_NOT_AVAILABLE",
        "El cupón no está activo o ya venció",
      );
    }
    coupon = { id: found.id, code: found.code, name: found.name };
  }

  // El consentimiento y el correo no son negociables aunque el filtro diga otra cosa.
  const { total, recipients } = await resolveSegment({
    organizationId,
    filter: { ...(params.segment ?? {}), marketingOptIn: true, requireEmail: true },
    limit: Math.min(params.maxRecipients ?? 2000, MAX_SEGMENT_ROWS),
  });

  if (recipients.length === 0) {
    return { campaignId, audience: total, queued: 0, couponCode: coupon?.code ?? null };
  }

  const [org] = await db
    .select({ name: schema.organizations.name })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, organizationId))
    .limit(1);

  const orgName = org?.name ?? "RestAI";
  const subject = (params.subject ?? "").trim() || `${campaign.name} en ${orgName}`;
  const title = (params.title ?? "").trim() || campaign.name;
  const message = (params.message ?? "").trim() || buildDefaultMessage(campaign);

  // Candado + asignación de cupón + traza, todo en la misma transacción.
  //
  // El FOR UPDATE sobre la campaña serializa dos envíos simultáneos de la MISMA
  // campaña: el segundo espera al primero, ve su traza `campaign.send` recién
  // escrita y se rechaza. Sin esto, un doble clic en el botón duplica el correo
  // a toda la base de clientes.
  await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: schema.campaigns.id, status: schema.campaigns.status })
      .from(schema.campaigns)
      .where(
        and(
          eq(schema.campaigns.id, campaignId),
          eq(schema.campaigns.organization_id, organizationId),
        ),
      )
      .limit(1)
      .for("update");

    if (!locked) {
      throw new CampaignError("NOT_FOUND", "Campaña no encontrada");
    }
    // Otro administrador pudo terminarla mientras se resolvía la audiencia.
    if (locked.status === "ended") {
      throw new CampaignError(
        "CAMPAIGN_ENDED",
        "La campaña ya terminó: no se puede anunciar una promoción vencida",
      );
    }

    const [recent] = await tx
      .select({ created_at: schema.auditLogs.created_at })
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.organization_id, organizationId),
          eq(schema.auditLogs.action, "campaign.send"),
          eq(schema.auditLogs.entity_id, campaignId),
          gte(schema.auditLogs.created_at, new Date(Date.now() - SEND_COOLDOWN_MS)),
        ),
      )
      .limit(1);

    if (recent) {
      throw new CampaignError(
        "SEND_IN_COOLDOWN",
        `Esta campaña se anunció hace menos de ${Math.round(SEND_COOLDOWN_MS / 1000)} segundos. Espera antes de volver a enviarla para no duplicar correos.`,
      );
    }

    // Si el anuncio lleva cupón, se asigna a cada destinatario para que el canje
    // quede ligado al cliente (uq_coupon_customer hace idempotente el reenvío).
    if (coupon) {
      const CHUNK_INSERT = 500;
      for (let i = 0; i < recipients.length; i += CHUNK_INSERT) {
        const values = recipients.slice(i, i + CHUNK_INSERT).map((r) => ({
          coupon_id: coupon!.id,
          customer_id: r.id,
        }));
        await tx.insert(schema.couponAssignments).values(values).onConflictDoNothing();
      }
    }

    await audit(params.actor ?? null, {
      action: "campaign.send",
      entityType: "campaign",
      entityId: campaignId,
      summary: `Anuncio de "${campaign.name}" a ${recipients.length} cliente(s) con correo y consentimiento (segmento de ${total})${coupon ? ` con el cupón ${coupon.code}` : ""}`,
      after: {
        campaignId,
        subject,
        recipients: recipients.length,
        audience: total,
        couponCode: coupon?.code ?? null,
        segment: params.segment ?? {},
      },
    }, tx);
  });

  // Entrega en segundo plano: el llamador ya sabe a cuántos alcanza y no debe
  // esperar a que salgan cientos de correos. Corre hasta el final en el proceso
  // de larga vida de la API (el runtime del panel de administración).
  void (async () => {
    try {
      await runInBatches(recipients, 5, 250, (r) =>
        sendLoyaltyEmail({
          organizationId,
          customerId: r.id,
          toAddress: r.email,
          marketingOptIn: r.marketing_opt_in,
          type: "campaign",
          orgName,
          data: {
            customerName: r.name,
            subject,
            title,
            message,
            couponCode: coupon?.code ?? null,
          },
        }),
      );
      logger.info("Anuncio de campaña enviado", {
        campaignId,
        organizationId,
        queued: recipients.length,
      });
    } catch (err) {
      logger.error("Falló el envío del anuncio de campaña", {
        campaignId,
        organizationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();

  return {
    campaignId,
    audience: total,
    queued: recipients.length,
    couponCode: coupon?.code ?? null,
  };
}

// ---------------------------------------------------------------------------
// Aviso de puntos por vencer
// ---------------------------------------------------------------------------

/**
 * notifyExpiringPoints
 *
 * Avisa por correo a los clientes cuyos puntos vencen dentro de `daysAhead`
 * días. Sin este aviso los puntos caducan en silencio: se le quita valor al
 * cliente sin darle la oportunidad de gastarlo, que es exactamente lo contrario
 * de fidelizar.
 *
 * Pensada para que la llame un cron (a diario). Parámetros:
 * - organizationId: opcional; omitido = todas las organizaciones (modo cron).
 * - daysAhead: horizonte de aviso en días (por defecto 7).
 *
 * Idempotencia por (cliente, ventana): la ventana de aviso de un lote que vence
 * en T es [T - daysAhead, T]. Si en notification_log ya existe un aviso
 * "points_expiring" de ese cliente creado dentro de esa ventana, ese lote ya se
 * avisó y se omite. Cuando el lote más próximo vence y aparece otro posterior,
 * su ventana empieza más tarde y el aviso vuelve a salir. Como notification_log
 * registra también los intentos fallidos u omitidos, un proveedor caído no
 * provoca una tormenta de reintentos diarios.
 *
 * Solo avisa a quien tiene consentimiento de marketing y correo: el envío pasa
 * igualmente por sendLoyaltyEmail, que nunca lanza.
 */
export async function notifyExpiringPoints(params?: {
  organizationId?: string;
  daysAhead?: number;
}): Promise<{ candidates: number; notified: number; skipped: number }> {
  const organizationId = params?.organizationId;
  const daysAhead = Math.min(Math.max(params?.daysAhead ?? 7, 1), 90);
  const now = new Date();
  const horizon = new Date(now.getTime() + daysAhead * DAY_MS);

  const conditions: any[] = [
    eq(schema.loyaltyTransactions.type, "earned"),
    eq(schema.loyaltyTransactions.expired, false),
    isNotNull(schema.loyaltyTransactions.expires_at),
    gte(schema.loyaltyTransactions.expires_at, now),
    lte(schema.loyaltyTransactions.expires_at, horizon),
    isNull(schema.customers.anonymized_at),
    eq(schema.customers.marketing_opt_in, true),
    isNotNull(schema.customers.email),
    sql`${schema.customers.email} <> ''`,
  ];

  if (organizationId) {
    conditions.push(eq(schema.customers.organization_id, organizationId));
  }

  // Un cliente puede tener varios lotes por vencer: se agregan en un solo aviso
  // con el total en riesgo y la fecha del lote más próximo.
  const rows = await db
    .select({
      customer_id: schema.customers.id,
      organization_id: schema.customers.organization_id,
      name: schema.customers.name,
      email: schema.customers.email,
      marketing_opt_in: schema.customers.marketing_opt_in,
      org_name: schema.organizations.name,
      points_balance: schema.customerLoyalty.points_balance,
      points_due: sql<number>`SUM(${schema.loyaltyTransactions.points})::int`,
      earliest_expiry: sql<Date>`MIN(${schema.loyaltyTransactions.expires_at})`,
    })
    .from(schema.loyaltyTransactions)
    .innerJoin(
      schema.customerLoyalty,
      eq(schema.loyaltyTransactions.customer_loyalty_id, schema.customerLoyalty.id),
    )
    .innerJoin(
      schema.loyaltyPrograms,
      and(
        eq(schema.customerLoyalty.program_id, schema.loyaltyPrograms.id),
        eq(schema.loyaltyPrograms.is_active, true),
      ),
    )
    .innerJoin(
      schema.customers,
      and(
        eq(schema.customerLoyalty.customer_id, schema.customers.id),
        eq(schema.loyaltyPrograms.organization_id, schema.customers.organization_id),
      ),
    )
    .innerJoin(
      schema.organizations,
      eq(schema.customers.organization_id, schema.organizations.id),
    )
    .where(and(...conditions))
    .groupBy(
      schema.customers.id,
      schema.customers.organization_id,
      schema.customers.name,
      schema.customers.email,
      schema.customers.marketing_opt_in,
      schema.organizations.name,
      schema.customerLoyalty.points_balance,
    );

  let notified = 0;
  let skipped = 0;

  // Último aviso "points_expiring" de cada candidato, en UNA consulta por tandas
  // de 1 000 ids. Antes se hacía un SELECT por cliente: en un cron nocturno con
  // miles de candidatos eso son miles de idas y vueltas a la base para no
  // enviar nada. La cota inferior común es `now - daysAhead`, porque la ventana
  // de cualquier candidato empieza como mucho ahí (su lote vence entre hoy y
  // hoy+daysAhead).
  const lastWarnedAt = new Map<string, Date>();
  const candidateIds = rows.map((r) => r.customer_id);
  const globalWindowStart = new Date(now.getTime() - daysAhead * DAY_MS);
  const ID_CHUNK = 1000;

  for (let i = 0; i < candidateIds.length; i += ID_CHUNK) {
    const chunk = candidateIds.slice(i, i + ID_CHUNK);
    const warned = await db
      .select({
        customer_id: schema.notificationLog.customer_id,
        last_at: sql<Date>`MAX(${schema.notificationLog.created_at})`,
      })
      .from(schema.notificationLog)
      .where(
        and(
          eq(schema.notificationLog.type, "points_expiring"),
          inArray(schema.notificationLog.customer_id, chunk),
          gte(schema.notificationLog.created_at, globalWindowStart),
        ),
      )
      .groupBy(schema.notificationLog.customer_id);

    for (const w of warned) {
      if (!w.customer_id) continue;
      const at = w.last_at instanceof Date ? w.last_at : new Date(w.last_at as unknown as string);
      if (!isNaN(at.getTime())) lastWarnedAt.set(w.customer_id, at);
    }
  }

  // Se resuelve la idempotencia antes de enviar y se envía en lotes con pausa.
  const pending: {
    customer_id: string;
    organization_id: string;
    name: string;
    email: string | null;
    marketing_opt_in: boolean;
    org_name: string;
    points: number;
    expiresOn: string | null;
  }[] = [];

  for (const row of rows) {
    // No se puede perder más de lo que se tiene: el saldo manda sobre la suma
    // de los lotes (parte de esos puntos pueden haberse gastado ya).
    const pointsAtRisk = Math.min(row.points_balance, row.points_due ?? 0);
    if (pointsAtRisk <= 0) {
      skipped++;
      continue;
    }

    const earliest =
      row.earliest_expiry instanceof Date
        ? row.earliest_expiry
        : new Date(row.earliest_expiry as unknown as string);
    if (isNaN(earliest.getTime())) {
      skipped++;
      continue;
    }

    // Ventana de este cliente: [vencimiento más próximo - daysAhead, ahora].
    // Si ya se le avisó dentro de ella, ese lote está avisado.
    const windowStart = new Date(earliest.getTime() - daysAhead * DAY_MS);
    const warnedAt = lastWarnedAt.get(row.customer_id);

    if (warnedAt && warnedAt >= windowStart) {
      skipped++;
      continue;
    }

    pending.push({
      customer_id: row.customer_id,
      organization_id: row.organization_id,
      name: row.name,
      email: row.email,
      marketing_opt_in: row.marketing_opt_in,
      org_name: row.org_name,
      points: pointsAtRisk,
      expiresOn: formatLimaDate(earliest),
    });
  }

  await runInBatches(pending, 5, 250, async (p) => {
    await sendLoyaltyEmail({
      organizationId: p.organization_id,
      customerId: p.customer_id,
      toAddress: p.email,
      marketingOptIn: p.marketing_opt_in,
      type: "points_expiring",
      orgName: p.org_name,
      data: {
        customerName: p.name,
        points: p.points,
        expiresOn: p.expiresOn,
      },
    });
    notified++;
  });

  if (rows.length > 0) {
    logger.info("Aviso de puntos por vencer procesado", {
      organizationId: organizationId ?? "all",
      daysAhead,
      candidates: rows.length,
      notified,
      skipped,
    });
  }

  return { candidates: rows.length, notified, skipped };
}
