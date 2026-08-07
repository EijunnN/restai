import { eq, and, gte, lt, sql } from "drizzle-orm";
import { db, schema, type DbOrTx } from "@restai/db";
import { adjustPoints } from "./loyalty.service.js";
import { logger } from "../lib/logger.js";
import { peruCivilDate, peruCivilDayStart } from "../lib/timezone.js";

/** Error de negocio del módulo de referidos; la ruta lo traduce a HTTP. */
export class ReferralError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ReferralError";
  }
}

// ---------------------------------------------------------------------------
// Referral code generation
// ---------------------------------------------------------------------------

// 8-char uppercase codes from an unambiguous alphabet (no easily-confused
// characters like 0/O or 1/I/L) so codes are safe to read aloud / type.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

function generateCode(): string {
  let out = "";
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

// ---------------------------------------------------------------------------
// getOrCreateReferralCode
// ---------------------------------------------------------------------------

/**
 * Return the customer's existing referral_code, or generate a unique one and
 * persist it. Uniqueness is per organization (enforced by the partial unique
 * index uq_customers_org_referral_code). On a conflict we retry with a fresh
 * code. Org-scoped: only updates the row when it belongs to organizationId.
 */
export async function getOrCreateReferralCode(params: {
  organizationId: string;
  customerId: string;
}): Promise<string> {
  const { organizationId, customerId } = params;

  const [existing] = await db
    .select({ referral_code: schema.customers.referral_code })
    .from(schema.customers)
    .where(
      and(
        eq(schema.customers.id, customerId),
        eq(schema.customers.organization_id, organizationId),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new Error("CUSTOMER_NOT_FOUND");
  }

  if (existing.referral_code) {
    return existing.referral_code;
  }

  // Generate-and-persist with retry on the per-org unique conflict.
  const MAX_ATTEMPTS = 6;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = generateCode();
    // Only set the code if it is still null (another concurrent call may have
    // won the race and set it first); scope strictly to the org.
    const updated = await db
      .update(schema.customers)
      .set({ referral_code: code })
      .where(
        and(
          eq(schema.customers.id, customerId),
          eq(schema.customers.organization_id, organizationId),
          sql`${schema.customers.referral_code} IS NULL`,
        ),
      )
      .returning({ referral_code: schema.customers.referral_code })
      .catch((err) => {
        // Unique violation on (organization_id, referral_code): treat as retry.
        if (isUniqueViolation(err)) return [] as { referral_code: string | null }[];
        throw err;
      });

    if (updated.length > 0 && updated[0].referral_code) {
      return updated[0].referral_code;
    }

    // 0 rows updated => a concurrent call already set a code; re-read and return.
    const [refreshed] = await db
      .select({ referral_code: schema.customers.referral_code })
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.id, customerId),
          eq(schema.customers.organization_id, organizationId),
        ),
      )
      .limit(1);

    if (refreshed?.referral_code) {
      return refreshed.referral_code;
    }
    // Otherwise the code was still null (unique conflict) — loop and retry.
  }

  throw new Error("REFERRAL_CODE_GENERATION_FAILED");
}

// Best-effort detection of a Postgres unique-violation (SQLSTATE 23505).
function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === "23505";
}

// ---------------------------------------------------------------------------
// Configuración del programa de referidos
// ---------------------------------------------------------------------------

/**
 * Configuración efectiva del programa de referidos de una organización.
 *
 * Los puntos viven en el programa de fidelización activo
 * (loyalty_programs.referral_referrer_points / referral_referee_points). El tope
 * mensual es antifraude y vive en organizations.settings.referrals
 * (no tiene columna propia): null = sin tope.
 */
export interface ReferralConfig {
  programId: string;
  programName: string;
  referrerPoints: number;
  refereePoints: number;
  monthlyCapPerReferrer: number | null;
}

/** Lee el tope mensual del jsonb de settings, tolerando datos sucios. */
function readMonthlyCap(settings: unknown): number | null {
  const raw = (settings as Record<string, any> | null)?.referrals
    ?.monthly_cap_per_referrer;
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

/**
 * Límites del mes civil PERUANO que contiene `at`: [inicio, inicio del mes
 * siguiente). Se usa el día operativo de Lima y no el UTC, para que el tope
 * "por mes" cierre a la medianoche del local y no a las 19:00 del día anterior.
 */
function peruMonthBounds(at: Date): { start: Date; end: Date } {
  const civil = peruCivilDate(at); // "YYYY-MM-DD"
  const year = Number(civil.slice(0, 4));
  const month = Number(civil.slice(5, 7));
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    start: peruCivilDayStart(`${civil.slice(0, 7)}-01`),
    end: peruCivilDayStart(
      `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`,
    ),
  };
}

/**
 * getReferralConfig
 *
 * Devuelve la configuración vigente, o null si la organización todavía no tiene
 * programa de fidelización activo (sin programa no hay referidos que premiar).
 */
export async function getReferralConfig(params: {
  organizationId: string;
}): Promise<ReferralConfig | null> {
  const { organizationId } = params;

  const [program] = await db
    .select({
      id: schema.loyaltyPrograms.id,
      name: schema.loyaltyPrograms.name,
      referrer_points: schema.loyaltyPrograms.referral_referrer_points,
      referee_points: schema.loyaltyPrograms.referral_referee_points,
    })
    .from(schema.loyaltyPrograms)
    .where(
      and(
        eq(schema.loyaltyPrograms.organization_id, organizationId),
        eq(schema.loyaltyPrograms.is_active, true),
      ),
    )
    .limit(1);

  if (!program) return null;

  const [org] = await db
    .select({ settings: schema.organizations.settings })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, organizationId))
    .limit(1);

  return {
    programId: program.id,
    programName: program.name,
    referrerPoints: program.referrer_points,
    refereePoints: program.referee_points,
    monthlyCapPerReferrer: readMonthlyCap(org?.settings),
  };
}

/**
 * updateReferralConfig
 *
 * Escribe los puntos de referidos (quien refiere y referido) y, opcionalmente,
 * el tope mensual por persona. Hasta ahora esas columnas solo se leían: el
 * módulo entero pagaba cero porque nadie las escribía nunca.
 *
 * - Los puntos son enteros >= 0 (0 = referidos desactivados para esa parte).
 * - `monthlyCapPerReferrer`: omitido = no se toca; null = quitar el tope.
 * - Se toma FOR UPDATE sobre la fila del programa para que dos administradores
 *   guardando a la vez no se pisen (última escritura consistente, no mezclada).
 * - El tope se guarda con una fusión jsonb (`||`), así no borra otras claves de
 *   organizations.settings.
 *
 * Devuelve el antes y el después para que la ruta lo audite.
 */
export async function updateReferralConfig(params: {
  organizationId: string;
  referrerPoints: number;
  refereePoints: number;
  monthlyCapPerReferrer?: number | null;
}): Promise<{ before: ReferralConfig; after: ReferralConfig }> {
  const { organizationId } = params;
  const referrerPoints = Math.trunc(params.referrerPoints);
  const refereePoints = Math.trunc(params.refereePoints);

  if (
    !Number.isFinite(referrerPoints) ||
    !Number.isFinite(refereePoints) ||
    referrerPoints < 0 ||
    refereePoints < 0
  ) {
    throw new ReferralError(
      "INVALID_POINTS",
      "Los puntos de referido deben ser enteros mayores o iguales a 0",
    );
  }

  const cap =
    params.monthlyCapPerReferrer === undefined
      ? undefined
      : params.monthlyCapPerReferrer === null
        ? null
        : Math.trunc(params.monthlyCapPerReferrer);

  if (cap !== undefined && cap !== null && (!Number.isFinite(cap) || cap < 1)) {
    throw new ReferralError(
      "INVALID_CAP",
      "El tope mensual debe ser un entero mayor o igual a 1 (o nulo para quitarlo)",
    );
  }

  return await db.transaction(async (tx) => {
    const [program] = await tx
      .select({
        id: schema.loyaltyPrograms.id,
        name: schema.loyaltyPrograms.name,
        referrer_points: schema.loyaltyPrograms.referral_referrer_points,
        referee_points: schema.loyaltyPrograms.referral_referee_points,
      })
      .from(schema.loyaltyPrograms)
      .where(
        and(
          eq(schema.loyaltyPrograms.organization_id, organizationId),
          eq(schema.loyaltyPrograms.is_active, true),
        ),
      )
      .limit(1)
      .for("update");

    if (!program) {
      throw new ReferralError(
        "PROGRAM_NOT_FOUND",
        "No hay un programa de fidelización activo en el que configurar los referidos",
      );
    }

    const [org] = await tx
      .select({ settings: schema.organizations.settings })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, organizationId))
      .limit(1)
      .for("update");

    const before: ReferralConfig = {
      programId: program.id,
      programName: program.name,
      referrerPoints: program.referrer_points,
      refereePoints: program.referee_points,
      monthlyCapPerReferrer: readMonthlyCap(org?.settings),
    };

    await tx
      .update(schema.loyaltyPrograms)
      .set({
        referral_referrer_points: referrerPoints,
        referral_referee_points: refereePoints,
      })
      .where(eq(schema.loyaltyPrograms.id, program.id));

    let monthlyCapPerReferrer = before.monthlyCapPerReferrer;
    if (cap !== undefined) {
      // Fusión jsonb: solo toca settings.referrals.monthly_cap_per_referrer y
      // conserva el resto de la configuración de la organización. Quitar el tope
      // BORRA la clave (`#-`) en vez de dejar un null suelto, para que el jsonb
      // que el frontend lee y reescribe no acumule basura.
      const settingsExpr =
        cap === null
          ? sql`COALESCE(${schema.organizations.settings}, '{}'::jsonb) #- '{referrals,monthly_cap_per_referrer}'::text[]`
          : sql`COALESCE(${schema.organizations.settings}, '{}'::jsonb) || jsonb_build_object(
              'referrals',
              COALESCE(${schema.organizations.settings} -> 'referrals', '{}'::jsonb)
                || jsonb_build_object('monthly_cap_per_referrer', ${cap}::int)
            )`;

      await tx
        .update(schema.organizations)
        .set({ settings: settingsExpr, updated_at: new Date() })
        .where(eq(schema.organizations.id, organizationId));
      monthlyCapPerReferrer = cap;
    }

    return {
      before,
      after: {
        programId: program.id,
        programName: program.name,
        referrerPoints,
        refereePoints,
        monthlyCapPerReferrer,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// registerReferral
// ---------------------------------------------------------------------------

/**
 * Bind a newly-registered referee to the referrer identified by `code` and open
 * a pending referrals row stamped with the program's configured reward amounts.
 *
 * Idempotent: if the referee already has referred_by set, this is a no-op.
 * Rejects self-referral and unknown/foreign codes (resolved within the org).
 * Returns { ok } indicating whether a referral was registered.
 */
export async function registerReferral(params: {
  organizationId: string;
  refereeCustomerId: string;
  code: string;
}): Promise<{ ok: boolean }> {
  const { organizationId, refereeCustomerId } = params;
  const code = params.code.trim().toUpperCase();

  if (!code) return { ok: false };

  return await db.transaction(async (tx) => {
    // Referee must exist in this org and not already be referred.
    const [referee] = await tx
      .select({
        id: schema.customers.id,
        referred_by: schema.customers.referred_by,
      })
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.id, refereeCustomerId),
          eq(schema.customers.organization_id, organizationId),
        ),
      )
      .limit(1);

    if (!referee || referee.referred_by) {
      // Unknown referee or already referred -> idempotent no-op.
      return { ok: false };
    }

    // Resolve referrer by code within the same org.
    const [referrer] = await tx
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.organization_id, organizationId),
          eq(schema.customers.referral_code, code),
        ),
      )
      .limit(1);

    if (!referrer) {
      return { ok: false };
    }

    // Reject self-referral.
    if (referrer.id === refereeCustomerId) {
      return { ok: false };
    }

    // Stamp the referral with the active program's reward amounts (0 if none).
    const [program] = await tx
      .select({
        referrer_points: schema.loyaltyPrograms.referral_referrer_points,
        referee_points: schema.loyaltyPrograms.referral_referee_points,
      })
      .from(schema.loyaltyPrograms)
      .where(
        and(
          eq(schema.loyaltyPrograms.organization_id, organizationId),
          eq(schema.loyaltyPrograms.is_active, true),
        ),
      )
      .limit(1);

    const referrerPoints = program?.referrer_points ?? 0;
    const refereePoints = program?.referee_points ?? 0;

    // Bind referee -> referrer. Guard on referred_by IS NULL to keep the
    // SELECT-then-UPDATE race idempotent: only the first writer succeeds.
    const bound = await tx
      .update(schema.customers)
      .set({ referred_by: referrer.id })
      .where(
        and(
          eq(schema.customers.id, refereeCustomerId),
          eq(schema.customers.organization_id, organizationId),
          sql`${schema.customers.referred_by} IS NULL`,
        ),
      )
      .returning({ id: schema.customers.id });

    if (bound.length === 0) {
      // Lost the race; another caller already registered the referral.
      return { ok: false };
    }

    await tx.insert(schema.referrals).values({
      organization_id: organizationId,
      referrer_customer_id: referrer.id,
      referee_customer_id: refereeCustomerId,
      code,
      status: "pending",
      referrer_points: referrerPoints,
      referee_points: refereePoints,
    });

    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// completeReferralForFirstOrder
// ---------------------------------------------------------------------------

/**
 * On a referee's first completed order, mark their pending referral completed
 * and award the configured points to BOTH parties via adjustPoints.
 *
 * Idempotent via the pending->completed transition: the status update only
 * affects a row that is still 'pending', so a second call awards nothing.
 * Accepts an optional tx so it can join an order-completion transaction.
 */
export async function completeReferralForFirstOrder(params: {
  organizationId: string;
  customerId: string;
  tx?: DbOrTx;
}): Promise<void> {
  const { organizationId, customerId } = params;
  const runner: DbOrTx = params.tx ?? db;

  // Find a pending referral for this referee within the org.
  const [pending] = await runner
    .select({
      id: schema.referrals.id,
      referrer_customer_id: schema.referrals.referrer_customer_id,
      referee_customer_id: schema.referrals.referee_customer_id,
      referrer_points: schema.referrals.referrer_points,
      referee_points: schema.referrals.referee_points,
    })
    .from(schema.referrals)
    .where(
      and(
        eq(schema.referrals.organization_id, organizationId),
        eq(schema.referrals.referee_customer_id, customerId),
        eq(schema.referrals.status, "pending"),
      ),
    )
    .limit(1);

  if (!pending) return;

  // Atomically claim the referral: only proceed if THIS call flips it from
  // pending -> completed. A concurrent caller that lost gets 0 rows back.
  const claimed = await runner
    .update(schema.referrals)
    .set({ status: "completed", completed_at: new Date() })
    .where(
      and(
        eq(schema.referrals.id, pending.id),
        eq(schema.referrals.status, "pending"),
      ),
    )
    .returning({ id: schema.referrals.id });

  if (claimed.length === 0) return;

  // Tope mensual antifraude (organizations.settings.referrals): cuenta cuántos
  // referidos de ESTE promotor se completaron dentro del mes civil peruano en
  // curso —incluido el que se acaba de reclamar— y bloquea su premio a partir
  // del tope. El referido SIEMPRE cobra: quien abusa es el que reparte códigos,
  // no el cliente nuevo. Con concurrencia extrema (dos primeras compras del
  // mismo promotor en el mismo instante) el tope puede excederse en uno; es un
  // riesgo acotado y preferible a serializar el cierre de pedidos.
  let referrerAwardBlocked = false;
  if (pending.referrer_points > 0) {
    try {
      const [org] = await runner
        .select({ settings: schema.organizations.settings })
        .from(schema.organizations)
        .where(eq(schema.organizations.id, organizationId))
        .limit(1);

      const cap = readMonthlyCap(org?.settings);
      if (cap != null) {
        const { start, end } = peruMonthBounds(new Date());
        const [countRow] = await runner
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.referrals)
          .where(
            and(
              eq(schema.referrals.organization_id, organizationId),
              eq(schema.referrals.referrer_customer_id, pending.referrer_customer_id),
              eq(schema.referrals.status, "completed"),
              gte(schema.referrals.completed_at, start),
              lt(schema.referrals.completed_at, end),
            ),
          );

        const rewardedThisMonth = countRow?.count ?? 0;
        if (rewardedThisMonth > cap) {
          referrerAwardBlocked = true;
          logger.info("Referido por encima del tope mensual: no se premia al promotor", {
            referralId: pending.id,
            referrerCustomerId: pending.referrer_customer_id,
            cap,
            rewardedThisMonth,
          });
        }
      }
    } catch (err) {
      // Si no se puede leer el tope, se premia igual: cortar la recompensa por
      // un fallo de lectura castiga al cliente por un problema nuestro.
      logger.warn("No se pudo evaluar el tope mensual de referidos", {
        referralId: pending.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Award points to both parties. adjustPoints clamps >= 0 and writes a ledger
  // row; skip zero awards (e.g. when referrals are configured at 0 points).
  if (pending.referrer_points > 0 && !referrerAwardBlocked) {
    try {
      await adjustPoints({
        organizationId,
        customerId: pending.referrer_customer_id,
        amount: pending.referrer_points,
        reason: "Referido",
      });
    } catch (err) {
      // Referrer may not be enrolled in the active program; log and continue so
      // the referee still gets their reward.
      logger.warn("completeReferralForFirstOrder: referrer award failed", {
        referralId: pending.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (pending.referee_points > 0) {
    try {
      await adjustPoints({
        organizationId,
        customerId: pending.referee_customer_id,
        amount: pending.referee_points,
        reason: "Referido",
      });
    } catch (err) {
      logger.warn("completeReferralForFirstOrder: referee award failed", {
        referralId: pending.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
